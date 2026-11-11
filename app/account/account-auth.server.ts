// Better Auth, set up for Google sign-in only, with the tables in
// db/account-tables.sql. Database hooks make sure that nothing beyond
// Google's account ID, name and email is ever saved: no tokens, photo, IP
// address or browser details. Ported from TaskManager's TM #45. Each new
// session, which only a sign-in makes, is added to the sign-in history.
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { google } from "better-auth/social-providers";

import { calendarScope } from "../calendar/calendar-grant.server";

import { accountReturnPath, authBasePath } from "./account-api";
import type { AccountConfig } from "./account-config.server";
import {
  recordSignInQuietly,
  type HistoryStore,
} from "./account-history.server";
import { readLabel } from "./usage-label.server";
import { readVisitorWord } from "./visitor-word.server";

// The only Better Auth endpoints served. Requests for any other path are
// refused before they reach Better Auth, which also covers endpoints a later
// version might add.
const enabledPaths: readonly string[] = [
  "/sign-in/social",
  "/callback/google",
  "/get-session",
  "/sign-out",
  "/error",
  "/ok",
];

export function isEnabledAuthPath(pathname: string) {
  return (
    pathname.startsWith(`${authBasePath}/`) &&
    enabledPaths.includes(pathname.slice(authBasePath.length))
  );
}

// Better Auth 1.7.7's own endpoints that the app does not use, disabled in
// Better Auth as well. /update-user matters most: it would let the browser
// change the stored name and photo. Better Auth matches these exactly, so a
// path with a parameter cannot be listed; isEnabledAuthPath covers those.
export const disabledPaths = [
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

// Account fields that would hold Google's tokens. They are always saved empty.
export const emptyAccountTokens = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
};

// Run before each record is saved. Their data is merged over what Better
// Auth was about to save.
export const accountDatabaseHooks = {
  user: {
    create: { before: async () => ({ data: { image: null } }) },
    update: { before: async () => ({ data: { image: null } }) },
  },
  account: {
    create: { before: async () => ({ data: emptyAccountTokens }) },
    update: { before: async () => ({ data: emptyAccountTokens }) },
  },
  session: {
    create: {
      before: async () => ({ data: { ipAddress: null, userAgent: null } }),
    },
    update: {
      before: async () => ({ data: { ipAddress: null, userAgent: null } }),
    },
  },
} satisfies BetterAuthOptions["databaseHooks"];

// Better Auth's names for the tables and columns in db/account-tables.sql.
const tableNames = {
  user: {
    modelName: "auth_user",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "auth_session",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
  },
  account: {
    modelName: "auth_account",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "auth_verification",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
};

type RateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

// Rate limit counts held in this server instance's memory. The auth instance
// is made afresh for each request, so the counts are kept here rather than in
// Better Auth's own memory store. Each server instance counts separately.
export function createMemoryRateLimitStorage(
  now: () => number = Date.now,
): RateLimitStorage {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    consume: async (key, { window, max }) => {
      const time = now();
      const windowMs = window * 1000;
      // Expired windows are dropped as they are met, so the map stays small.
      for (const [storedKey, stored] of windows) {
        if (time - stored.startedAt >= windowMs) windows.delete(storedKey);
      }
      const current = windows.get(key);
      if (!current) {
        windows.set(key, { startedAt: time, count: 1 });
        return { allowed: true, retryAfter: null };
      }
      if (current.count >= max) {
        return {
          allowed: false,
          retryAfter: Math.ceil((current.startedAt + windowMs - time) / 1000),
        };
      }
      current.count += 1;
      return { allowed: true, retryAfter: null };
    },
  };
}

const rateLimitStorage = createMemoryRateLimitStorage();

// Logs only the level of Better Auth's own warnings and errors, as their
// messages can carry database or provider details.
export function logAccountAuthMessage(level: string) {
  console.error(JSON.stringify({ type: "account_auth_log", level }));
}

// What Better Auth reads and writes through: a Postgres pool, or a test
// adapter.
export type AccountDatabase = BetterAuthOptions["database"];

// The part of Better Auth's endpoint context that carries the sign-in
// request's headers, including the label cookie.
type SignInContext = { request?: Request; headers?: Headers };

// What one sign-in's callback learns, for the account handler to turn into
// the Calendar token cookie (AD #115 Open Projects Without Calendar
// Connection Interruptions). It lives only for the one request.
export type SignInCapture = {
  calendarToken?: { accessToken: string; expiresAt: number };
  userId?: string;
  // The label and word of a /demo sign-in (AD #138), which has no browser
  // headers for the session hook to read.
  demoUsage?: { label: string; word: string };
};

type GoogleTokens = {
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  scopes?: string[];
  idToken?: string;
};

// Better Auth's own reading of Google's ID token, plus keeping the access
// token in the capture when the person allowed Calendar.
export function buildGoogleUserInfo(capture: SignInCapture) {
  // Better Auth's Google provider without this override, for its default.
  const defaultUserInfo = (tokens: GoogleTokens) =>
    google({ clientId: "", clientSecret: "" }).getUserInfo(tokens);
  return async (tokens: GoogleTokens) => {
    if (
      tokens.accessToken &&
      tokens.accessTokenExpiresAt &&
      tokens.scopes?.includes(calendarScope)
    ) {
      capture.calendarToken = {
        accessToken: tokens.accessToken,
        expiresAt: tokens.accessTokenExpiresAt.getTime(),
      };
    }
    return defaultUserInfo(tokens);
  };
}

// The hooks above, plus recording each sign-in once its session is saved.
export function buildDatabaseHooks(
  history: HistoryStore | undefined,
  capture?: SignInCapture,
) {
  return {
    ...accountDatabaseHooks,
    session: {
      ...accountDatabaseHooks.session,
      create: {
        ...accountDatabaseHooks.session.create,
        after: async (
          session: { userId: string },
          context?: SignInContext | null,
        ) => {
          if (capture) capture.userId = session.userId;
          if (!history) return;
          const headers = context?.request?.headers ?? context?.headers;
          await recordSignInQuietly(
            history,
            session.userId,
            capture?.demoUsage?.label ?? readLabel(headers),
            capture?.demoUsage?.word ?? readVisitorWord(headers),
          );
        },
      },
    },
  } satisfies BetterAuthOptions["databaseHooks"];
}

export function buildAccountAuthOptions(
  config: AccountConfig,
  database: AccountDatabase,
  history?: HistoryStore,
  capture: SignInCapture = {},
) {
  return {
    appName: "Abodeo",
    basePath: authBasePath,
    baseURL: config.baseUrl,
    secret: config.secret,
    database,
    telemetry: { enabled: false },
    logger: { log: logAccountAuthMessage },
    disabledPaths,
    socialProviders: {
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        // Sign-in only through Google's redirect, never by posting an ID
        // token.
        disableIdTokenSignIn: true,
        // Google always asks which account to use, rather than signing in
        // again with the last one.
        prompt: "select_account",
        // Sign-in also asks for Calendar in the same trip to Google, so a
        // project can list appointments without a separate trip. No
        // refresh token is asked for, so the token lasts about an hour.
        scope: [calendarScope],
        // Sign-in asks only for the permissions listed here, never
        // inheriting a wider grant given earlier.
        includeGrantedScopes: false,
        getUserInfo: buildGoogleUserInfo(capture),
      },
    },
    user: tableNames.user,
    session: {
      ...tableNames.session,
      // Every request checks the session row, so signing out takes effect
      // at once.
      cookieCache: { enabled: false },
    },
    account: {
      ...tableNames.account,
      // Name and email are kept from the first sign-in, and tokens are never
      // refreshed.
      updateAccountOnSignIn: false,
      accountLinking: { enabled: false },
    },
    verification: tableNames.verification,
    databaseHooks: buildDatabaseHooks(history, capture),
    rateLimit: { enabled: true, customStorage: rateLimitStorage },
    onAPIError: { errorURL: accountReturnPath },
  } satisfies BetterAuthOptions;
}

export function createAccountAuth(
  config: AccountConfig,
  database: AccountDatabase,
  history?: HistoryStore,
  capture?: SignInCapture,
) {
  return betterAuth(
    buildAccountAuthOptions(config, database, history, capture),
  );
}

export type AccountAuth = ReturnType<typeof createAccountAuth>;
