// @vitest-environment node
import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";

import {
  buildAccountAuthOptions,
  createMemoryRateLimitStorage,
  disabledPaths,
  isEnabledAuthPath,
} from "./account-auth.server";
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
