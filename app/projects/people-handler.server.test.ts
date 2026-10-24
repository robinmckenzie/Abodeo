// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { handlePeopleRequest } from "./people-handler.server";
import type { PeopleOutcome, PeopleStore } from "./people-store.server";
import type { PeopleOperation } from "./people-api";
import { accountHeader } from "./projects-api";

const baseUrl = "http://localhost:5173";

// The session cookie is simply the account's id.
const readSessionUserId = async (headers: Headers) =>
  headers.get("cookie") ?? undefined;

function createHandler(
  outcome: PeopleOutcome = { kind: "done", people: [], revision: 1 },
) {
  const operations: { userId: string; operation: PeopleOperation }[] = [];
  const reads: string[] = [];
  const store: PeopleStore = {
    read: vi.fn(async (userId: string) => {
      reads.push(userId);
      return { people: [], revision: 0, established: false };
    }),
    apply: vi.fn(async (userId: string, operation: PeopleOperation) => {
      operations.push({ userId, operation });
      return outcome;
    }),
  };
  const handle = (request: Request) =>
    handlePeopleRequest(request, {
      readSessionUserId,
      store,
      reportFailure: () => {},
    });
  return { handle, operations, reads, store };
}

function send({
  account = "ada",
  pageAccount = account,
  method = "GET",
  body,
  contentType = "application/json",
}: {
  account?: string | null;
  pageAccount?: string | null;
  method?: string;
  body?: unknown;
  contentType?: string;
} = {}) {
  const headers: Record<string, string> = {};
  if (account) headers.cookie = account;
  if (pageAccount) headers[accountHeader] = pageAccount;
  if (body !== undefined) headers["Content-Type"] = contentType;
  return new Request(`${baseUrl}/api/people`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("the people endpoints", () => {
  it("refuse a request without a valid sign-in", async () => {
    const { handle, reads } = createHandler();
    const response = await handle(send({ account: null, pageAccount: "ada" }));
    expect(response.status).toBe(401);
    expect(reads).toEqual([]);
  });

  it("refuse a request from a page working for another account", async () => {
    const { handle, operations } = createHandler();
    const response = await handle(
      send({
        account: "ada",
        pageAccount: "bob",
        method: "POST",
        body: { op: "establish" },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "account_changed" });
    expect(operations).toEqual([]);
  });

  it("read the list of the signed-in account only", async () => {
    const { handle, reads } = createHandler();
    const response = await handle(send());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      people: [],
      revision: 0,
      established: false,
    });
    expect(reads).toEqual(["ada"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuse methods other than GET and POST", async () => {
    const { handle } = createHandler();
    expect((await handle(send({ method: "DELETE" }))).status).toBe(405);
  });

  it("refuse a change that is not JSON", async () => {
    const { handle, operations } = createHandler();
    const response = await handle(
      send({
        method: "POST",
        body: { op: "establish" },
        contentType: "text/plain",
      }),
    );
    expect(response.status).toBe(400);
    expect(operations).toEqual([]);
  });

  it.each([
    ["an unknown operation", { op: "merge" }],
    ["an add without a name", { op: "add", id: "a" }],
    [
      "an add with an id that cannot be one",
      { op: "add", id: "a b", name: "A" },
    ],
    ["an add of Unassigned", { op: "add", id: "unassigned", name: "A" }],
    ["a rename without an id", { op: "rename", name: "A" }],
    [
      "a removal with a bad count",
      { op: "remove", id: "a", expectedCount: -1 },
    ],
    [
      "a removal with a fractional count",
      { op: "remove", id: "a", expectedCount: 1.5 },
    ],
    ["a removal with a bad dry run", { op: "remove", id: "a", dryRun: "yes" }],
    ["nothing", null],
  ])("refuse %s", async (_, body) => {
    const { handle, operations } = createHandler();
    const response = await handle(send({ method: "POST", body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(operations).toEqual([]);
  });

  it("pass on each valid change for the signed-in account, ignoring any account in the body", async () => {
    const { handle, operations } = createHandler();
    const bodies = [
      { op: "add", id: "a1", name: "Dora", userId: "bob" },
      { op: "rename", id: "a1", name: "Dorothy" },
      { op: "remove", id: "a1", expectedCount: 2 },
      { op: "remove", id: "a1", dryRun: true },
      { op: "establish" },
    ];
    for (const body of bodies) {
      expect((await handle(send({ method: "POST", body }))).status).toBe(200);
    }
    expect(operations).toEqual([
      { userId: "ada", operation: { op: "add", id: "a1", name: "Dora" } },
      { userId: "ada", operation: { op: "rename", id: "a1", name: "Dorothy" } },
      {
        userId: "ada",
        operation: { op: "remove", id: "a1", expectedCount: 2 },
      },
      { userId: "ada", operation: { op: "remove", id: "a1", dryRun: true } },
      { userId: "ada", operation: { op: "establish" } },
    ]);
  });

  it.each([
    [
      { kind: "preview", count: 3, unreadable: 1 },
      200,
      { count: 3, unreadable: 1 },
    ],
    [
      { kind: "invalid-name", problem: "blank" },
      400,
      { error: "invalid_name", problem: "blank" },
    ],
    [{ kind: "duplicate" }, 409, { error: "duplicate_name" }],
    [{ kind: "not-found" }, 404, { error: "not_found" }],
    [
      { kind: "count-changed", count: 4, unreadable: 0 },
      409,
      { error: "count_changed", count: 4, unreadable: 0 },
    ],
    [{ kind: "unreadable" }, 422, { error: "unreadable" }],
  ] as const)("answer %j with %i", async (outcome, status, body) => {
    const { handle } = createHandler(outcome as PeopleOutcome);
    const response = await handle(
      send({ method: "POST", body: { op: "remove", id: "a" } }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it("answer a change with the list as saved", async () => {
    const { handle } = createHandler({
      kind: "done",
      people: [{ id: "a", name: "A" }],
      revision: 5,
    });
    const response = await handle(
      send({ method: "POST", body: { op: "add", id: "a", name: "A" } }),
    );
    expect(await response.json()).toEqual({
      people: [{ id: "a", name: "A" }],
      revision: 5,
      established: true,
    });
  });

  it("answer 503 when the store fails, and 422 for a list it cannot read", async () => {
    const { handle, store } = createHandler();
    vi.mocked(store.read).mockRejectedValueOnce(new Error("down"));
    expect((await handle(send())).status).toBe(503);
    vi.mocked(store.read).mockResolvedValueOnce("unreadable");
    expect((await handle(send())).status).toBe(422);
  });

  it("refuse a body that is too large", async () => {
    const { handle } = createHandler();
    const response = await handle(
      send({
        method: "POST",
        body: { op: "add", id: "a", name: "x".repeat(20_000) },
      }),
    );
    expect(response.status).toBe(413);
  });
});
