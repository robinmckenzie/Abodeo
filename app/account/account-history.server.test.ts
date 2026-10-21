// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createHistoryStore,
  handleActivityRequest,
  recordSignInQuietly,
  visitGapMinutes,
  type HistoryStore,
} from "./account-history.server";

function createFakeDatabase() {
  const query = vi.fn<
    (text: string, values: unknown[]) => Promise<{ rows: [] }>
  >(async () => ({ rows: [] }));
  return { database: { query }, query };
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
  it("adds a sign-in for the account, timed by the database", async () => {
    const { database, query } = createFakeDatabase();
    await createHistoryStore(database).recordSignIn("ada");

    expect(query).toHaveBeenCalledWith(
      "insert into account_sign_in (user_id) values ($1)",
      ["ada"],
    );
  });

  it("extends the latest visit within the gap, or starts one, in one statement", async () => {
    const { database, query } = createFakeDatabase();
    await createHistoryStore(database).recordActivity("ada");

    expect(query).toHaveBeenCalledTimes(1);
    const [text, values] = query.mock.calls[0];
    expect(values).toEqual(["ada", visitGapMinutes]);
    expect(text).toContain("update account_visit set last_active_at = now()");
    expect(text).toContain("make_interval(mins => $2)");
    expect(text).toContain("insert into account_visit (user_id)");
    expect(text).not.toMatch(/ip|agent|device/i);
  });
});

describe("recordSignInQuietly", () => {
  it("records the sign-in", async () => {
    const history = createFakeHistory();
    await recordSignInQuietly(history, "ada");
    expect(history.recordSignIn).toHaveBeenCalledWith("ada");
  });

  it("reports only the code of a failed write, and does not throw", async () => {
    const reportFailure = vi.fn();
    const history = createFakeHistory({
      recordSignIn: async () => {
        throw Object.assign(new Error("password=secret"), { code: "42P01" });
      },
    });
    await recordSignInQuietly(history, "ada", { reportFailure });
    expect(reportFailure).toHaveBeenCalledWith("42P01");
  });

  it("gives up on a write that never finishes", async () => {
    const reportFailure = vi.fn();
    const history = createFakeHistory({
      recordSignIn: () => new Promise(() => {}),
    });
    await recordSignInQuietly(history, "ada", { timeout: 10, reportFailure });
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
    expect(history.recordActivity).toHaveBeenCalledWith("ada");
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
