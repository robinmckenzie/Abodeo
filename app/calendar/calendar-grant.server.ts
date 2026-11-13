// Asking Google for the Calendar permission, apart from Better Auth's sign-in.
// The browser goes to Google with a state and PKCE verifier that are kept in
// an encrypted cookie, and comes back to the callback, which checks them and
// exchanges Google's code for a token. The token is held only in memory, for
// the one action, and is never saved. The one exception is Robin's grant for
// the demo account (AD #138 Demo Entry And Seed), which asks Google for a
// refresh token to store (see demo-calendar-access.server.ts).
import {
  generateRandomString,
  symmetricDecrypt,
  symmetricEncrypt,
} from "better-auth/crypto";
import { google, verifyGoogleIdToken } from "better-auth/social-providers";

import type { AccountConfig } from "../account/account-config.server";
import { calendarBasePath, calendarCallbackPath } from "./calendar-api";

// Lets Abodeo make its own calendars and manage the events in them, and
// nothing else in the person's Google Calendar.
export const calendarScope =
  "https://www.googleapis.com/auth/calendar.app.created";

export const calendarGrantCookieName = "abodeo_calendar_grant";

// How long the person has to answer Google.
export const calendarGrantLifetime = 10 * 60 * 1000;

// What the cookie holds between the start and Google's return.
export type CalendarGrant = {
  state: string;
  verifier: string;
  // The signed-in account that started the grant.
  userId: string;
  // The browser's IANA time zone, or null if it gave none that is valid.
  timeZone: string | null;
  // The project to return the browser to, or null for the dashboard.
  returnProjectId: string | null;
  // Whether to open the project's new appointment form on return.
  openForm: boolean;
  // Whether this is Robin's grant to store the demo account's access.
  storeAccess: boolean;
  expiresAt: number;
};

// What the callback gets from Google's token endpoint.
export type CalendarTokens = {
  accessToken: string | undefined;
  idToken: string | undefined;
  scopes: string[];
  // When the access token ends, in milliseconds, if Google said.
  accessTokenExpiresAt: number | undefined;
  // Only from a grant that asked for stored access.
  refreshToken?: string;
};

// Google's side of the grant, which the tests stand in for.
export type CalendarGoogle = {
  createAuthorizationURL(input: {
    state: string;
    codeVerifier: string;
    loginHint: string;
    // Asks for a refresh token as well, for stored access.
    storeAccess?: boolean;
  }): Promise<URL>;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<CalendarTokens>;
  // The Google account ID in a verified ID token, or undefined if the token
  // is not valid for Abodeo.
  readIdTokenSubject(idToken: string): Promise<string | undefined>;
  // A new access token from a stored refresh token.
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string | undefined;
    accessTokenExpiresAt: number | undefined;
  }>;
};

export function createCalendarGoogle(config: AccountConfig): CalendarGoogle {
  const redirectURI = `${config.baseUrl}${calendarCallbackPath}`;
  const options = {
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    // Otherwise the helper adds the email and profile permissions.
    disableDefaultScope: true,
  };
  // Google then issues no refresh token.
  const provider = google({ ...options, accessType: "online" });
  // For stored access: Google issues a refresh token, which it does reliably
  // only when it shows its consent screen.
  const offlineProvider = google({
    ...options,
    accessType: "offline",
    prompt: "consent",
  });
  return {
    createAuthorizationURL: ({ state, codeVerifier, loginHint, storeAccess }) =>
      (storeAccess ? offlineProvider : provider).createAuthorizationURL({
        state,
        codeVerifier,
        redirectURI,
        loginHint,
        scopes: ["openid", calendarScope],
        // The helper's includeGrantedScopes: false only leaves the parameter
        // out, so false is sent explicitly: the token then carries only
        // these permissions, not the sign-in ones.
        additionalParams: { include_granted_scopes: "false" },
      }),
    exchangeCode: async ({ code, codeVerifier }) => {
      const tokens = await provider.validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
      });
      return {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        scopes: tokens.scopes ?? [],
        accessTokenExpiresAt: tokens.accessTokenExpiresAt?.getTime(),
        refreshToken: tokens.refreshToken,
      };
    },
    refreshAccessToken: async (refreshToken) => {
      const tokens = await offlineProvider.refreshAccessToken?.(refreshToken);
      return {
        accessToken: tokens?.accessToken,
        accessTokenExpiresAt: tokens?.accessTokenExpiresAt?.getTime(),
      };
    },
    readIdTokenSubject: async (idToken) => {
      const claims = await verifyGoogleIdToken({
        token: idToken,
        audience: config.google.clientId,
      });
      return typeof claims?.sub === "string" ? claims.sub : undefined;
    },
  };
}

function serialiseGrantCookie(
  value: string,
  maxAge: number,
  isSecure: boolean,
) {
  return [
    `${calendarGrantCookieName}=${value}`,
    `Path=${calendarBasePath}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");
}

// A Set-Cookie value that removes the grant cookie.
export function clearCalendarGrantCookie(isSecure: boolean) {
  return serialiseGrantCookie("", 0, isSecure);
}

// Google's address for the grant, and the cookie to set before going there.
export async function startCalendarGrant(
  calendarGoogle: CalendarGoogle,
  {
    secret,
    isSecure,
    userId,
    googleAccountId,
    timeZone,
    returnProjectId = null,
    openForm = false,
    storeAccess = false,
    now,
  }: {
    secret: string;
    isSecure: boolean;
    userId: string;
    // Suggests the signed-in Google account at Google's account chooser.
    googleAccountId: string;
    timeZone: string | null;
    returnProjectId?: string | null;
    openForm?: boolean;
    storeAccess?: boolean;
    now: number;
  },
) {
  const grant: CalendarGrant = {
    state: generateRandomString(32),
    verifier: generateRandomString(128),
    userId,
    timeZone,
    returnProjectId,
    openForm,
    storeAccess,
    expiresAt: now + calendarGrantLifetime,
  };
  const url = await calendarGoogle.createAuthorizationURL({
    state: grant.state,
    codeVerifier: grant.verifier,
    loginHint: googleAccountId,
    storeAccess,
  });
  const value = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify(grant),
  });
  return {
    url: url.toString(),
    cookie: serialiseGrantCookie(
      encodeURIComponent(value),
      calendarGrantLifetime / 1000,
      isSecure,
    ),
  };
}

export function readCookie(cookieHeader: string | null, name: string) {
  for (const part of cookieHeader?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function isCalendarGrant(value: unknown): value is CalendarGrant {
  if (typeof value !== "object" || value === null) return false;
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.state === "string" &&
    typeof grant.verifier === "string" &&
    typeof grant.userId === "string" &&
    (grant.timeZone === null || typeof grant.timeZone === "string") &&
    (grant.returnProjectId === null ||
      typeof grant.returnProjectId === "string") &&
    typeof grant.openForm === "boolean" &&
    typeof grant.storeAccess === "boolean" &&
    typeof grant.expiresAt === "number"
  );
}

// The grant from the request's cookie, or a short code saying why there is
// none that can be used.
export async function readCalendarGrant(
  cookieHeader: string | null,
  secret: string,
  now: number,
): Promise<
  | { grant: CalendarGrant }
  | { problem: "grant_missing" | "grant_unreadable" | "grant_expired" }
> {
  const value = readCookie(cookieHeader, calendarGrantCookieName);
  if (!value) return { problem: "grant_missing" };
  let grant: unknown;
  try {
    grant = JSON.parse(
      await symmetricDecrypt({ key: secret, data: decodeURIComponent(value) }),
    );
  } catch {
    return { problem: "grant_unreadable" };
  }
  if (!isCalendarGrant(grant)) return { problem: "grant_unreadable" };
  if (now >= grant.expiresAt) return { problem: "grant_expired" };
  return { grant };
}
