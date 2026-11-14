// Answers every request under /api: sign-in through Better Auth, whether
// sign-in is configured, the profile, activity for the visit history, the
// signed-in account's projects, people and images, and the Calendar test. The
// resource route in app/routes/api.ts sends requests here, in development and
// on Vercel alike.
import { Pool } from "@neondatabase/serverless";

import {
  handleAppointmentRequest,
  isAppointmentPath,
} from "../calendar/appointment-handler.server";
import {
  clearCalendarTokenCookie,
  createCalendarTokenCookie,
} from "../calendar/calendar-token.server";
import { createCalendarGoogle } from "../calendar/calendar-grant.server";
import {
  handleCalendarRequest,
  isCalendarPath,
  respondCalendarUnavailable,
  type CalendarDependencies,
} from "../calendar/calendar-handler.server";
import { createCalendarStore } from "../calendar/calendar-store.server";
import { createDemoCalendarAccessStore } from "../calendar/demo-calendar-access.server";
import {
  collectSeedAppointments,
  restoreSeedAppointments,
  type SeedAppointmentDependencies,
} from "../calendar/demo-seed-appointments.server";
import { createGoogleCalendar } from "../calendar/google-calendar.server";
import {
  handleImagesRequest,
  isImagesPath,
} from "../projects/image-handler.server";
import {
  createImageStore,
  type ImageStore,
} from "../projects/image-store.server";
import {
  handlePeopleRequest,
  isPeoplePath,
} from "../projects/people-handler.server";
import {
  createPeopleStore,
  type PeopleStore,
} from "../projects/people-store.server";
import {
  handleProjectsRequest,
  isProjectsPath,
} from "../projects/project-handler.server";
import {
  createProjectStore,
  type ProjectStore,
} from "../projects/project-store.server";

import {
  accountActivityPath,
  accountSeedPath,
  siteVisitPath,
  accountProfilePath,
  accountReturnPath,
  accountStatusPath,
  authBasePath,
} from "./account-api";
import {
  createAccountAuth,
  isEnabledAuthPath,
  type SignInCapture,
} from "./account-auth.server";
import { readAccountConfig, type AccountConfig } from "./account-config.server";
import {
  createHistoryStore,
  handleActivityRequest,
  type HistoryStore,
} from "./account-history.server";
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
import {
  createVisitStore,
  handleSiteVisitRequest,
  type VisitDependencies,
} from "./site-visit.server";
import { respondWithDemoSignIn } from "./demo-sign-in.server";
import {
  readIgnoredLabels,
  readVisitAlertSettings,
} from "./visit-alert.server";
import {
  createDemoSeedStore,
  type DemoSeedStore,
} from "./demo-seed-store.server";
import { canManageDemo, handleSeedRequest } from "./seed-handler.server";

// What one request needs: Better Auth, the profile, history and project,
// people and image stores, the Calendar test, and a way to let go of them.
export type AccountRuntime = {
  handleAuthRequest(request: Request): Promise<Response>;
  handleDemoRequest(request: Request): Promise<Response>;
  readSessionUserId: ReadSessionUserId;
  profiles: ProfileStore;
  history: HistoryStore;
  visits: VisitDependencies;
  projects: ProjectStore;
  people: PeopleStore;
  images: ImageStore;
  seed: DemoSeedStore;
  // Robin's own labels, which show the seed control (AD #138).
  ignoredLabels: string[];
  calendar: CalendarDependencies;
  // What the demo seed's appointments need (AD #138).
  seedAppointments: SeedAppointmentDependencies;
  // What this request's sign-in callback learned from Google, if anything.
  signIn: SignInCapture;
  // Closes the database connections, once the response is ready.
  close(): Promise<void>;
};

function reportPoolFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_pool_failed", code }));
}

// Neon can close a connection at any time, and the pool then emits "error".
// With no listener Node ends the process, so the code is logged and nothing
// else happens: a query on the dropped connection fails by itself.
export function listenForPoolErrors(
  pool: Pick<Pool, "on">,
  reportFailure: (code: string | undefined) => void = reportPoolFailure,
) {
  pool.on("error", (error: unknown) => reportFailure(readErrorCode(error)));
}

// A runtime over a Neon pool. A serverless function may be frozen between
// requests, so the pool is made for one request and closed after it. Nothing
// connects until the first query.
export function openNeonAccountRuntime(config: AccountConfig): AccountRuntime {
  const pool = new Pool({ connectionString: config.databaseUrl });
  listenForPoolErrors(pool);
  const history = createHistoryStore(pool);
  const projects = createProjectStore(pool);
  const seed = createDemoSeedStore(pool);
  const signIn: SignInCapture = {};
  const auth = createAccountAuth(config, pool, history, signIn);
  const ignoredLabels = readIgnoredLabels(process.env);
  const calendarDependencies: CalendarDependencies = {
    secret: config.secret,
    isSecure: config.baseUrl.startsWith("https:"),
    google: createCalendarGoogle(config),
    calendar: createGoogleCalendar(),
    store: createCalendarStore(pool),
    demoAccess: {
      store: createDemoCalendarAccessStore(pool),
      canManage: (headers, userId) =>
        canManageDemo(headers, userId, { store: seed, ignoredLabels }),
    },
    hasProject: async (userId, projectId) =>
      (await projects.read(userId, projectId)).kind !== "not-found",
  };
  const seedAppointments: SeedAppointmentDependencies = calendarDependencies;
  return {
    handleAuthRequest: (request) => auth.handler(request),
    handleDemoRequest: (request) =>
      respondWithDemoSignIn(request, auth, signIn, async (userId) => {
        // The calendar is put back only once the database has been.
        if (await seed.reset(userId)) {
          await restoreSeedAppointments(
            seedAppointments,
            userId,
            await seed.readAppointments(),
          );
        }
      }),
    readSessionUserId: async (headers) =>
      (await auth.api.getSession({ headers }))?.user.id,
    profiles: createProfileStore(pool),
    history,
    visits: {
      store: createVisitStore(pool),
      alerts: readVisitAlertSettings(process.env),
    },
    projects,
    people: createPeopleStore(pool),
    images: createImageStore(pool),
    seed,
    ignoredLabels,
    calendar: calendarDependencies,
    seedAppointments,
    signIn,
    close: () => pool.end(),
  };
}

// How long a response waits for the database connections to close.
export const accountCloseTimeout = 1000;

// A sign-in that reached the dashboard with Calendar allowed also keeps
// Google's token in the Calendar cookie, as the separate Calendar flow does.
// Anything else, including a redirect that carries an error, is left as is.
export async function addSignInCalendarToken(
  response: Response,
  request: Request,
  signIn: SignInCapture,
  calendar: Pick<CalendarDependencies, "secret" | "isSecure">,
  now: number = Date.now(),
) {
  const location = response.headers.get("Location");
  if (!location || response.status < 300 || response.status >= 400) {
    return response;
  }
  const target = new URL(location, request.url);
  const reachedDashboard =
    target.pathname === accountReturnPath && !target.searchParams.has("error");
  const { calendarToken, userId } = signIn;
  if (!reachedDashboard || !calendarToken || !userId) return response;
  const withToken = new Response(response.body, response);
  withToken.headers.append(
    "Set-Cookie",
    await createCalendarTokenCookie({
      ...calendar,
      ...calendarToken,
      userId,
      now,
    }),
  );
  return withToken;
}

function reportAuthFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_auth_failed", code }));
}

// Starting sign-in always asks Google for sign-in's own permissions only and
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
    const isActivity = pathname === accountActivityPath;
    const isSiteVisit = pathname === siteVisitPath;
    const isSeed = pathname === accountSeedPath;
    const isCalendar = isCalendarPath(pathname);
    const isAppointments = isAppointmentPath(pathname);
    const isImages = isImagesPath(pathname);
    const isPeople = isPeoplePath(pathname);
    const isProjects = !isImages && isProjectsPath(pathname);
    if (
      !isProfile &&
      !isActivity &&
      !isSeed &&
      !isSiteVisit &&
      !isCalendar &&
      !isAppointments &&
      !isProjects &&
      !isPeople &&
      !isImages &&
      !isEnabledAuthPath(pathname)
    ) {
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
    if (!runtime) {
      return isCalendar ? respondCalendarUnavailable(request) : fail();
    }
    try {
      if (isSeed) {
        return await handleSeedRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.seed,
          ignoredLabels: runtime.ignoredLabels,
          collectAppointments: (userId, projectIds) =>
            collectSeedAppointments(
              runtime.seedAppointments,
              userId,
              projectIds,
            ),
        });
      }
      if (isAppointments) {
        return await handleAppointmentRequest(request, {
          ...runtime.calendar,
          readSessionUserId: runtime.readSessionUserId,
        });
      }
      if (isCalendar) {
        return await handleCalendarRequest(request, {
          ...runtime.calendar,
          readSessionUserId: runtime.readSessionUserId,
        });
      }
      if (isProfile) {
        return await handleProfileRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.profiles,
        });
      }
      if (isImages) {
        return await handleImagesRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.images,
        });
      }
      if (isPeople) {
        return await handlePeopleRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.people,
        });
      }
      if (isProjects) {
        return await handleProjectsRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          store: runtime.projects,
        });
      }
      if (isSiteVisit) {
        return await handleSiteVisitRequest(request, runtime.visits);
      }
      if (isActivity) {
        return await handleActivityRequest(request, {
          readSessionUserId: runtime.readSessionUserId,
          history: runtime.history,
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
      if (pathname === `${authBasePath}/callback/google`) {
        return await addSignInCalendarToken(
          response,
          request,
          runtime.signIn,
          runtime.calendar,
        );
      }
      // Signing out also drops Google's Calendar token.
      if (pathname === `${authBasePath}/sign-out`) {
        const cleared = new Response(response.body, response);
        cleared.headers.append(
          "Set-Cookie",
          clearCalendarTokenCookie(runtime.calendar.isSecure),
        );
        return cleared;
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

// The /demo address: signs in as the demo account. Like the account API, it
// is unavailable where sign-in is not configured.
export function createDemoRequestHandler(
  openRuntime: () => AccountRuntime | undefined,
  reportFailure: (code: string | undefined) => void = reportAuthFailure,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const runtime = openRuntime();
    if (!runtime) return new Response(null, { status: 503 });
    try {
      return await runtime.handleDemoRequest(request);
    } catch (error) {
      reportFailure(readErrorCode(error));
      return new Response(null, { status: 503 });
    } finally {
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
let demoHandler: ((request: Request) => Promise<Response>) | undefined;

export function handleDemoRequest(request: Request) {
  const config = readAccountConfig(process.env, import.meta.env.DEV);
  demoHandler ??= createDemoRequestHandler(() =>
    config ? openNeonAccountRuntime(config) : undefined,
  );
  return demoHandler(request);
}

// Settings are read once per server instance, on its first account request.
export function handleAccountRequest(request: Request) {
  serverHandler ??= createAccountRequestHandlerFromEnvironment(
    process.env,
    import.meta.env.DEV,
  );
  return serverHandler(request);
}
