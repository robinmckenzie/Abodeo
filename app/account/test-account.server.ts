// Helpers for the account tests: a real Better Auth instance with the app's
// options, keeping its rows in memory instead of in Neon.
import { memoryAdapter } from "better-auth/adapters/memory";
import { makeSignature } from "better-auth/crypto";

import { createAccountAuth } from "./account-auth.server";
import type { AccountConfig } from "./account-config.server";

export const testBaseUrl = "http://localhost:5173";

export const testConfig: AccountConfig = {
  deployment: "local",
  databaseUrl: "postgres://unused",
  secret: "test-secret-that-is-long-enough-for-better-auth",
  google: { clientId: "client-id", clientSecret: "client-secret" },
  baseUrl: testBaseUrl,
};

export function createTestAuth() {
  const rows: Record<string, Record<string, unknown>[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
  };
  return { auth: createAccountAuth(testConfig, memoryAdapter(rows)), rows };
}

type TestAuth = ReturnType<typeof createTestAuth>["auth"];

// An account with a session, as a completed Google sign-in makes, given
// everything Google gives, to show what is kept. Gives its session cookie.
export async function signInTestAccount(
  auth: TestAuth,
  {
    name = "Ada Lovelace",
    email = "ada@example.com",
    sub = "google-sub-1",
  } = {},
) {
  const context = await auth.$context;
  const { user } = await context.internalAdapter.createOAuthUser(
    {
      name,
      email,
      emailVerified: true,
      image: "https://example.com/photo.jpg",
    },
    {
      providerId: "google",
      accountId: sub,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      scope: "openid,email,profile",
    },
  );
  const session = await context.internalAdapter.createSession(user.id);
  const signature = await makeSignature(session.token, context.secret);
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(
    `${session.token}.${signature}`,
  )}`;
  return { user, cookie };
}
