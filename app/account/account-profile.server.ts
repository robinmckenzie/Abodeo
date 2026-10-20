// The profile endpoint: the signed-in account's preferred name. Whose profile
// is read or changed comes only from the session cookie, never from anything
// else in the request, and only the preferred name is ever read from a body.
import {
  normalisePreferredName,
  type AccountErrorCode,
  type AccountErrorResponse,
  type AccountProfileResponse,
} from "./account-api";

// How long a request may wait for the session or the database.
export const accountStoreTimeout = 5000;

export const accountResponseHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
} as const;

// Reads and changes preferred names, keyed by account.
export type ProfileStore = {
  read(userId: string): Promise<string | null>;
  // Saves the name, or removes it when null.
  write(userId: string, preferredName: string | null): Promise<void>;
};

// The signed-in account's id, from a request's headers, or undefined when
// there is none.
export type ReadSessionUserId = (
  headers: Headers,
) => Promise<string | undefined>;

// The part of a Postgres pool that the store uses.
export type Queryable = {
  query(
    text: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

// The store over the user_profile table in db/account-tables.sql.
export function createProfileStore(database: Queryable): ProfileStore {
  return {
    async read(userId) {
      const { rows } = await database.query(
        "select preferred_name from user_profile where user_id = $1",
        [userId],
      );
      const name = rows[0]?.preferred_name;
      return typeof name === "string" ? name : null;
    },
    async write(userId, preferredName) {
      if (preferredName === null) {
        await database.query("delete from user_profile where user_id = $1", [
          userId,
        ]);
        return;
      }
      await database.query(
        `insert into user_profile (user_id, preferred_name) values ($1, $2)
         on conflict (user_id) do update
         set preferred_name = excluded.preferred_name, updated_at = now()`,
        [userId, preferredName],
      );
    },
  };
}

export function respondWithJson(
  status: number,
  body: AccountProfileResponse | AccountErrorResponse | object,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: accountResponseHeaders,
  });
}

export function respondWithError(status: number, error: AccountErrorCode) {
  return respondWithJson(status, { error } satisfies AccountErrorResponse);
}

// Rejects if the work takes longer than the timeout.
export async function withTimeout<Result>(
  work: Promise<Result>,
  timeout: number,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A short code from a database or network error, never its message, which
// can carry details of the connection.
export function readErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[\w-]{1,40}$/.test(code)
    ? code
    : undefined;
}

function reportProfileFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_profile_failed", code }));
}

// The new preferred name from a PUT body, or undefined if the body is not
// valid. Anything else in the body, such as an account id, is ignored.
async function readProfileUpdate(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null || !("preferredName" in body)) {
    return undefined;
  }
  if (body.preferredName === null) return { preferredName: null };
  const preferredName = normalisePreferredName(body.preferredName);
  return preferredName === undefined ? undefined : { preferredName };
}

export type ProfileRequestDependencies = {
  readSessionUserId: ReadSessionUserId;
  store: ProfileStore;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

// Handles GET and PUT of accountProfilePath.
export async function handleProfileRequest(
  request: Request,
  {
    readSessionUserId,
    store,
    timeout = accountStoreTimeout,
    reportFailure = reportProfileFailure,
  }: ProfileRequestDependencies,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "PUT") {
    return respondWithError(405, "method_not_allowed");
  }
  // A page on another site cannot send a JSON body without the browser first
  // asking permission, which this endpoint never gives.
  if (
    request.method === "PUT" &&
    !request.headers.get("Content-Type")?.startsWith("application/json")
  ) {
    return respondWithError(400, "invalid_request");
  }
  try {
    const userId = await withTimeout(
      readSessionUserId(request.headers),
      timeout,
    );
    if (userId === undefined) return respondWithError(401, "not_signed_in");
    if (request.method === "GET") {
      const preferredName = await withTimeout(store.read(userId), timeout);
      return respondWithJson(200, { preferredName });
    }
    const update = await readProfileUpdate(request);
    if (!update) return respondWithError(400, "invalid_request");
    await withTimeout(store.write(userId, update.preferredName), timeout);
    return respondWithJson(200, update);
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithError(503, "unavailable");
  }
}
