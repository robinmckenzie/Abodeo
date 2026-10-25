// The Calendar test's two endpoints (AD #10 Prove Calendar Access):
// - POST calendarTestAppointmentPath starts the grant and gives Google's
//   address;
// - GET calendarCallbackPath is where Google returns the browser. It checks
//   the grant, adds the test appointment and returns the browser to the
//   dashboard with the result.
// Google's token is used only inside one callback and is never saved or
// logged. Logs carry short failure codes only.
import { accountReturnPath } from "../account/account-api";
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithError,
  respondWithJson,
  withTimeout,
  type ReadSessionUserId,
} from "../account/account-profile.server";
import { readRequestAccount } from "../projects/request-account.server";
import { isProjectId } from "../projects/projects-api";
import {
  buildProjectReturnSearch,
  type AppointmentReturnTarget,
} from "./appointments-api";
import {
  calendarCallbackPath,
  calendarResultParameter,
  calendarTestAppointmentPath,
  type CalendarResult,
  type CalendarStartResponse,
} from "./calendar-api";
import {
  calendarScope,
  clearCalendarGrantCookie,
  readCalendarGrant,
  startCalendarGrant,
  type CalendarGoogle,
} from "./calendar-grant.server";
import { createCalendarTokenCookie } from "./calendar-token.server";
import type { CalendarStore } from "./calendar-store.server";
import {
  GoogleCalendarError,
  googleCalendarTimeout,
  type CalendarEvent,
  type CalendarEventRecord,
  type GoogleCalendar,
} from "./google-calendar.server";

export const abodeoCalendarName = "Abodeo";

// Google's error codes that are logged as they are. Any other value of the
// callback's error parameter is logged as "other", as it could be any text.
const knownGoogleErrors = [
  "invalid_request",
  "unauthorized_client",
  "unsupported_response_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
  "admin_policy_enforced",
  "interaction_required",
  "login_required",
  "consent_required",
];
export const testAppointmentTitle = "Abodeo test appointment";
const testAppointmentDescription =
  "Made by Abodeo's Calendar test, to check that Abodeo can add appointments to your Abodeo calendar. You can delete it.";
const testAppointmentLength = 30 * 60 * 1000;
const hour = 60 * 60 * 1000;
const unknownTokenLifetime = 30 * 60 * 1000;

// What the endpoints need once sign-in is configured.
export type CalendarDependencies = {
  // Encrypts the grant cookie: BETTER_AUTH_SECRET.
  secret: string;
  // Whether the cookie is marked Secure, which it is over https.
  isSecure: boolean;
  google: CalendarGoogle;
  calendar: GoogleCalendar;
  store: CalendarStore;
  // Whether the account has the project, which may be one this version
  // cannot read.
  hasProject(userId: string, projectId: string): Promise<boolean>;
};

export type ReportCalendarFailure = (
  stage: string,
  code: string | undefined,
) => void;

export type CalendarRequestDependencies = CalendarDependencies & {
  readSessionUserId: ReadSessionUserId;
  now?: () => number;
  // How long each call to Google or the database may take.
  timeout?: number;
  reportFailure?: ReportCalendarFailure;
};

function reportCalendarFailure(stage: string, code: string | undefined) {
  console.error(JSON.stringify({ type: "calendar_failed", stage, code }));
}

function readFailureCode(error: unknown) {
  return error instanceof GoogleCalendarError
    ? error.code
    : readErrorCode(error);
}

// The browser's time zone as Google expects it, an IANA name such as
// Europe/London, or null for anything else.
export function normaliseTimeZone(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)
  ) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

// The start of the next whole hour in the time zone (UTC if null), as
// milliseconds. Exactly on the hour gives the hour after.
export function findNextWholeHour(now: number, timeZone: string | null) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone ?? "UTC",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(now));
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const sinceHour =
    (read("minute") * 60 + read("second")) * 1000 + (now % 1000);
  return now - sinceHour + hour;
}

export function buildTestAppointment(
  now: number,
  timeZone: string | null,
): CalendarEvent {
  const start = findNextWholeHour(now, timeZone);
  const at = (time: number) => ({
    dateTime: new Date(time).toISOString(),
    ...(timeZone ? { timeZone } : {}),
  });
  return {
    summary: testAppointmentTitle,
    description: testAppointmentDescription,
    start: at(start),
    end: at(start + testAppointmentLength),
  };
}

// Adds the event to the account's Abodeo calendar, making the calendar first
// if there is none or Google no longer finds it. Two additions at once (two
// tabs) save the calendar by compare-and-swap: the one that loses deletes the
// calendar it made and uses the winner's, so only one calendar is ever in
// use. Rejects if the event was not created.
export async function insertAbodeoEvent({
  accessToken,
  userId,
  timeZone,
  event,
  store,
  calendar,
  timeout = accountStoreTimeout,
  reportFailure = reportCalendarFailure,
}: {
  accessToken: string;
  userId: string;
  // The calendar's time zone, if it has to be made.
  timeZone: string | null;
  event: CalendarEvent;
  store: CalendarStore;
  calendar: GoogleCalendar;
  timeout?: number;
  reportFailure?: ReportCalendarFailure;
}): Promise<CalendarEventRecord> {
  // Database calls are limited here. Google's calls limit themselves (see
  // googleCalendarTimeout), as they can take longer.
  const call = <Result>(work: Promise<Result>) => withTimeout(work, timeout);
  const makeCalendar = () =>
    calendar.insertCalendar(accessToken, {
      summary: abodeoCalendarName,
      timeZone,
    });
  // Another test saved its calendar first: use that one, and delete the spare.
  const adoptWinningCalendar = async (spareId: string) => {
    const winnerId = await call(store.readCalendarId(userId));
    try {
      await calendar.deleteCalendar(accessToken, spareId);
    } catch (error) {
      reportFailure("spare_calendar_left", readFailureCode(error));
    }
    if (winnerId === undefined) {
      throw new GoogleCalendarError("calendar_link_missing");
    }
    return winnerId;
  };

  let calendarId = await call(store.readCalendarId(userId));
  if (calendarId !== undefined) {
    const result = await calendar.insertEvent(accessToken, calendarId, event);
    if (result !== "not-found") return result;
    const replacementId = await makeCalendar();
    calendarId = (await call(
      store.replaceCalendarId(userId, calendarId, replacementId),
    ))
      ? replacementId
      : await adoptWinningCalendar(replacementId);
  } else {
    const firstId = await makeCalendar();
    calendarId = (await call(store.saveFirstCalendarId(userId, firstId)))
      ? firstId
      : await adoptWinningCalendar(firstId);
  }
  const result = await calendar.insertEvent(accessToken, calendarId, event);
  if (result === "not-found") throw new GoogleCalendarError("calendar_missing");
  return result;
}

// Adds the test appointment to the account's Abodeo calendar.
export async function createTestAppointment({
  now,
  timeZone,
  ...rest
}: Omit<Parameters<typeof insertAbodeoEvent>[0], "event"> & { now: number }) {
  await insertAbodeoEvent({
    ...rest,
    timeZone,
    event: buildTestAppointment(now, timeZone),
  });
}

// What the start request asks for: the browser's time zone, and a project to
// return to if it names one. "invalid" if the project is named wrongly.
async function readStartRequest(request: Request): Promise<{
  timeZone: string | null;
  target: AppointmentReturnTarget | "invalid" | undefined;
}> {
  let body: { timeZone?: unknown; projectId?: unknown; openForm?: unknown };
  try {
    body = ((await request.json()) as typeof body | null) ?? {};
  } catch {
    return { timeZone: null, target: undefined };
  }
  const timeZone = normaliseTimeZone(body.timeZone);
  if (body.projectId === undefined) return { timeZone, target: undefined };
  if (!isProjectId(body.projectId)) return { timeZone, target: "invalid" };
  return {
    timeZone,
    target: { projectId: body.projectId, openForm: body.openForm === true },
  };
}

async function handleStart(
  request: Request,
  dependencies: CalendarRequestDependencies,
) {
  const {
    readSessionUserId,
    store,
    now = Date.now,
    timeout = accountStoreTimeout,
    reportFailure = reportCalendarFailure,
  } = dependencies;
  if (request.method !== "POST") {
    return respondWithError(405, "method_not_allowed");
  }
  // A form on another site cannot send JSON, so this stops other sites
  // starting the grant, as for sign-in.
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return respondWithError(400, "invalid_request");
  }
  try {
    const { timeZone, target } = await withTimeout(
      readStartRequest(request),
      timeout,
    ).catch(() => ({ timeZone: null, target: undefined }));
    if (target === "invalid") return respondWithError(400, "invalid_request");
    let userId: string | undefined;
    if (target) {
      // A grant for a project names the account the page is working for, as
      // the projects requests do, so that a page left open for another
      // account does not send this one through Google.
      const account = await readRequestAccount(
        request,
        readSessionUserId,
        timeout,
      );
      if (account.kind === "refused") {
        return respondWithJson(account.status, { error: account.error });
      }
      userId = account.userId;
    } else {
      userId = await withTimeout(readSessionUserId(request.headers), timeout);
      if (userId === undefined) return respondWithError(401, "not_signed_in");
    }
    const googleAccountId = await withTimeout(
      store.readGoogleAccountId(userId),
      timeout,
    );
    if (googleAccountId === undefined) {
      reportFailure("start", "no_google_account");
      return respondWithError(503, "unavailable");
    }
    const { url, cookie } = await startCalendarGrant(dependencies.google, {
      secret: dependencies.secret,
      isSecure: dependencies.isSecure,
      userId,
      googleAccountId,
      timeZone,
      returnProjectId: target?.projectId,
      openForm: target?.openForm,
      now: now(),
    });
    const response = respondWithJson(200, {
      url,
    } satisfies CalendarStartResponse);
    response.headers.append("Set-Cookie", cookie);
    return response;
  } catch (error) {
    reportFailure("start", readFailureCode(error));
    return respondWithError(503, "unavailable");
  }
}

// Returns the browser to the dashboard with the result, at the project if
// the grant was for one (opening its new appointment form only after a
// success). The cookies are set on the way.
function returnToDashboard(
  request: Request,
  result: CalendarResult,
  cookies: string[] = [],
  target?: AppointmentReturnTarget,
) {
  const location = new URL(accountReturnPath, request.url);
  if (target) {
    for (const [name, value] of buildProjectReturnSearch({
      projectId: target.projectId,
      openForm: target.openForm && result === "connected",
    })) {
      location.searchParams.set(name, value);
    }
  }
  location.searchParams.set(calendarResultParameter, result);
  const headers = new Headers({
    Location: location.toString(),
    "Cache-Control": "no-store",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

async function handleCallback(
  request: Request,
  dependencies: CalendarRequestDependencies,
) {
  const {
    readSessionUserId,
    store,
    google,
    calendar,
    secret,
    now = Date.now,
    timeout = accountStoreTimeout,
    reportFailure = reportCalendarFailure,
  } = dependencies;
  // Set once the grant is read and Google's answer is known to be for it.
  let target: AppointmentReturnTarget | undefined;
  const finish = (result: CalendarResult, ...cookies: string[]) =>
    returnToDashboard(
      request,
      result,
      [clearCalendarGrantCookie(dependencies.isSecure), ...cookies],
      target,
    );
  const failAt = (stage: string, code: string | undefined) => {
    reportFailure(stage, code);
    return finish("failed");
  };
  if (request.method !== "GET") {
    return respondWithError(405, "method_not_allowed");
  }
  const parameters = new URL(request.url).searchParams;
  let stage = "grant";
  try {
    const read = await readCalendarGrant(
      request.headers.get("Cookie"),
      secret,
      now(),
    );
    if ("problem" in read) return failAt(stage, read.problem);
    const { grant } = read;
    // Checked before Google's answer is believed, so that a link to the
    // callback made elsewhere cannot report a refusal.
    if (parameters.get("state") !== grant.state) {
      return failAt(stage, "state_mismatch");
    }
    if (grant.returnProjectId !== null) {
      target = { projectId: grant.returnProjectId, openForm: grant.openForm };
    }
    const googleError = parameters.get("error");
    if (googleError !== null) {
      if (googleError === "access_denied") return finish("denied");
      return failAt(
        "google",
        knownGoogleErrors.includes(googleError) ? googleError : "other",
      );
    }
    const code = parameters.get("code");
    if (!code) return failAt(stage, "code_missing");
    const userId = await withTimeout(
      readSessionUserId(request.headers),
      timeout,
    );
    if (userId !== grant.userId) return failAt(stage, "session_mismatch");

    stage = "exchange";
    const tokens = await withTimeout(
      google.exchangeCode({ code, codeVerifier: grant.verifier }),
      googleCalendarTimeout,
    );
    // Google's consent screen lets the person untick the permission.
    if (!tokens.scopes.includes(calendarScope)) return finish("denied");
    if (!tokens.accessToken || !tokens.idToken) {
      return failAt(stage, "token_missing");
    }

    stage = "account";
    const [googleAccountId, subject] = await Promise.all([
      withTimeout(store.readGoogleAccountId(userId), timeout),
      withTimeout(
        google.readIdTokenSubject(tokens.idToken),
        googleCalendarTimeout,
      ),
    ]);
    if (subject === undefined || googleAccountId === undefined) {
      return failAt(
        stage,
        subject === undefined ? "id_token_invalid" : "no_google_account",
      );
    }
    if (subject !== googleAccountId) return finish("wrong-account");

    // The token is kept for the project page's own calls. Without Google's
    // expiry it is assumed to last half an hour.
    const tokenCookie = await createCalendarTokenCookie({
      secret,
      isSecure: dependencies.isSecure,
      accessToken: tokens.accessToken,
      userId,
      expiresAt: tokens.accessTokenExpiresAt ?? now() + unknownTokenLifetime,
      now: now(),
    });
    // A grant for a project only connects: the project page adds the
    // appointments.
    if (target) return finish("connected", tokenCookie);

    stage = "appointment";
    await createTestAppointment({
      accessToken: tokens.accessToken,
      userId,
      timeZone: grant.timeZone,
      store,
      calendar,
      now: now(),
      timeout,
      reportFailure,
    });
    return finish("created", tokenCookie);
  } catch (error) {
    return failAt(stage, readFailureCode(error));
  }
}

export function handleCalendarRequest(
  request: Request,
  dependencies: CalendarRequestDependencies,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === calendarTestAppointmentPath) {
    return handleStart(request, dependencies);
  }
  if (pathname === calendarCallbackPath) {
    return handleCallback(request, dependencies);
  }
  return Promise.resolve(
    new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    }),
  );
}

export function isCalendarPath(pathname: string) {
  return (
    pathname === calendarTestAppointmentPath ||
    pathname === calendarCallbackPath
  );
}

// The answer when sign-in is not configured here.
export function respondCalendarUnavailable(request: Request) {
  const { pathname } = new URL(request.url);
  return pathname === calendarCallbackPath
    ? returnToDashboard(request, "failed")
    : respondWithError(503, "unavailable");
}
