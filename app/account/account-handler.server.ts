// Answers every request under /api: sign-in through Better Auth, whether
// sign-in is configured, and the profile. The resource route in
// app/routes/api.ts sends requests here, in development and on Vercel alike.
import { Pool } from "@neondatabase/serverless";

import {
  accountProfilePath,
  accountReturnPath,
  accountStatusPath,
  authBasePath,
} from "./account-api";
import { createAccountAuth, isEnabledAuthPath } from "./account-auth.server";
import {
  readAccountConfig,
  type AccountConfig,
} from "./account-config.server";
import {
  accountStoreTimeout,
  createProfileStore,
  handleProfileRequest,
  readErrorCode,
  respondWithError,
  respondWithJson,
  withTimeout,
  type ProfileStore,
  type ReadSessionUserId,
} from "./account-profile.server";

// What one request needs: Better Auth, the profile store, and a way to let go
// of both.
export type AccountRuntime = {
  handleAuthRequest(request: Request): Promise<Response>;
  readSessionUserId: ReadSessionUserId;
  profiles: ProfileStore;
  // Closes the database connections, once the response is ready.
  close(): Promise<void>;
};

// A runtime over a Neon pool. A serverless function may be frozen between
// requests, so the pool is made for one request and closed after it. Nothing
// connects until the first query.
export function openNeonAccountRuntime(config: AccountConfig): AccountRuntime {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const auth = createAccountAuth(config, pool);
  return {
    handleAuthRequest: (request) => auth.handler(request),
    readSessionUserId: async (headers) =>
      (await auth.api.getSession({ headers }))?.user.id,
    profiles: createProfileStore(pool),
    close: () => pool.end(),
  };
}

// How long a response waits for the database connections to close.
export const accountCloseTimeout = 1000;

function reportAuthFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_auth_failed", code }));
}

// Starting sign-in always asks Google for the basic permissions only and
// returns to the dashboard, whatever the browser asked for, so a page cannot
// request more of Google or send the person elsewhere afterwards.
async function fixSignInRequest(request: Request) {
  const body = JSON.stringify({
    provider: "google",
    callbackURL: accountReturnPath,
    errorCallbackURL: accountReturnPath,
    disableRedirect: true,
  });
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  // Read and discarded, so that the original body is not left unread.
  await request.arrayBuffer().catch(() => undefined);
  return new Request(request.url, { method: "POST", headers, body });
}

// openRuntime gives undefined when sign-in is not configured. Requests for
// other paths, including Better Auth endpoints the app does not use, get a
// 404.
export function createAccountRequestHandler(
  openRuntime: () => AccountRuntime | undefined,
  isConfigured: () => boolean,
  reportFailure: (code: string | undefined) => void = reportAuthFailure,
) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname === accountStatusPath) {
      return request.method === "GET"
        ? respondWithJson(200, { configured: isConfigured() })
        : respondWithError(405, "method_not_allowed");
    }
    const isProfile = pathname === accountProfilePath;
    if (!isProfile && !isEnabledAuthPath(pathname)) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const runtime = openRuntime();
    if (!runtime) return respondWithError(503, "unavailable");
    try {
      if (isProfile) {
        return await handleProfileRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.profiles,
        });
      }
      const authRequest =
        pathname === `${authBasePath}/sign-in/social` &&
        request.method === "POST"
          ? await fixSignInRequest(request)
          : request;
      return await withTimeout(
        runtime.handleAuthRequest(authRequest),
        accountStoreTimeout * 2,
      );
    } catch (error) {
      reportFailure(readErrorCode(error));
      return respondWithError(503, "unavailable");
    } finally {
      // Closing waits for running queries, so a stalled query must not hold
      // the request open.
      await withTimeout(runtime.close(), accountCloseTimeout).catch(
        () => undefined,
      );
    }
  };
}

export function createAccountRequestHandlerFromEnvironment(
  env: Record<string, string | undefined>,
  isDevelopmentServer: boolean,
) {
  const config = readAccountConfig(env, isDevelopmentServer);
  return createAccountRequestHandler(
    () => (config ? openNeonAccountRuntime(config) : undefined),
    () => config !== undefined,
  );
}

let serverHandler: ((request: Request) => Promise<Response>) | undefined;

// Settings are read once per server instance, on its first account request.
export function handleAccountRequest(request: Request) {
  serverHandler ??= createAccountRequestHandlerFromEnvironment(
    process.env,
    import.meta.env.DEV,
  );
  return serverHandler(request);
}
