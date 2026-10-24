// The people endpoints, for a signed-in account's list of people (AD #61
// Manage People). Whose list is read or changed comes only from the session
// cookie, never from anything in the request. The page also names the account
// it is working for, and a request naming another is refused without changing
// anything.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithJson,
  withTimeout,
  type ReadSessionUserId,
} from "../account/account-profile.server";
import { isPersonId } from "./projects";
import {
  peopleBodyLimit,
  peoplePath,
  type PeopleErrorCode,
  type PeopleOperation,
} from "./people-api";
import type { PeopleStore } from "./people-store.server";
import { readRequestAccount } from "./request-account.server";

export function isPeoplePath(pathname: string) {
  return pathname === peoplePath;
}

export type PeopleRequestDependencies = {
  readSessionUserId: ReadSessionUserId;
  store: PeopleStore;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

function respondWithPeopleError(
  status: number,
  error: PeopleErrorCode,
  extra: Record<string, unknown> = {},
) {
  return respondWithJson(status, { error, ...extra });
}

function reportPeopleFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_people_failed", code }));
}

// The operation a body asks for, or undefined if it is not valid. The name is
// checked by the store, which says what is wrong with it.
function readOperation(body: unknown): PeopleOperation | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { op, id, name, expectedCount, dryRun } = body as Record<
    string,
    unknown
  >;
  switch (op) {
    case "establish":
      return { op };
    case "add":
    case "rename":
      return isPersonId(id) && typeof name === "string"
        ? { op, id, name }
        : undefined;
    case "remove": {
      if (!isPersonId(id)) return undefined;
      if (
        expectedCount !== undefined &&
        !(Number.isInteger(expectedCount) && (expectedCount as number) >= 0)
      ) {
        return undefined;
      }
      if (dryRun !== undefined && typeof dryRun !== "boolean") {
        return undefined;
      }
      return {
        op,
        id,
        ...(expectedCount !== undefined && {
          expectedCount: expectedCount as number,
        }),
        ...(dryRun !== undefined && { dryRun }),
      };
    }
  }
  return undefined;
}

// The body as JSON, undefined if it is not JSON, or "too-large".
async function readBody(request: Request) {
  const length = Number(request.headers.get("Content-Length"));
  if (length > peopleBodyLimit) return "too-large" as const;
  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return undefined;
  }
  if (buffer.byteLength > peopleBodyLimit) return "too-large" as const;
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    return undefined;
  }
}

export async function handlePeopleRequest(
  request: Request,
  {
    readSessionUserId,
    store,
    timeout = accountStoreTimeout,
    reportFailure = reportPeopleFailure,
  }: PeopleRequestDependencies,
): Promise<Response> {
  const { method } = request;
  if (method !== "GET" && method !== "POST") {
    return respondWithPeopleError(405, "method_not_allowed");
  }
  // A page on another site cannot send a JSON body without the browser first
  // asking permission, which these endpoints never give.
  if (
    method === "POST" &&
    !request.headers.get("Content-Type")?.startsWith("application/json")
  ) {
    return respondWithPeopleError(400, "invalid_request");
  }
  try {
    const account = await readRequestAccount(
      request,
      readSessionUserId,
      timeout,
    );
    if (account.kind === "refused") {
      return respondWithPeopleError(account.status, account.error);
    }
    const { userId } = account;
    const run = <Result>(work: Promise<Result>) => withTimeout(work, timeout);

    if (method === "GET") {
      const read = await run(store.read(userId));
      return read === "unreadable"
        ? respondWithPeopleError(422, "unreadable")
        : respondWithJson(200, read);
    }

    const body = await readBody(request);
    if (body === "too-large") return respondWithPeopleError(413, "too_large");
    const operation = readOperation(body);
    if (!operation) return respondWithPeopleError(400, "invalid_request");
    const outcome = await run(store.apply(userId, operation));
    switch (outcome.kind) {
      case "done":
        return respondWithJson(200, {
          people: outcome.people,
          revision: outcome.revision,
          established: true,
        });
      case "preview":
        return respondWithJson(200, {
          count: outcome.count,
          unreadable: outcome.unreadable,
        });
      case "invalid-name":
        return respondWithPeopleError(400, "invalid_name", {
          problem: outcome.problem,
        });
      case "duplicate":
        return respondWithPeopleError(409, "duplicate_name");
      case "not-found":
        return respondWithPeopleError(404, "not_found");
      case "count-changed":
        return respondWithPeopleError(409, "count_changed", {
          count: outcome.count,
          unreadable: outcome.unreadable,
        });
      case "unreadable":
        return respondWithPeopleError(422, "unreadable");
    }
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithPeopleError(503, "unavailable");
  }
}
