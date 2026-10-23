// The sign-in and visit history (AD #46 Sign-in History), in the
// account_sign_in and account_visit tables of db/account-tables.sql. Only the
// account, the server's own times and the self-declared usage label (AD #51
// Label Account Usage) are kept: nothing from the browser, its clock, its
// address or its details.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithError,
  withTimeout,
  type Queryable,
  type ReadSessionUserId,
} from "./account-profile.server";
import { readLabel } from "./usage-label.server";

// A visit ends after this long without a click or keypress, so that later
// activity starts a new one. A provisional default.
export const visitGapMinutes = 10;

// How long a sign-in waits for its history entry before carrying on without
// it.
export const signInRecordTimeout = 3000;

export type HistoryStore = {
  // The label is the usage label from the request (AD #51), or "".
  recordSignIn(userId: string, label: string): Promise<void>;
  // Extends the latest visit of the account and label, or starts a new one if
  // it has been idle for visitGapMinutes or more. People using one account
  // under different labels at once each have their own running visit.
  recordActivity(userId: string, label: string): Promise<void>;
};

// A Postgres pool: a visit is recorded in a transaction on one connection.
export type HistoryDatabase = Queryable & {
  connect(): Promise<Queryable & { release(): void }>;
};

export function createHistoryStore(database: HistoryDatabase): HistoryStore {
  return {
    async recordSignIn(userId, label) {
      await database.query(
        "insert into account_sign_in (user_id, label) values ($1, $2)",
        [userId, label],
      );
    },
    async recordActivity(userId, label) {
      const client = await database.connect();
      try {
        await client.query("begin", []);
        // Two reports at once for one account and label wait for each other,
        // so that only one starts a visit.
        await client.query(
          "select pg_advisory_xact_lock(hashtext($1 || ':' || $2))",
          [userId, label],
        );
        const { rows } = await client.query(
          `update account_visit set last_active_at = now()
           where id = (
             select id from account_visit where user_id = $1 and label = $2
             order by last_active_at desc limit 1
           )
           and last_active_at > now() - make_interval(mins => $3)
           returning id`,
          [userId, label, visitGapMinutes],
        );
        if (rows.length === 0) {
          await client.query(
            "insert into account_visit (user_id, label) values ($1, $2)",
            [userId, label],
          );
        }
        await client.query("commit", []);
      } catch (error) {
        await client.query("rollback", []).catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
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
  label: string,
  {
    timeout = signInRecordTimeout,
    reportFailure = reportHistoryFailure,
  }: {
    timeout?: number;
    reportFailure?: (code: string | undefined) => void;
  } = {},
) {
  try {
    await withTimeout(history.recordSignIn(userId, label), timeout);
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
    await withTimeout(
      history.recordActivity(userId, readLabel(request.headers)),
      timeout,
    );
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithError(503, "unavailable");
  }
}
