// Talks to the account endpoints. Every request gives up after
// requestTimeout, so a server or database that does not answer leaves
// sign-in reported as unavailable instead of waiting for ever.
import {
  accountProfilePath,
  accountStatusPath,
  authBasePath,
  type AccountProfileResponse,
  type AccountStatusResponse,
} from "./account-api";

export const requestTimeout = 8000;

type Fetch = typeof fetch;

// Who is signed in, as far as this page knows. expiresAt is when the
// session ends, in milliseconds, unless it is renewed before then.
export type AccountSession =
  | { kind: "unavailable" }
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      id: string;
      name: string;
      email: string;
      expiresAt: number | null;
    };

export type ProfileFailure = "signed-out" | "invalid" | "unavailable";

export class ProfileError extends Error {
  readonly failure: ProfileFailure;

  constructor(failure: ProfileFailure) {
    super(failure);
    this.failure = failure;
  }
}

function sendRequest(fetchFn: Fetch, path: string, init: RequestInit = {}) {
  return fetchFn(path, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(requestTimeout),
    ...init,
  });
}

function sendJson(fetchFn: Fetch, path: string, body: unknown, method = "POST") {
  return sendRequest(fetchFn, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Whether sign-in works here and, if so, who is signed in.
export async function loadAccountSession(
  fetchFn: Fetch = fetch,
): Promise<AccountSession> {
  try {
    const status = await sendRequest(fetchFn, accountStatusPath);
    const statusBody: unknown = status.ok ? await status.json() : undefined;
    if ((statusBody as Partial<AccountStatusResponse>)?.configured !== true) {
      return { kind: "unavailable" };
    }
    const response = await sendRequest(fetchFn, `${authBasePath}/get-session`);
    if (!response.ok) return { kind: "unavailable" };
    const body: unknown = await response.json();
    if (body === null) return { kind: "signed-out" };
    const user = isRecord(body) ? body.user : undefined;
    const session = isRecord(body) ? body.session : undefined;
    if (
      !isRecord(user) ||
      typeof user.id !== "string" ||
      typeof user.name !== "string" ||
      typeof user.email !== "string"
    ) {
      return { kind: "unavailable" };
    }
    const expiresAt = isRecord(session)
      ? Date.parse(String(session.expiresAt))
      : NaN;
    return {
      kind: "signed-in",
      id: user.id,
      name: user.name,
      email: user.email,
      expiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

async function readProfileResponse(response: Response) {
  if (response.status === 401) throw new ProfileError("signed-out");
  if (response.status === 400) throw new ProfileError("invalid");
  const body: unknown = response.ok ? await response.json() : undefined;
  const name = isRecord(body)
    ? (body as Partial<AccountProfileResponse>).preferredName
    : undefined;
  if (name === null || typeof name === "string") return name;
  throw new ProfileError("unavailable");
}

async function withProfileErrors(work: () => Promise<string | null>) {
  try {
    return await work();
  } catch (error) {
    throw error instanceof ProfileError
      ? error
      : new ProfileError("unavailable");
  }
}

export function loadPreferredName(fetchFn: Fetch = fetch) {
  return withProfileErrors(async () =>
    readProfileResponse(await sendRequest(fetchFn, accountProfilePath)),
  );
}

// Saves the preferred name, or clears it with null, and gives what was saved.
export function savePreferredName(
  preferredName: string | null,
  fetchFn: Fetch = fetch,
) {
  return withProfileErrors(async () =>
    readProfileResponse(
      await sendJson(fetchFn, accountProfilePath, { preferredName }, "PUT"),
    ),
  );
}

// Google's sign-in address. The server decides what Google is asked for and
// where the person returns to.
export async function requestSignInAddress(fetchFn: Fetch = fetch) {
  const response = await sendJson(fetchFn, `${authBasePath}/sign-in/social`, {
    provider: "google",
  });
  const body: unknown = response.ok ? await response.json() : undefined;
  const url = isRecord(body) ? body.url : undefined;
  if (typeof url !== "string") throw new Error("Sign-in could not start.");
  return url;
}

// Ends this browser's session.
export async function signOut(fetchFn: Fetch = fetch) {
  const response = await sendJson(fetchFn, `${authBasePath}/sign-out`, {});
  if (!response.ok) throw new Error("Sign-out did not complete.");
}
