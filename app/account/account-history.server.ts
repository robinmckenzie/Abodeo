// The sign-in and visit history (AD #46 Sign-in History), in the
// account_sign_in and account_visit tables of db/account-tables.sql. Only the
// account and the server's own times are kept: nothing from the browser, its
// clock, its address or its details.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithError,
  withTimeout,
  type Queryable,
  type ReadSessionUserId,
} from "./account-profile.server";

// A visit ends after this long without a click or keypress, so that later
// activity starts a new one. A provisional default.
export const visitGapMinutes = 10;

// How long a sign-in waits for its history entry before carrying on without
// it.
export const signInRecordTimeout = 3000;

export type HistoryStore = {
  recordSignIn(userId: string): Promise<void>;
  // Extends the account's latest visit, or starts a new one if it has been
  // idle for visitGapMinutes or more.
  recordActivity(userId: string): Promise<void>;
};

export function createHistoryStore(database: Queryable): HistoryStore {
  return {
    async recordSignIn(userId) {
      await database.query(
        "insert into account_sign_in (user_id) values ($1)",
        [userId],
      );
    },
    async recordActivity(userId) {
      await database.query(
        `with extended as (
           update account_visit set last_active_at = now()
           where id = (
             select id from account_visit where user_id = $1
             order by last_active_at desc limit 1
           )
           and last_active_at > now() - make_interval(mins => $2)
           returning id
         )
         insert into account_visit (user_id)
         select $1 where not exists (select 1 from extended)`,
        [userId, visitGapMinutes],
      );
    },
  };
}

function reportHistoryFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_history_failed", code }));
}

// Records a sign-in without ever stopping it: a failed or slow write loses
// that entry rather than the sign-in.
export async function recordSignInQuietly(
  history: HistoryStore,
  userId: string,
  {
    timeout = signInRecordTimeout,
    reportFailure = reportHistoryFailure,
  }: {
    timeout?: number;
    reportFailure?: (code: string | undefined) => void;
  } = {},
) {
  try {
    await withTimeout(history.recordSignIn(userId), timeout);
  } catch (error) {
    reportFailure(readErrorCode(error));
  }
}

export type ActivityRequestDependencies = {
  readSessionUserId: ReadSessionUserId;
  history: HistoryStore;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

// Handles POST of accountActivityPath. Whose visit is recorded comes only
// from the session cookie, and the body is never read.
export async function handleActivityRequest(
  request: Request,
  {
    readSessionUserId,
    history,
    timeout = accountStoreTimeout,
    reportFailure = reportHistoryFailure,
  }: ActivityRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return respondWithError(405, "method_not_allowed");
  }
  // A form on another site cannot send JSON, so it cannot add to the history.
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return respondWithError(400, "invalid_request");
  }
  try {
    const userId = await withTimeout(
      readSessionUserId(request.headers),
      timeout,
    );
    if (userId === undefined) return respondWithError(401, "not_signed_in");
    await withTimeout(history.recordActivity(userId), timeout);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithError(503, "unavailable");
  }
}
