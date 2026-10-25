// Google's Calendar token, kept for about an hour in a second encrypted
// cookie (AD #70 Add Appointments To Projects), so that the project page can
// list and add appointments without going through Google each time. It is
// HttpOnly and scoped to the Calendar endpoints, so the browser's own code
// never sees it, and it is never saved in the database or logged. The token
// is read only if it was made for the signed-in account.
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

import { calendarBasePath } from "./calendar-api";
import { readCookie } from "./calendar-grant.server";

export const calendarTokenCookieName = "abodeo_calendar_token";

// The longest the cookie is kept. Google's token lasts an hour.
export const calendarTokenLifetime = 55 * 60 * 1000;

// A token with less than this left is treated as near expiry: it is not
// enough to fill in a form with. Tunable.
export const calendarTokenNearExpiry = 5 * 60 * 1000;

type StoredToken = {
  accessToken: string;
  // The account the token was granted for.
  userId: string;
  expiresAt: number;
};

export type CalendarToken = {
  accessToken: string;
  expiresAt: number;
  // Less than calendarTokenNearExpiry is left.
  isNearExpiry: boolean;
};

function serialise(value: string, maxAge: number, isSecure: boolean) {
  return [
    `${calendarTokenCookieName}=${value}`,
    `Path=${calendarBasePath}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");
}

// A Set-Cookie value that removes the token cookie.
export function clearCalendarTokenCookie(isSecure: boolean) {
  return serialise("", 0, isSecure);
}

// The Set-Cookie value that keeps the token until Google's expiry, at most
// calendarTokenLifetime.
export async function createCalendarTokenCookie({
  secret,
  isSecure,
  accessToken,
  userId,
  expiresAt,
  now,
}: {
  secret: string;
  isSecure: boolean;
  accessToken: string;
  userId: string;
  // When Google's token ends, in milliseconds.
  expiresAt: number;
  now: number;
}) {
  const end = Math.min(expiresAt, now + calendarTokenLifetime);
  const maxAge = Math.floor((end - now) / 1000);
  if (maxAge <= 0) return clearCalendarTokenCookie(isSecure);
  const stored: StoredToken = { accessToken, userId, expiresAt: end };
  const value = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify(stored),
  });
  return serialise(encodeURIComponent(value), maxAge, isSecure);
}

function isStoredToken(value: unknown): value is StoredToken {
  if (typeof value !== "object" || value === null) return false;
  const stored = value as Record<string, unknown>;
  return (
    typeof stored.accessToken === "string" &&
    stored.accessToken !== "" &&
    typeof stored.userId === "string" &&
    typeof stored.expiresAt === "number"
  );
}

// The token in the request's cookie, or undefined if there is none, it
// cannot be read, it was made for another account, or it has expired.
export async function readCalendarToken(
  cookieHeader: string | null,
  secret: string,
  userId: string,
  now: number,
): Promise<CalendarToken | undefined> {
  const value = readCookie(cookieHeader, calendarTokenCookieName);
  if (!value) return undefined;
  let stored: unknown;
  try {
    stored = JSON.parse(
      await symmetricDecrypt({ key: secret, data: decodeURIComponent(value) }),
    );
  } catch {
    return undefined;
  }
  if (!isStoredToken(stored) || stored.userId !== userId) return undefined;
  if (now >= stored.expiresAt) return undefined;
  return {
    accessToken: stored.accessToken,
    expiresAt: stored.expiresAt,
    isNearExpiry: stored.expiresAt - now < calendarTokenNearExpiry,
  };
}
