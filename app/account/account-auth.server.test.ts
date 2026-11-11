// @vitest-environment node
import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { google } from "better-auth/social-providers";
import { describe, expect, it, vi } from "vitest";

import {
  buildAccountAuthOptions,
  buildDatabaseHooks,
  buildGoogleUserInfo,
  createMemoryRateLimitStorage,
  disabledPaths,
  isEnabledAuthPath,
  type SignInCapture,
} from "./account-auth.server";
import { calendarScope } from "../calendar/calendar-grant.server";
import type { HistoryStore } from "./account-history.server";
import {
  createTestAuth,
  signInTestAccount,
  testBaseUrl,
  testConfig,
} from "./test-account.server";

function authRequest(path: string, init: RequestInit = {}) {
  return new Request(`${testBaseUrl}/api/auth${path}`, {
    ...init,
    headers: { Origin: testBaseUrl, ...init.headers },
  });
}

describe("isEnabledAuthPath", () => {
  it("allows the endpoints sign-in uses", () => {
    for (const path of [
      "/api/auth/sign-in/social",
      "/api/auth/callback/google",
      "/api/auth/get-session",
      "/api/auth/sign-out",
    ]) {
      expect(isEnabledAuthPath(path)).toBe(true);
    }
  });

  it("refuses every other path, including disabled and parameterised ones", () => {
    for (const path of [
      ...disabledPaths.map((path) => `/api/auth${path}`),
      "/api/auth/reset-password/some-token",
      "/api/auth/callback/github",
      "/api/auth/sign-in/id-token",
      "/api/auth",
      "/api/auth/",
      "/api/authsign-out",
      "/sign-out",
    ]) {
      expect(isEnabledAuthPath(path)).toBe(false);
    }
  });
});

describe("createAccountAuth", () => {
  it("saves no photo, tokens, scope, IP address or browser details", async () => {
    const { auth, rows } = createTestAuth();
    const context = await auth.$context;
    const { user } = await signInTestAccount(auth);
    await context.internalAdapter.createSession(user.id, false, {
      ipAddress: "203.0.113.7",
      userAgent: "Test browser",
    });

    expect(rows.auth_user).toEqual([
      expect.objectContaining({
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
      }),
    ]);
    expect(rows.auth_account).toEqual([
      expect.objectContaining({
        account_id: "google-sub-1",
        provider_id: "google",
        access_token: null,
        refresh_token: null,
        id_token: null,
        access_token_expires_at: null,
        refresh_token_expires_at: null,
        scope: null,
      }),
    ]);
    expect(rows.auth_session).toHaveLength(2);
    for (const session of rows.auth_session) {
      expect(session).toEqual(
        expect.objectContaining({ ip_address: null, user_agent: null }),
      );
    }
  });

  it("records a sign-in with the label from the request's cookie, or empty", async () => {
    const recordSignIn = vi.fn<HistoryStore["recordSignIn"]>(async () => {});
    const hooks = buildDatabaseHooks({
      recordSignIn,
      recordActivity: async () => {},
    });
    const after = hooks.session.create.after;
    const withCookie = new Request(`${testBaseUrl}/api/auth/callback/google`, {
      headers: { Cookie: "abodeo_label=Andrew%20B" },
    });

    // Better Auth's endpoint context carries the request and its headers.
    await after({ userId: "ada" }, { request: withCookie });
    await after({ userId: "ada" }, { headers: withCookie.headers });
    await after({ userId: "ada" }, { request: new Request(withCookie.url) });
    await after({ userId: "ada" }, undefined);

    expect(recordSignIn.mock.calls).toEqual([
      ["ada", "Andrew B", ""],
      ["ada", "Andrew B", ""],
      ["ada", "", ""],
      ["ada", "", ""],
    ]);
  });

  it("records a demo sign-in with the label and word it captured", async () => {
    const recordSignIn = vi.fn<HistoryStore["recordSignIn"]>(async () => {});
    const hooks = buildDatabaseHooks(
      { recordSignIn, recordActivity: async () => {} },
      { demoUsage: { label: "Acme", word: "qwertyui" } },
    );
    await hooks.session.create.after({ userId: "demo" }, undefined);
    expect(recordSignIn.mock.calls).toEqual([["demo", "Acme", "qwertyui"]]);
  });

  it("lets sign-in complete when its history entry cannot be written", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth, rows } = createTestAuth({
      recordSignIn: async () => {
        throw new Error("history is down");
      },
      recordActivity: async () => {},
    });
    const { cookie } = await signInTestAccount(auth);

    expect(rows.auth_session).toHaveLength(1);
    const session = await auth.handler(
      authRequest("/get-session", { headers: { cookie } }),
    );
    expect(await session.json()).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ name: "Ada Lovelace" }),
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("keeps the photo empty when an account is updated", async () => {
    const { auth, rows } = createTestAuth();
    const context = await auth.$context;
    const { user } = await signInTestAccount(auth);
    await context.internalAdapter.updateUser(user.id, {
      image: "https://example.com/new.jpg",
    });

    expect(rows.auth_user[0]).toEqual(expect.objectContaining({ image: null }));
  });

  it("refuses the old session cookie once signed out", async () => {
    const { auth } = createTestAuth();
    const { cookie } = await signInTestAccount(auth);

    const before = await auth.handler(
      authRequest("/get-session", { headers: { cookie } }),
    );
    expect(await before.json()).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ name: "Ada Lovelace" }),
      }),
    );

    const signOut = await auth.handler(
      authRequest("/sign-out", { method: "POST", headers: { cookie } }),
    );
    expect(signOut.status).toBe(200);

    const after = await auth.handler(
      authRequest("/get-session", { headers: { cookie } }),
    );
    expect(await after.json()).toBeNull();
  });

  it("refuses the endpoint that would let the browser change the stored name", async () => {
    const { auth, rows } = createTestAuth();
    const { cookie } = await signInTestAccount(auth);

    const response = await auth.handler(
      authRequest("/update-user", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Someone else" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(rows.auth_user[0]).toEqual(
      expect.objectContaining({ name: "Ada Lovelace" }),
    );
  });
});

// An unsigned ID token: reading the profile does not check the signature,
// as Better Auth has already checked it by then.
function encodeIdToken(claims: Record<string, unknown>) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.`;
}

describe("buildGoogleUserInfo", () => {
  const idToken = encodeIdToken({
    sub: "google-sub-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    email_verified: true,
    picture: "https://example.com/photo.jpg",
  });
  const expiresAt = new Date("2026-11-03T10:00:00Z");

  it("gives the profile exactly as Better Auth's own Google provider does", async () => {
    const tokens = { idToken, accessToken: "token", scopes: ["openid"] };
    const fallback = google({ clientId: "", clientSecret: "" });

    const info = await buildGoogleUserInfo({})(tokens);

    expect(info).toEqual(await fallback.getUserInfo(tokens));
    expect(info?.user).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: "https://example.com/photo.jpg",
      emailVerified: true,
    });
  });

  it("keeps the access token when Calendar was allowed", async () => {
    const capture: SignInCapture = {};

    await buildGoogleUserInfo(capture)({
      idToken,
      accessToken: "calendar-token",
      accessTokenExpiresAt: expiresAt,
      scopes: ["openid", "email", "profile", calendarScope],
    });

    expect(capture).toEqual({
      calendarToken: {
        accessToken: "calendar-token",
        expiresAt: expiresAt.getTime(),
      },
    });
  });

  it("keeps nothing when Calendar was declined", async () => {
    const capture: SignInCapture = {};

    await buildGoogleUserInfo(capture)({
      idToken,
      accessToken: "sign-in-token",
      accessTokenExpiresAt: expiresAt,
      scopes: ["openid", "email", "profile"],
    });

    expect(capture).toEqual({});
  });
});

describe("buildDatabaseHooks", () => {
  it("records the signed-in account for the Calendar token, with or without history", async () => {
    const withHistory: SignInCapture = {};
    const withoutHistory: SignInCapture = {};
    const history: HistoryStore = {
      recordSignIn: async () => {},
      recordActivity: async () => {},
    };

    await buildDatabaseHooks(history, withHistory).session.create.after(
      { userId: "ada" },
      undefined,
    );
    await buildDatabaseHooks(undefined, withoutHistory).session.create.after(
      { userId: "ada" },
      undefined,
    );

    expect(withHistory).toEqual({ userId: "ada" });
    expect(withoutHistory).toEqual({ userId: "ada" });
  });
});

describe("logAccountAuthMessage", () => {
  it("is Better Auth's logger, and logs only the level", () => {
    const { logger }: BetterAuthOptions = buildAccountAuthOptions(
      testConfig,
      memoryAdapter({}),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      logger?.log?.(
        "error",
        "postgres://user:password@host refused",
        new Error("detail"),
      );
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        '{"type":"account_auth_log","level":"error"}',
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("createMemoryRateLimitStorage", () => {
  it("allows up to the limit in a window, then refuses until it ends", async () => {
    let time = 0;
    const storage = createMemoryRateLimitStorage(() => time);
    const rule = { window: 10, max: 2 };

    expect(await storage.consume("key", rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await storage.consume("key", rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    time = 4000;
    expect(await storage.consume("key", rule)).toEqual({
      allowed: false,
      retryAfter: 6,
    });
    expect(await storage.consume("other", rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    time = 10_000;
    expect(await storage.consume("key", rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
  });
});
