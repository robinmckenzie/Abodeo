// A signed-in account's projects, kept on the server and reached through the
// projects endpoints. They are only ever held in memory, never in browser
// storage, so that signing out, which reloads the page, leaves nothing of
// them behind. Every request names the account the page is working for,
// and gives up after requestTimeout.
import { requestTimeout } from "../account/account-client";
import { projectFields, type ProjectField } from "./project-changes";
import {
  parseProject,
  projectVersion,
  type Project,
  type ProjectFields,
} from "./projects";
import {
  accountHeader,
  buildProjectPath,
  projectsImportPath,
  projectsPath,
  type ImportOutcome,
} from "./projects-api";
import { canMergeTaskChanges, type Task } from "./tasks";

type Fetch = typeof fetch;

export type AccountFailure =
  // The server or the account store did not answer.
  | "unreachable"
  | "signed-out"
  // Another tab signed in as someone else.
  | "account-changed"
  | "not-found"
  | "unreadable"
  | "too-large"
  | "refused";

// A save of a field changed elsewhere since it was loaded.
export type SaveConflict = { project: Project; fields: ProjectField[] };

// Saves started as the page is left or hidden are sent so that they can
// finish after it has gone, if small enough for the browser to allow it.
let isPageLeaving = false;
export const keepaliveLimit = 60 * 1024;

export function setPageLeaving(value: boolean) {
  isPageLeaving = value;
}

type Answer = { status: number; body: unknown } | "unreachable";

async function send(
  fetchFn: Fetch,
  accountId: string,
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<Answer> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = { [accountHeader]: accountId };
  if (text !== undefined) headers["Content-Type"] = "application/json";
  const size = text === undefined ? 0 : new TextEncoder().encode(text).length;
  try {
    const response = await fetchFn(path, {
      method,
      credentials: "same-origin",
      signal: AbortSignal.timeout(requestTimeout),
      headers,
      body: text,
      keepalive: isPageLeaving && text !== undefined && size < keepaliveLimit,
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Answered without a body.
    }
    return { status: response.status, body: parsed };
  } catch {
    return "unreachable";
  }
}

function readFailure(answer: Answer): AccountFailure {
  if (answer === "unreachable") return "unreachable";
  const error = (answer.body as { error?: unknown } | null)?.error;
  switch (answer.status) {
    case 401:
      return "signed-out";
    case 404:
      return "not-found";
    case 409:
      return error === "account_changed" ? "account-changed" : "refused";
    case 413:
      return "too-large";
    case 422:
      return "unreadable";
    case 400:
      return "refused";
  }
  return "unreachable";
}

// A project as the server gives it, checked by the browser's own rules.
function readProject(value: unknown): Project | null {
  const id = (value as { id?: unknown } | null)?.id;
  if (typeof id !== "string") return null;
  return parseProject(
    id,
    JSON.stringify({ ...(value as object), version: projectVersion }),
  );
}

function readProjectAnswer(answer: Answer) {
  if (answer === "unreachable" || answer.status !== 200) return null;
  return readProject((answer.body as { project?: unknown } | null)?.project);
}

export type AccountLoad =
  | {
      ok: true;
      projects: Project[];
      unreadableCount: number;
      defaultIds: string[];
    }
  | { ok: false; reason: AccountFailure };

export async function loadAccountProjects(
  accountId: string,
  fetchFn: Fetch = fetch,
): Promise<AccountLoad> {
  const answer = await send(fetchFn, accountId, projectsPath);
  if (answer === "unreachable" || answer.status !== 200) {
    return { ok: false, reason: readFailure(answer) };
  }
  const body = answer.body as {
    projects?: unknown;
    unreadableCount?: unknown;
    defaultIds?: unknown;
  } | null;
  if (
    !Array.isArray(body?.projects) ||
    typeof body.unreadableCount !== "number" ||
    !Array.isArray(body.defaultIds)
  ) {
    return { ok: false, reason: "unreachable" };
  }
  const projects: Project[] = [];
  let unreadableCount = body.unreadableCount;
  for (const value of body.projects) {
    const project = readProject(value);
    if (project) projects.push(project);
    else unreadableCount++;
  }
  return {
    ok: true,
    projects,
    unreadableCount,
    defaultIds: body.defaultIds.filter(
      (id): id is string => typeof id === "string",
    ),
  };
}

// Sending the same id again, as after a lost answer, gives the project
// already made rather than a second one.
export async function createAccountProject(
  accountId: string,
  id: string,
  fields: ProjectFields,
  fetchFn: Fetch = fetch,
): Promise<
  { ok: true; project: Project } | { ok: false; reason: AccountFailure }
> {
  const answer = await send(fetchFn, accountId, projectsPath, {
    method: "POST",
    body: { id, fields },
  });
  const project = readProjectAnswer(answer);
  return project
    ? { ok: true, project }
    : { ok: false, reason: readFailure(answer) };
}

// Moves the browser's own projects into the account. Gives, for each, how it
// was received: any answer means the account now has it.
export async function importProjects(
  accountId: string,
  projects: Project[],
  fetchFn: Fetch = fetch,
): Promise<
  | { ok: true; outcomes: Record<string, ImportOutcome> }
  | { ok: false; reason: AccountFailure }
> {
  const answer = await send(fetchFn, accountId, projectsImportPath, {
    method: "POST",
    body: {
      projects: projects.map((project) => {
        const { id, ...rest } = project;
        return { id, version: projectVersion, ...rest };
      }),
    },
  });
  const outcomes =
    answer !== "unreachable" && answer.status === 200
      ? (answer.body as { outcomes?: unknown } | null)?.outcomes
      : undefined;
  if (typeof outcomes !== "object" || outcomes === null) {
    return { ok: false, reason: readFailure(answer) };
  }
  return { ok: true, outcomes: outcomes as Record<string, ImportOutcome> };
}

export type AccountSaveResult =
  | { ok: true; project: Project }
  | { ok: false; reason: AccountFailure | "conflict" };

export type AccountTasksResult =
  | { ok: true; tasks: Task[]; project: Project }
  // The tasks were changed elsewhere in a way this change would undo, so
  // it was not applied. tasks are those saved.
  | { ok: false; reason: "tasks-conflict"; tasks: Task[] }
  | { ok: false; reason: AccountFailure | "conflict" };

// How many times a change to the tasks is applied again to tasks changed
// elsewhere. Provisional.
export const taskRetries = 3;

function pickFields(source: ProjectFields, fields: readonly ProjectField[]) {
  const picked: Partial<ProjectFields> = {};
  for (const field of fields) Object.assign(picked, { [field]: source[field] });
  return picked;
}

// An opened project's saving. Each save is based on the value of each field
// as this page last saw it saved, so that the server can refuse a field
// changed elsewhere since. Saves are sent one at a time, in order, and the
// base is updated only from their answers, in that order.
export function openAccountProject(
  accountId: string,
  project: Project,
  fetchFn: Fetch = fetch,
) {
  const path = buildProjectPath(project.id);
  let base: ProjectFields = { ...project };
  let conflict: SaveConflict | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <Result>(work: () => Promise<Result>) => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };

  const patch = (changes: Partial<ProjectFields>) =>
    send(fetchFn, accountId, path, {
      method: "PATCH",
      body: {
        base: pickFields(
          base,
          projectFields.filter((field) => changes[field] !== undefined),
        ),
        changes,
      },
    });

  const readConflict = (answer: Answer): SaveConflict | null => {
    if (answer === "unreachable" || answer.status !== 409) return null;
    const body = answer.body as { project?: unknown; fields?: unknown } | null;
    const saved = readProject(body?.project);
    const fields = Array.isArray(body?.fields)
      ? projectFields.filter((field) =>
          (body.fields as unknown[]).includes(field),
        )
      : [];
    return saved && fields.length > 0 ? { project: saved, fields } : null;
  };

  return {
    // The latest saved copy, which the form then shows and bases saves on.
    load: () =>
      enqueue(async () => {
        const answer = await send(fetchFn, accountId, path);
        const latest = readProjectAnswer(answer);
        if (!latest) return { ok: false as const, reason: readFailure(answer) };
        base = { ...latest };
        return { ok: true as const, project: latest };
      }),

    // A field still in conflict is not sent again until the person chooses
    // which version to keep.
    saveChanges: (changes: Partial<ProjectFields>) =>
      enqueue(async (): Promise<AccountSaveResult> => {
        if (conflict?.fields.some((field) => changes[field] !== undefined)) {
          return { ok: false, reason: "conflict" };
        }
        const answer = await patch(changes);
        const saved = readProjectAnswer(answer);
        if (saved) {
          base = {
            ...base,
            ...pickFields(
              saved,
              projectFields.filter((field) => changes[field] !== undefined),
            ),
          };
          return { ok: true, project: saved };
        }
        const found = readConflict(answer);
        if (found) {
          conflict = found;
          return { ok: false, reason: "conflict" };
        }
        return { ok: false, reason: readFailure(answer) };
      }),

    // Applies one change to the tasks as last saved. If the tasks were
    // changed elsewhere, the change is applied again to theirs, unless the
    // two changes touch the same task or both change the order.
    saveTasks: (change: (tasks: Task[]) => Task[]) =>
      enqueue(async (): Promise<AccountTasksResult> => {
        for (let attempt = 0; attempt < taskRetries; attempt++) {
          const before = base.tasks;
          const mine = change(before);
          const answer = await patch({ tasks: mine });
          const saved = readProjectAnswer(answer);
          if (saved) {
            base = { ...base, tasks: saved.tasks };
            return { ok: true, tasks: saved.tasks, project: saved };
          }
          const found = readConflict(answer);
          if (!found) return { ok: false, reason: readFailure(answer) };
          const theirs = found.project.tasks;
          base = { ...base, tasks: theirs };
          if (!canMergeTaskChanges(before, mine, theirs)) {
            return { ok: false, reason: "tasks-conflict", tasks: theirs };
          }
        }
        return { ok: false, reason: "tasks-conflict", tasks: base.tasks };
      }),

    readConflict: () => conflict,

    // Takes the saved values of the fields in conflict, giving them for the
    // form to show.
    takeSavedVersion() {
      if (!conflict) return {};
      const saved = pickFields(conflict.project, conflict.fields);
      base = { ...base, ...saved };
      conflict = null;
      return saved;
    },

    // The next save replaces the saved values of the fields in conflict,
    // because the person chose to.
    keepMine() {
      if (!conflict) return;
      base = { ...base, ...pickFields(conflict.project, conflict.fields) };
      conflict = null;
    },
  };
}

export type OpenedAccountProject = ReturnType<typeof openAccountProject>;
