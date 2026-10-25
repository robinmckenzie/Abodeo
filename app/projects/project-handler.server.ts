// The projects endpoints, for a signed-in account's projects (AD #41 Access
// Projects Across Devices). Whose projects are read or changed comes only
// from the session cookie, never from anything in the request. The page
// also names the account it is working for, and a request naming another is
// refused without changing anything.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithJson,
  withTimeout,
  type ReadSessionUserId,
} from "../account/account-profile.server";
import { bundledDefaultProjects } from "./default-projects";
import { readProjectFields, readProjectSave } from "./project-changes";
import type { ProjectStore } from "./project-store.server";
import { peopleVersion, readPeople, type Person } from "./people";
import {
  hasTitle,
  newProjectFields,
  parseProject,
  type Project,
} from "./projects";
import { readRequestAccount } from "./request-account.server";
import {
  importBodyLimit,
  isProjectId,
  projectBodyLimit,
  projectsImportPath,
  projectsPath,
  type ProjectErrorCode,
} from "./projects-api";

export function isProjectsPath(pathname: string) {
  return pathname === projectsPath || pathname.startsWith(`${projectsPath}/`);
}

export type ProjectRequestDependencies = {
  readSessionUserId: ReadSessionUserId;
  store: ProjectStore;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
  // Default projects come only from the app, never from a browser.
  defaultIds?: readonly string[];
};

function respondWithProjectError(status: number, error: ProjectErrorCode) {
  return respondWithJson(status, { error });
}

function reportProjectFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_projects_failed", code }));
}

// What a request asks for, from its method and path, or an error response.
type Route =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "import" }
  | { kind: "read"; id: string }
  | { kind: "save"; id: string };

function findRoute(request: Request): Route | Response {
  const { pathname } = new URL(request.url);
  const { method } = request;
  const notAllowed = () => respondWithProjectError(405, "method_not_allowed");
  if (pathname === projectsPath) {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return notAllowed();
  }
  if (pathname === projectsImportPath) {
    return method === "POST" ? { kind: "import" } : notAllowed();
  }
  let id: string;
  try {
    id = decodeURIComponent(pathname.slice(projectsPath.length + 1));
  } catch {
    return respondWithProjectError(404, "not_found");
  }
  if (!isProjectId(id)) return respondWithProjectError(404, "not_found");
  if (method === "GET") return { kind: "read", id };
  if (method === "PATCH") return { kind: "save", id };
  return notAllowed();
}

// The body as JSON, undefined if it is not JSON, or "too-large".
async function readBody(request: Request, limit: number) {
  const length = Number(request.headers.get("Content-Length"));
  if (length > limit) return "too-large" as const;
  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return undefined;
  }
  if (buffer.byteLength > limit) return "too-large" as const;
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    return undefined;
  }
}

// The projects to move in from a browser, each a saved form with its id, or
// undefined if any is not valid.
function readImport(body: unknown): Project[] | undefined {
  const entries = (body as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  const projects: Project[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (!isProjectId(id) || ids.has(id)) return undefined;
    const project = parseProject(id, JSON.stringify(entry));
    if (!project) return undefined;
    ids.add(id);
    projects.push(project);
  }
  return projects;
}

// The browser's list of people to move in with its projects: undefined if
// none was sent, null if it is not valid.
function readImportPeople(body: unknown): Person[] | undefined | null {
  const entries = (body as { people?: unknown } | null)?.people;
  if (entries === undefined) return undefined;
  return readPeople({ version: peopleVersion, people: entries });
}

export async function handleProjectsRequest(
  request: Request,
  {
    readSessionUserId,
    store,
    timeout = accountStoreTimeout,
    reportFailure = reportProjectFailure,
    defaultIds = bundledDefaultProjects?.projects.map(({ id }) => id) ?? [],
  }: ProjectRequestDependencies,
): Promise<Response> {
  const route = findRoute(request);
  if (route instanceof Response) return route;
  const isWrite = request.method !== "GET";
  // A page on another site cannot send a JSON body without the browser first
  // asking permission, which these endpoints never give.
  if (
    isWrite &&
    !request.headers.get("Content-Type")?.startsWith("application/json")
  ) {
    return respondWithProjectError(400, "invalid_request");
  }
  try {
    const account = await readRequestAccount(
      request,
      readSessionUserId,
      timeout,
    );
    if (account.kind === "refused") {
      return respondWithProjectError(account.status, account.error);
    }
    const userId = account.userId;
    const body = isWrite
      ? await readBody(
          request,
          route.kind === "import" ? importBodyLimit : projectBodyLimit,
        )
      : undefined;
    if (body === "too-large") return respondWithProjectError(413, "too_large");
    const run = <Result>(work: Promise<Result>) => withTimeout(work, timeout);

    switch (route.kind) {
      case "list":
        return respondWithJson(200, await run(store.list(userId)));

      case "read": {
        const outcome = await run(store.read(userId, route.id));
        if (outcome.kind === "not-found") {
          return respondWithProjectError(404, "not_found");
        }
        if (outcome.kind === "unreadable") {
          return respondWithProjectError(422, "unreadable");
        }
        return respondWithJson(200, { project: outcome.project });
      }

      case "create": {
        const { id, fields } = (body ?? {}) as {
          id?: unknown;
          fields?: unknown;
        };
        const read = readProjectFields(fields);
        if (!isProjectId(id) || !read || !hasTitle(read.title ?? "")) {
          return respondWithProjectError(400, "invalid_request");
        }
        if (defaultIds.includes(id)) {
          return respondWithProjectError(400, "invalid_request");
        }
        const outcome = await run(
          store.create(userId, id, { ...newProjectFields, ...read }),
        );
        if (outcome.kind === "unknown-assignee") {
          return respondWithProjectError(400, "unknown_assignee");
        }
        if (outcome.kind !== "found") {
          return respondWithProjectError(422, "unreadable");
        }
        return respondWithJson(200, { project: outcome.project });
      }

      case "save": {
        const save = readProjectSave(body);
        if (!save) return respondWithProjectError(400, "invalid_request");
        const outcome = await run(
          store.saveChanges(userId, route.id, save.base, save.changes),
        );
        switch (outcome.kind) {
          case "saved":
            return respondWithJson(200, { project: outcome.project });
          case "not-found":
            return respondWithProjectError(404, "not_found");
          case "unreadable":
            return respondWithProjectError(422, "unreadable");
          case "conflict":
            return respondWithJson(409, {
              error: "conflict",
              project: outcome.project,
              fields: outcome.fields,
            });
          case "unknown-assignee":
            return respondWithProjectError(400, "unknown_assignee");
          case "busy":
            return respondWithProjectError(503, "unavailable");
        }
        break;
      }

      case "import": {
        const projects = readImport(body);
        if (!projects || projects.some(({ id }) => defaultIds.includes(id))) {
          return respondWithProjectError(400, "invalid_request");
        }
        const people = readImportPeople(body);
        if (people === null) {
          return respondWithProjectError(400, "invalid_request");
        }
        const outcomes = await run(
          store.importProjects(userId, projects, people),
        );
        return respondWithJson(200, { outcomes });
      }
    }
    return respondWithProjectError(400, "invalid_request");
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithProjectError(503, "unavailable");
  }
}
