// Calendar access stored for the demo account (AD #138 Demo Entry And Seed),
// so that a demo visitor, who never goes through Google, can still see and
// add appointments. Robin grants it once as the demo account; Google's
// refresh token is kept, encrypted with BETTER_AUTH_SECRET, in the one row of
// the demo_calendar_access table of db/demo-calendar-access.sql. This is the
// only token Abodeo saves: every other account's access lasts only as long as
// its cookie (see calendar-token.server.ts). The token is never logged.
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

import {
  accountStoreTimeout,
  readErrorCode,
  withTimeout,
} from "../account/account-profile.server";
import type { CalendarGoogle } from "./calendar-grant.server";
import {
  createCalendarTokenCookie,
  readCalendarToken,
  unknownTokenLifetime,
  type CalendarToken,
} from "./calendar-token.server";
import { googleCalendarTimeout } from "./google-calendar.server";

export type DemoCalendarAccessStore = {
  // The encrypted refresh token stored for the account, or undefined if none
  // is, as for every account but the demo account.
  readRefreshToken(userId: string): Promise<string | undefined>;
  // Stores the account's encrypted refresh token, replacing any stored before.
  save(userId: string, encryptedRefreshToken: string): Promise<void>;
  // When access was stored, or null if none is.
  readSavedAt(): Promise<Date | null>;
};

// What the Calendar endpoints need for the demo account's stored access.
export type DemoCalendarAccess = {
  store: DemoCalendarAccessStore;
  // Whether the request is Robin's in the demo account, who may store access.
  canManage(headers: Headers, userId: string): Promise<boolean>;
};

// The part of a Postgres pool that the store uses.
type Queryable = {
  query(
    text: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

export function createDemoCalendarAccessStore(
  database: Queryable,
): DemoCalendarAccessStore {
  return {
    async readRefreshToken(userId) {
      const { rows } = await database.query(
        "select refresh_token from demo_calendar_access where user_id = $1",
        [userId],
      );
      const value = rows[0]?.refresh_token;
      return typeof value === "string" ? value : undefined;
    },
    async save(userId, encryptedRefreshToken) {
      await database.query(
        `insert into demo_calendar_access (id, user_id, refresh_token)
         values (true, $1, $2)
         on conflict (id) do update
         set user_id = excluded.user_id,
             refresh_token = excluded.refresh_token, saved_at = now()`,
        [userId, encryptedRefreshToken],
      );
    },
    async readSavedAt() {
      const { rows } = await database.query(
        "select saved_at from demo_calendar_access",
        [],
      );
      return rows.length > 0 ? new Date(String(rows[0].saved_at)) : null;
    },
  };
}

// Encrypts Google's refresh token and stores it for the account.
export async function saveDemoCalendarAccess(
  store: DemoCalendarAccessStore,
  secret: string,
  userId: string,
  refreshToken: string,
) {
  await store.save(
    userId,
    await symmetricEncrypt({ key: secret, data: refreshToken }),
  );
}

export type CalendarAccess = {
  // Google's token for this request, or undefined if there is none to use.
  token: CalendarToken | undefined;
  // The account's access is stored, so it must never be sent to Google: a
  // missing or refused token is then a failure, not a reason to connect.
  hasStoredAccess: boolean;
  // A Set-Cookie value that keeps a token just got from stored access.
  cookie?: string;
};

// Google's token for a Calendar request: the one in the request's cookie, or,
// when that is missing or near its end and the account's access is stored, a
// new one from Google, which never involves the browser.
export async function readCalendarAccess({
  cookieHeader,
  userId,
  secret,
  isSecure,
  google,
  store,
  now,
  timeout = accountStoreTimeout,
  reportFailure,
}: {
  cookieHeader: string | null;
  userId: string;
  secret: string;
  isSecure: boolean;
  google: Pick<CalendarGoogle, "refreshAccessToken">;
  store: DemoCalendarAccessStore;
  now: number;
  timeout?: number;
  reportFailure: (stage: string, code: string | undefined) => void;
}): Promise<CalendarAccess> {
  const fromCookie = await readCalendarToken(cookieHeader, secret, userId, now);
  if (fromCookie && !fromCookie.isNearExpiry) {
    return { token: fromCookie, hasStoredAccess: fromCookie.isStored };
  }
  let encrypted: string | undefined;
  try {
    encrypted = await withTimeout(store.readRefreshToken(userId), timeout);
  } catch (error) {
    // Such as the table not being there yet. Other accounts carry on as if
    // nothing is stored, which for them is true.
    reportFailure("stored_access_read", readErrorCode(error));
  }
  if (encrypted === undefined) {
    return { token: fromCookie, hasStoredAccess: false };
  }
  try {
    const refreshToken = await symmetricDecrypt({
      key: secret,
      data: encrypted,
    });
    const { accessToken, accessTokenExpiresAt } = await withTimeout(
      google.refreshAccessToken(refreshToken),
      googleCalendarTimeout,
    );
    if (!accessToken) throw new Error("no access token");
    const expiresAt = accessTokenExpiresAt ?? now + unknownTokenLifetime;
    const cookie = await createCalendarTokenCookie({
      secret,
      isSecure,
      accessToken,
      userId,
      expiresAt,
      now,
      isStored: true,
    });
    return {
      token: { accessToken, expiresAt, isNearExpiry: false, isStored: true },
      hasStoredAccess: true,
      cookie,
    };
  } catch (error) {
    reportFailure("stored_access_refresh", readErrorCode(error));
    return { token: fromCookie, hasStoredAccess: true };
  }
}
