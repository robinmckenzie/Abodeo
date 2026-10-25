// A signed-in account's list of people, kept on the server and reached through
// the people endpoints (AD #61 Manage People). Like the account's projects, it
// is only ever held in memory, never in browser storage. Every request names
// the account the page is working for.
import { readPeople, type Person, type PersonNameProblem } from "./people";
import {
  peoplePath,
  type PeopleOperation,
  type PeopleResponse,
  type RemovalCount,
} from "./people-api";
import {
  readFailure,
  send,
  type AccountFailure,
  type Answer,
  type Fetch,
} from "./account-projects";

export type AccountPeopleLoad =
  | ({ ok: true } & PeopleResponse)
  // The saved list cannot be read, so nothing is changed.
  | { ok: false; reason: AccountFailure | "list-unreadable" };

// The people as the server gives them, checked by the browser's own rules.
function readList(value: unknown): Person[] | null {
  return readPeople({ version: 1, people: value });
}

function readError(answer: Answer) {
  return answer === "unreachable"
    ? undefined
    : (answer.body as { error?: unknown } | null)?.error;
}

function readFailureOrUnreadable(answer: Answer) {
  return readError(answer) === "unreadable"
    ? ("list-unreadable" as const)
    : readFailure(answer);
}

function readResponse(answer: Answer): PeopleResponse | null {
  if (answer === "unreachable" || answer.status !== 200) return null;
  const body = answer.body as Partial<PeopleResponse> | null;
  const people = readList(body?.people);
  if (
    !people ||
    typeof body?.revision !== "number" ||
    typeof body.established !== "boolean"
  ) {
    return null;
  }
  return { people, revision: body.revision, established: body.established };
}

export async function loadAccountPeople(
  accountId: string,
  fetchFn: Fetch = fetch,
): Promise<AccountPeopleLoad> {
  const answer = await send(fetchFn, accountId, peoplePath);
  const response = readResponse(answer);
  return response
    ? { ok: true, ...response }
    : { ok: false, reason: readFailureOrUnreadable(answer) };
}

export type PeopleFailure =
  PersonNameProblem | "not-found" | "list-unreadable" | AccountFailure;

export type AccountPeopleChange =
  ({ ok: true } & PeopleResponse) | { ok: false; reason: PeopleFailure };

function readNameProblem(answer: Answer): PeopleFailure | null {
  const error = readError(answer);
  if (answer === "unreachable") return null;
  if (error === "duplicate_name") return "duplicate";
  if (error === "invalid_name") {
    const problem = (answer.body as { problem?: unknown }).problem;
    return problem === "too-long" ? "too-long" : "blank";
  }
  return null;
}

async function change(
  accountId: string,
  operation: PeopleOperation,
  fetchFn: Fetch,
): Promise<AccountPeopleChange> {
  const answer = await send(fetchFn, accountId, peoplePath, {
    method: "POST",
    body: operation,
  });
  const response = readResponse(answer);
  if (response) return { ok: true, ...response };
  return {
    ok: false,
    reason: readNameProblem(answer) ?? readFailureOrUnreadable(answer),
  };
}

// Sending the same id again, as after a lost answer, finds the person added.
export function addAccountPerson(
  accountId: string,
  id: string,
  name: string,
  fetchFn: Fetch = fetch,
  jobTitle?: string,
) {
  return change(accountId, { op: "add", id, name, jobTitle }, fetchFn);
}

export function renameAccountPerson(
  accountId: string,
  id: string,
  name: string,
  fetchFn: Fetch = fetch,
  jobTitle?: string,
) {
  return change(accountId, { op: "rename", id, name, jobTitle }, fetchFn);
}

// Saves the list as it is, once the move of the browser's projects is
// settled.
export function establishAccountPeople(
  accountId: string,
  fetchFn: Fetch = fetch,
) {
  return change(accountId, { op: "establish" }, fetchFn);
}

export type AccountRemovalCount =
  ({ ok: true } & RemovalCount) | { ok: false; reason: AccountFailure };

// How many projects removing the person would set to Unassigned, as the
// server has them now.
export async function countAccountAssignedProjects(
  accountId: string,
  id: string,
  fetchFn: Fetch = fetch,
): Promise<AccountRemovalCount> {
  const answer = await send(fetchFn, accountId, peoplePath, {
    method: "POST",
    body: { op: "remove", id, dryRun: true } satisfies PeopleOperation,
  });
  const body =
    answer !== "unreachable" && answer.status === 200
      ? (answer.body as Partial<RemovalCount> | null)
      : null;
  if (typeof body?.count !== "number" || typeof body.unreadable !== "number") {
    return { ok: false, reason: readFailure(answer) };
  }
  return { ok: true, count: body.count, unreadable: body.unreadable };
}

export type AccountRemoval =
  | ({ ok: true } & PeopleResponse)
  // The projects assigned changed since the count was shown.
  | ({ ok: false; reason: "count-changed" } & RemovalCount)
  | { ok: false; reason: PeopleFailure };

// Removes the person and sets their projects to Unassigned, if the count is
// still the one confirmed.
export async function removeAccountPerson(
  accountId: string,
  id: string,
  expectedCount: number,
  fetchFn: Fetch = fetch,
): Promise<AccountRemoval> {
  const answer = await send(fetchFn, accountId, peoplePath, {
    method: "POST",
    body: { op: "remove", id, expectedCount } satisfies PeopleOperation,
  });
  const response = readResponse(answer);
  if (response) return { ok: true, ...response };
  if (readError(answer) === "count_changed") {
    const body = (answer as Exclude<Answer, "unreachable">)
      .body as Partial<RemovalCount>;
    return {
      ok: false,
      reason: "count-changed",
      count: typeof body.count === "number" ? body.count : 0,
      unreadable: typeof body.unreadable === "number" ? body.unreadable : 0,
    };
  }
  return { ok: false, reason: readFailureOrUnreadable(answer) };
}
