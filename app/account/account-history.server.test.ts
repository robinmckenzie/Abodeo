// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createHistoryStore,
  handleActivityRequest,
  recordSignInQuietly,
  visitGapMinutes,
  type HistoryStore,
} from "./account-history.server";

function createFakeDatabase(
  respond: (text: string) => { rows: Record<string, unknown>[] } = () => ({
    rows: [],
  }),
) {
  const query = vi.fn<
    (
      text: string,
      values: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>
  >(async (text) => respond(text));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { database: { query, connect }, query, release };
}

function createFakeHistory(overrides: Partial<HistoryStore> = {}) {
  const history = {
    recordSignIn: vi.fn<HistoryStore["recordSignIn"]>(async () => {}),
    recordActivity: vi.fn<HistoryStore["recordActivity"]>(async () => {}),
    ...overrides,
  };
  return history;
}

function postActivity(headers: Record<string, string> = {}, body = "{}") {
  return new Request("http://localhost:5173/api/account/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("createHistoryStore", () => {
  it("adds a sign-in for the account with its label, timed by the database", async () => {
    const { database, query } = createFakeDatabase();
    await createHistoryStore(database).recordSignIn("ada", "Andrew");

    expect(query).toHaveBeenCalledWith(
      "insert into account_sign_in (user_id, label) values ($1, $2)",
      ["ada", "Andrew"],
    );
  });

  it("extends the latest visit of the account and label within the gap, in a locked transaction", async () => {
    const { database, query, release } = createFakeDatabase((text) =>
      text.startsWith("update") ? { rows: [{ id: 1 }] } : { rows: [] },
    );
    await createHistoryStore(database).recordActivity("ada", "Andrew");

    const calls = query.mock.calls;
    expect(calls[0][0]).toBe("begin");
    expect(calls[1][0]).toContain("pg_advisory_xact_lock");
    expect(calls[1][1]).toEqual(["ada", "Andrew"]);
    const [text, values] = calls[2];
    expect(values).toEqual(["ada", "Andrew", visitGapMinutes]);
    expect(text).toContain(
      "update account_visit set last_active_at = clock_timestamp()",
    );
    expect(text).not.toContain("now()");
    expect(text).toContain("user_id = $1 and label = $2");
    expect(text).toContain("make_interval(mins => $3)");
    expect(text).not.toMatch(/ip|agent|device/i);
    expect(calls[3][0]).toBe("commit");
    expect(calls).toHaveLength(4);
    expect(release).toHaveBeenCalledOnce();
  });

  it("starts a visit with the label when none can be extended", async () => {
    const { database, query } = createFakeDatabase();
    await createHistoryStore(database).recordActivity("ada", "");

    const insert = query.mock.calls.find(([text]) =>
      text.includes("insert into account_visit (user_id, label"),
    );
    expect(insert?.[1]).toEqual(["ada", ""]);
    expect(insert?.[0]).toContain("clock_timestamp()");
    expect(insert?.[0]).not.toContain("now()");
  });

  it("locks per account and label, so two labels do not wait for or merge into each other", async () => {
    const { database, query } = createFakeDatabase();
    const history = createHistoryStore(database);
    await history.recordActivity("ada", "Andrew");
    await history.recordActivity("ada", "Robin");

    const locks = query.mock.calls.filter(([text]) =>
      text.includes("pg_advisory_xact_lock"),
    );
    expect(locks.map(([, values]) => values)).toEqual([
      ["ada", "Andrew"],
      ["ada", "Robin"],
    ]);
    const updates = query.mock.calls.filter(([text]) =>
      text.startsWith("update"),
    );
    expect(updates.map(([, values]) => values?.[1])).toEqual([
      "Andrew",
      "Robin",
    ]);
  });

  it("rolls back and releases the connection when a write fails", async () => {
    const { database, query, release } = createFakeDatabase((text) => {
      if (text.startsWith("update")) throw new Error("down");
      return { rows: [] };
    });

    await expect(
      createHistoryStore(database).recordActivity("ada", ""),
    ).rejects.toThrow("down");
    expect(query).toHaveBeenLastCalledWith("rollback", []);
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("recordSignInQuietly", () => {
  it("records the sign-in", async () => {
    const history = createFakeHistory();
    await recordSignInQuietly(history, "ada", "Andrew");
    expect(history.recordSignIn).toHaveBeenCalledWith("ada", "Andrew");
  });

  it("reports only the code of a failed write, and does not throw", async () => {
    const reportFailure = vi.fn();
    const history = createFakeHistory({
      recordSignIn: async () => {
        throw Object.assign(new Error("password=secret"), { code: "42P01" });
      },
    });
    await recordSignInQuietly(history, "ada", "", { reportFailure });
    expect(reportFailure).toHaveBeenCalledWith("42P01");
  });

  it("gives up on a write that never finishes", async () => {
    const reportFailure = vi.fn();
    const history = createFakeHistory({
      recordSignIn: () => new Promise(() => {}),
    });
    await recordSignInQuietly(history, "ada", "", {
      timeout: 10,
      reportFailure,
    });
    expect(reportFailure).toHaveBeenCalledWith(undefined);
  });
});

describe("handleActivityRequest", () => {
  const signedIn = async () => "ada";

  it("records activity for the session's account only", async () => {
    const history = createFakeHistory();
    const response = await handleActivityRequest(
      postActivity({}, JSON.stringify({ userId: "someone-else" })),
      { readSessionUserId: signedIn, history },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(history.recordActivity).toHaveBeenCalledWith("ada", "");
  });

  it("records activity under the label in the cookie", async () => {
    const history = createFakeHistory();
    await handleActivityRequest(
      postActivity({ Cookie: "abodeo_label=Andrew%20B" }),
      { readSessionUserId: signedIn, history },
    );
    expect(history.recordActivity).toHaveBeenCalledWith("ada", "Andrew B");
  });

  it("records an invalid label cookie as empty", async () => {
    const history = createFakeHistory();
    await handleActivityRequest(
      postActivity({ Cookie: "abodeo_label=a%3Cb" }),
      {
        readSessionUserId: signedIn,
        history,
      },
    );
    expect(history.recordActivity).toHaveBeenCalledWith("ada", "");
  });

  it("refuses other methods", async () => {
    const history = createFakeHistory();
    const response = await handleActivityRequest(
      new Request("http://localhost:5173/api/account/activity"),
      { readSessionUserId: signedIn, history },
    );
    expect(response.status).toBe(405);
    expect(history.recordActivity).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON, as a form on another site sends", async () => {
    const history = createFakeHistory();
    const response = await handleActivityRequest(
      postActivity({ "Content-Type": "text/plain" }),
      { readSessionUserId: signedIn, history },
    );
    expect(response.status).toBe(400);
    expect(history.recordActivity).not.toHaveBeenCalled();
  });

  it("records nothing when signed out", async () => {
    const history = createFakeHistory();
    const response = await handleActivityRequest(postActivity(), {
      readSessionUserId: async () => undefined,
      history,
    });
    expect(response.status).toBe(401);
    expect(history.recordActivity).not.toHaveBeenCalled();
  });

  it("answers unavailable when the database fails", async () => {
    const reportFailure = vi.fn();
    const history = createFakeHistory({
      recordActivity: async () => {
        throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
      },
    });
    const response = await handleActivityRequest(postActivity(), {
      readSessionUserId: signedIn,
      history,
      reportFailure,
    });
    expect(response.status).toBe(503);
    expect(reportFailure).toHaveBeenCalledWith("ECONNREFUSED");
  });
});
