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
import { readAccountConfig, type AccountConfig } from "./account-config.server";
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
  // The browser's body is replaced above, but is still read to the end and
  // thrown away, so it is not left waiting on the connection.
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
    // Google sends the browser itself back here, so a failure returns it to
    // the dashboard, which says that sign-in did not complete.
    const fail = () =>
      pathname === `${authBasePath}/callback/google`
        ? Response.redirect(
            new URL(`${accountReturnPath}?error=unavailable`, request.url),
            302,
          )
        : respondWithError(503, "unavailable");
    const isSignInStart =
      pathname === `${authBasePath}/sign-in/social` &&
      request.method === "POST";
    // Better Auth relies on this endpoint accepting only JSON, which a form
    // on another site cannot send, so that check is kept before the body is
    // replaced.
    if (
      isSignInStart &&
      !request.headers.get("Content-Type")?.startsWith("application/json")
    ) {
      return respondWithError(400, "invalid_request");
    }
    const runtime = openRuntime();
    if (!runtime) return fail();
    try {
      if (isProfile) {
        return await handleProfileRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.profiles,
        });
      }
      const authRequest = isSignInStart
        ? await fixSignInRequest(request)
        : request;
      const response = await withTimeout(
        runtime.handleAuthRequest(authRequest),
        accountStoreTimeout * 2,
      );
      // Better Auth answers some failures, such as a database error while
      // making the session, with an error page rather than a redirect.
      if (
        pathname === `${authBasePath}/callback/google` &&
        response.status >= 400
      ) {
        reportFailure(`callback_${response.status}`);
        return fail();
      }
      return response;
    } catch (error) {
      reportFailure(readErrorCode(error));
      return fail();
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
