// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventEmitter } from "node:events";

import {
  createAccountRequestHandler,
  listenForPoolErrors,
  type AccountRuntime,
} from "./account-handler.server";
import type { HistoryStore } from "./account-history.server";
import {
  handleProfileRequest,
  type ProfileStore,
} from "./account-profile.server";
import {
  createTestAuth,
  signInTestAccount,
  testBaseUrl,
} from "./test-account.server";
import { createFakeCalendarDependencies } from "../calendar/test-calendar.server";
import { createMemoryImageStore } from "../projects/test-image-store.server";
import { createMemoryProjectStore } from "../projects/test-projects.server";

afterEach(() => {
  vi.restoreAllMocks();
});

function createMemoryProfileStore() {
  const names = new Map<string, string>();
  const store: ProfileStore = {
    read: async (userId) => names.get(userId) ?? null,
    write: async (userId, name) => {
      if (name === null) names.delete(userId);
      else names.set(userId, name);
    },
  };
  return { names, store };
}

// The account ids of each recorded sign-in and activity, in order.
function createMemoryHistory() {
  const signIns: string[] = [];
  const activity: string[] = [];
  const history: HistoryStore = {
    recordSignIn: async (userId) => void signIns.push(userId),
    recordActivity: async (userId) => void activity.push(userId),
  };
  return { signIns, activity, history };
}

function createTestHandler() {
  const { signIns, activity, history } = createMemoryHistory();
  const { auth, rows } = createTestAuth(history);
  const { names, store } = createMemoryProfileStore();
  const close = vi.fn(async () => {});
  const calendar = createFakeCalendarDependencies();
  const projectStore = createMemoryProjectStore();
  const runtime: AccountRuntime = {
    handleAuthRequest: (request) => auth.handler(request),
    readSessionUserId: async (headers) =>
      (await auth.api.getSession({ headers }))?.user.id,
    profiles: store,
    history,
    projects: projectStore.store,
    images: createMemoryImageStore().store,
    calendar: calendar.dependencies,
    close,
  };
  const handle = createAccountRequestHandler(
    () => runtime,
    () => true,
    () => {},
  );
  return {
    auth,
    rows,
    names,
    handle,
    close,
    calendar,
    signIns,
    activity,
    projectStore,
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${testBaseUrl}${path}`, {
    ...init,
    headers: { Origin: testBaseUrl, ...init.headers },
  });
}

function putProfile(cookie: string, body: unknown, query = "") {
  return request(`/api/account/profile${query}`, {
    method: "PUT",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createAccountRequestHandler", () => {
  it("reports whether sign-in is configured", async () => {
    const configured = createAccountRequestHandler(
      () => undefined,
      () => true,
    );
    const notConfigured = createAccountRequestHandler(
      () => undefined,
      () => false,
    );

    const yes = await configured(request("/api/account/status"));
    const no = await notConfigured(request("/api/account/status"));

    expect(await yes.json()).toEqual({ configured: true });
    expect(await no.json()).toEqual({ configured: false });
  });

  it("reports sign-in and the profile as unavailable when not configured", async () => {
    const handle = createAccountRequestHandler(
      () => undefined,
      () => false,
    );

    for (const path of ["/api/auth/get-session", "/api/account/profile"]) {
      const response = await handle(request(path));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "unavailable" });
    }
  });

  it("returns the browser to the dashboard when Google's return cannot be completed", async () => {
    vi.useFakeTimers();
    try {
      const handle = createAccountRequestHandler(
        () => ({
          handleAuthRequest: () => new Promise(() => {}),
          readSessionUserId: async () => undefined,
          profiles: createMemoryProfileStore().store,
          history: createMemoryHistory().history,
          projects: createMemoryProjectStore().store,
          images: createMemoryImageStore().store,
          calendar: createFakeCalendarDependencies().dependencies,
          close: async () => {},
        }),
        () => true,
        () => {},
      );

      const response = handle(
        request("/api/auth/callback/google?code=c&state=s"),
      );
      await vi.advanceTimersByTimeAsync(10_000);

      expect((await response).status).toBe(302);
      expect((await response).headers.get("Location")).toBe(
        `${testBaseUrl}/dashboard?error=unavailable`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the browser to the dashboard when Better Auth answers Google's return with an error", async () => {
    const handle = createAccountRequestHandler(
      () => ({
        handleAuthRequest: async () => new Response(null, { status: 500 }),
        readSessionUserId: async () => undefined,
        profiles: createMemoryProfileStore().store,
        history: createMemoryHistory().history,
        projects: createMemoryProjectStore().store,
        images: createMemoryImageStore().store,
        calendar: createFakeCalendarDependencies().dependencies,
        close: async () => {},
      }),
      () => true,
      () => {},
    );

    const response = await handle(request("/api/auth/callback/google"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${testBaseUrl}/dashboard?error=unavailable`,
    );
  });

  it("refuses to start sign-in from a request that is not JSON, as a form on another site sends", async () => {
    const { handle, rows } = createTestHandler();

    const response = await handle(
      request("/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          Origin: "https://elsewhere.example",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "provider=google",
      }),
    );

    expect(response.status).toBe(400);
    expect(rows.auth_verification).toEqual([]);
  });

  it("refuses addresses the app does not use, before opening the database", async () => {
    const openRuntime = vi.fn(() => undefined);
    const handle = createAccountRequestHandler(openRuntime, () => true);

    for (const path of [
      "/api/auth/update-user",
      "/api/auth/list-accounts",
      "/api/auth/sign-in/email",
      "/api/other",
    ]) {
      expect((await handle(request(path, { method: "POST" }))).status).toBe(
        404,
      );
    }
    expect(openRuntime).not.toHaveBeenCalled();
  });

  it("asks Google which account to use every time", async () => {
    const { handle } = createTestHandler();

    const response = await handle(
      request("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      }),
    );

    const { url } = (await response.json()) as { url: string };
    expect(new URL(url).searchParams.get("prompt")).toBe("select_account");
  });

  it("does not add permissions given earlier, such as the Calendar one, to sign-in", async () => {
    const { handle } = createTestHandler();

    const response = await handle(
      request("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      }),
    );

    const { url } = (await response.json()) as { url: string };
    expect(new URL(url).searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("starts the Calendar test for the signed-in account", async () => {
    const { auth, handle, calendar } = createTestHandler();
    const ada = await signInTestAccount(auth);
    calendar.store.googleAccounts.set(ada.user.id, "google-sub-1");

    const signedIn = await handle(
      request("/api/calendar/test-appointment", {
        method: "POST",
        headers: { cookie: ada.cookie, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    const signedOut = await handle(
      request("/api/calendar/test-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(signedIn.status).toBe(200);
    const { url } = (await signedIn.json()) as { url: string };
    expect(new URL(url).searchParams.get("login_hint")).toBe("google-sub-1");
    expect(signedIn.headers.get("Set-Cookie")).toContain(
      "abodeo_calendar_grant=",
    );
    expect(signedOut.status).toBe(401);
  });

  it("reports the Calendar test as unavailable when sign-in is not configured", async () => {
    const handle = createAccountRequestHandler(
      () => undefined,
      () => false,
    );

    const start = await handle(
      request("/api/calendar/test-appointment", { method: "POST" }),
    );
    const callback = await handle(request("/api/calendar/callback?code=c"));
    const other = await handle(request("/api/calendar/other"));

    expect(start.status).toBe(503);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe(
      `${testBaseUrl}/dashboard?calendar=failed`,
    );
    expect(other.status).toBe(404);
  });

  it("asks Google only for basic permissions and returns to the dashboard, whatever the page asks", async () => {
    const { handle, rows } = createTestHandler();

    const response = await handle(
      request("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          scopes: ["https://www.googleapis.com/auth/calendar"],
          callbackURL: "https://elsewhere.example/",
          errorCallbackURL: "https://elsewhere.example/",
          requestSignUp: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const google = new URL(url);
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      "openid",
      "profile",
    ]);
    expect(google.searchParams.get("redirect_uri")).toBe(
      `${testBaseUrl}/api/auth/callback/google`,
    );
    const saved = JSON.stringify(rows.auth_verification);
    expect(saved).toContain('\\"callbackURL\\":\\"/dashboard\\"');
    expect(saved).toContain('\\"errorURL\\":\\"/dashboard\\"');
    expect(saved).not.toContain("elsewhere");
  });

  it("reads and changes only the signed-in account's profile", async () => {
    const { auth, handle, names } = createTestHandler();
    const ada = await signInTestAccount(auth);
    const grace = await signInTestAccount(auth, {
      name: "Grace Hopper",
      email: "grace@example.com",
      sub: "google-sub-2",
    });
    names.set(grace.user.id, "Grace");

    const read = await handle(
      request(`/api/account/profile?userId=${grace.user.id}`, {
        headers: { cookie: ada.cookie },
      }),
    );
    expect(await read.json()).toEqual({ preferredName: null });

    const write = await handle(
      putProfile(
        ada.cookie,
        { preferredName: "  Ada  ", userId: grace.user.id },
        `?userId=${grace.user.id}`,
      ),
    );
    expect(await write.json()).toEqual({ preferredName: "Ada" });
    expect(names.get(ada.user.id)).toBe("Ada");
    expect(names.get(grace.user.id)).toBe("Grace");

    const cleared = await handle(
      putProfile(ada.cookie, { preferredName: null }),
    );
    expect(await cleared.json()).toEqual({ preferredName: null });
    expect(names.has(ada.user.id)).toBe(false);
  });

  it("refuses profile requests without a valid sign-in", async () => {
    const { auth, handle, names } = createTestHandler();
    const ada = await signInTestAccount(auth);

    const withNoCookie = await handle(request("/api/account/profile"));
    const withForgedCookie = await handle(
      request("/api/account/profile", {
        headers: { cookie: ada.cookie.replace(/.{6}$/, "AAAAAA") },
      }),
    );
    const writeWithNoCookie = await handle(
      putProfile("", { preferredName: "Mallory", userId: ada.user.id }),
    );

    expect(withNoCookie.status).toBe(401);
    expect(withForgedCookie.status).toBe(401);
    expect(writeWithNoCookie.status).toBe(401);
    expect(names.size).toBe(0);
  });

  it("refuses a profile request that uses a session after signing out", async () => {
    const { auth, handle } = createTestHandler();
    const ada = await signInTestAccount(auth);

    const signOut = await handle(
      request("/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: ada.cookie },
      }),
    );
    expect(signOut.status).toBe(200);

    const after = await handle(
      request("/api/account/profile", { headers: { cookie: ada.cookie } }),
    );
    expect(after.status).toBe(401);
  });

  it("reaches only the signed-in account's projects, and none after signing out", async () => {
    const { auth, handle, projectStore } = createTestHandler();
    const ada = await signInTestAccount(auth);
    const grace = await signInTestAccount(auth, {
      name: "Grace Hopper",
      email: "grace@example.com",
      sub: "google-sub-2",
    });
    const projectRequest = (
      who: typeof ada,
      path: string,
      init: RequestInit = {},
    ) =>
      request(path, {
        ...init,
        headers: {
          cookie: who.cookie,
          "X-Abodeo-Account": who.user.id,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

    const created = await handle(
      projectRequest(ada, "/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: "p1",
          userId: grace.user.id,
          fields: {
            title: "Ada's shed",
            notes: "",
            assignee: "andy",
            dueDate: null,
            tasks: [],
          },
        }),
      }),
    );
    expect(created.status).toBe(200);
    expect([...projectStore.accounts.keys()]).toEqual([ada.user.id]);

    const graceList = await handle(projectRequest(grace, "/api/projects"));
    expect((await graceList.json()).projects).toEqual([]);
    const graceRead = await handle(projectRequest(grace, "/api/projects/p1"));
    expect(graceRead.status).toBe(404);
    // Naming Ada's account does not make Grace's session Ada's.
    const pretending = await handle(
      projectRequest(grace, "/api/projects", {
        headers: { "X-Abodeo-Account": ada.user.id },
      }),
    );
    expect(pretending.status).toBe(409);

    await handle(
      request("/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: ada.cookie },
      }),
    );
    const after = await handle(projectRequest(ada, "/api/projects"));
    expect(after.status).toBe(401);
  });

  it("refuses a profile change that is not JSON or not a valid name", async () => {
    const { auth, handle } = createTestHandler();
    const ada = await signInTestAccount(auth);

    const asForm = await handle(
      request("/api/account/profile", {
        method: "PUT",
        headers: {
          cookie: ada.cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "preferredName=Ada",
      }),
    );
    const tooLong = await handle(
      putProfile(ada.cookie, { preferredName: "x".repeat(51) }),
    );
    const blank = await handle(putProfile(ada.cookie, { preferredName: "  " }));

    expect([asForm.status, tooLong.status, blank.status]).toEqual([
      400, 400, 400,
    ]);
  });

  it("records each sign-in, and keeps it after signing out", async () => {
    const { auth, handle, signIns } = createTestHandler();
    const ada = await signInTestAccount(auth);
    const grace = await signInTestAccount(auth, {
      name: "Grace Hopper",
      email: "grace@example.com",
      sub: "google-sub-2",
    });

    await handle(
      request("/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: ada.cookie },
      }),
    );

    expect(signIns).toEqual([ada.user.id, grace.user.id]);
  });

  it("records activity for the signed-in account, and none after signing out", async () => {
    const { auth, handle, activity } = createTestHandler();
    const ada = await signInTestAccount(auth);
    const postActivity = () =>
      handle(
        request("/api/account/activity", {
          method: "POST",
          headers: { cookie: ada.cookie, "Content-Type": "application/json" },
          body: "{}",
        }),
      );

    expect((await postActivity()).status).toBe(204);
    await handle(
      request("/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: ada.cookie },
      }),
    );
    expect((await postActivity()).status).toBe(401);

    expect(activity).toEqual([ada.user.id]);
  });

  it("closes the database after each request", async () => {
    const { handle, close } = createTestHandler();

    await handle(request("/api/auth/get-session"));

    expect(close).toHaveBeenCalledOnce();
  });

  it("reports sign-in as unavailable when the account store fails", async () => {
    const reportFailure = vi.fn();
    const handle = createAccountRequestHandler(
      () => ({
        handleAuthRequest: async () => {
          throw Object.assign(new Error("postgres://secret refused"), {
            code: "ECONNREFUSED",
          });
        },
        readSessionUserId: async () => undefined,
        profiles: createMemoryProfileStore().store,
        history: createMemoryHistory().history,
        projects: createMemoryProjectStore().store,
        images: createMemoryImageStore().store,
        calendar: createFakeCalendarDependencies().dependencies,
        close: async () => {},
      }),
      () => true,
      reportFailure,
    );

    const response = await handle(request("/api/auth/get-session"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(reportFailure).toHaveBeenCalledWith("ECONNREFUSED");
  });

  it("answers without waiting for a database that does not close", async () => {
    vi.useFakeTimers();
    try {
      const handle = createAccountRequestHandler(
        () => ({
          handleAuthRequest: async () => Response.json(null),
          readSessionUserId: async () => undefined,
          profiles: createMemoryProfileStore().store,
          history: createMemoryHistory().history,
          projects: createMemoryProjectStore().store,
          images: createMemoryImageStore().store,
          calendar: createFakeCalendarDependencies().dependencies,
          close: () => new Promise(() => {}),
        }),
        () => true,
      );

      const response = handle(request("/api/auth/get-session"));
      await vi.advanceTimersByTimeAsync(1000);

      expect((await response).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleProfileRequest", () => {
  it("reports the profile as unavailable when the store does not answer", async () => {
    const reportFailure = vi.fn();

    const response = await handleProfileRequest(
      request("/api/account/profile"),
      {
        readSessionUserId: async () => "ada",
        store: { read: () => new Promise(() => {}), write: async () => {} },
        timeout: 10,
        reportFailure,
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(reportFailure).toHaveBeenCalledWith(undefined);
  });

  it("reports the profile as unavailable when the session lookup does not answer", async () => {
    const response = await handleProfileRequest(
      request("/api/account/profile"),
      {
        readSessionUserId: () => new Promise(() => {}),
        store: createMemoryProfileStore().store,
        timeout: 10,
        reportFailure: () => {},
      },
    );

    expect(response.status).toBe(503);
  });
});

describe("listenForPoolErrors", () => {
  it("reports only the error code and does not throw", () => {
    const pool = new EventEmitter();
    const reportFailure = vi.fn();
    listenForPoolErrors(pool as never, reportFailure);
    expect(() =>
      pool.emit(
        "error",
        Object.assign(new Error("secret host"), { code: "57P01" }),
      ),
    ).not.toThrow();
    expect(reportFailure).toHaveBeenCalledWith("57P01");
  });

  it("reports no code for an error without one", () => {
    const pool = new EventEmitter();
    const reportFailure = vi.fn();
    listenForPoolErrors(pool as never, reportFailure);
    pool.emit("error", new Error("Unhandled error"));
    expect(reportFailure).toHaveBeenCalledWith(undefined);
  });
});
