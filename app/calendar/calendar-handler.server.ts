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
import type { CalendarStore } from "./calendar-store.server";
import {
  GoogleCalendarError,
  type CalendarEvent,
  type GoogleCalendar,
} from "./google-calendar.server";

export const abodeoCalendarName = "Abodeo";
export const testAppointmentTitle = "Abodeo test appointment";
const testAppointmentDescription =
  "Made by Abodeo's Calendar test, to check that Abodeo can add appointments to your Abodeo calendar. You can delete it.";
const testAppointmentLength = 30 * 60 * 1000;
const hour = 60 * 60 * 1000;

// What the endpoints need once sign-in is configured.
export type CalendarDependencies = {
  // Encrypts the grant cookie: BETTER_AUTH_SECRET.
  secret: string;
  // Whether the cookie is marked Secure, which it is over https.
  isSecure: boolean;
  google: CalendarGoogle;
  calendar: GoogleCalendar;
  store: CalendarStore;
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

// Adds the test appointment to the account's Abodeo calendar, making the
// calendar first if there is none or it was deleted. Two tests at once (two
// tabs) save the calendar by compare-and-swap: the one that loses deletes the
// calendar it made and uses the winner's, so only one calendar is ever in
// use. Rejects if the appointment was not created.
export async function createTestAppointment({
  accessToken,
  userId,
  timeZone,
  store,
  calendar,
  now,
  timeout = accountStoreTimeout,
  reportFailure = reportCalendarFailure,
}: {
  accessToken: string;
  userId: string;
  timeZone: string | null;
  store: CalendarStore;
  calendar: GoogleCalendar;
  now: number;
  timeout?: number;
  reportFailure?: ReportCalendarFailure;
}) {
  // Database calls are limited here. Google's calls limit themselves (see
  // googleCalendarTimeout), as they can take longer.
  const call = <Result>(work: Promise<Result>) => withTimeout(work, timeout);
  const event = buildTestAppointment(now, timeZone);
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
    if (result === "created") return;
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
  if (result !== "created") throw new GoogleCalendarError("calendar_missing");
}

async function readStartTimeZone(request: Request) {
  try {
    const body: unknown = await request.json();
    return normaliseTimeZone((body as { timeZone?: unknown } | null)?.timeZone);
  } catch {
    return null;
  }
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
    const userId = await withTimeout(
      readSessionUserId(request.headers),
      timeout,
    );
    if (userId === undefined) return respondWithError(401, "not_signed_in");
    const timeZone = await readStartTimeZone(request);
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

// Returns the browser to the dashboard with the result. A cookie to set,
// if given, removes the grant.
function returnToDashboard(
  request: Request,
  result: CalendarResult,
  clearCookie?: string,
) {
  const location = new URL(accountReturnPath, request.url);
  location.searchParams.set(calendarResultParameter, result);
  const headers = new Headers({
    Location: location.toString(),
    "Cache-Control": "no-store",
  });
  if (clearCookie) headers.append("Set-Cookie", clearCookie);
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
  const finish = (result: CalendarResult) =>
    returnToDashboard(
      request,
      result,
      clearCalendarGrantCookie(dependencies.isSecure),
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
    const googleError = parameters.get("error");
    if (googleError !== null) {
      if (googleError === "access_denied") return finish("denied");
      return failAt(
        "google",
        /^[\w-]{1,40}$/.test(googleError) ? googleError : "other",
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
      timeout,
    );
    // Google's consent screen lets the person untick the permission.
    if (!tokens.scopes.includes(calendarScope)) return finish("denied");
    if (!tokens.accessToken || !tokens.idToken) {
      return failAt(stage, "token_missing");
    }

    stage = "account";
    const [googleAccountId, subject] = await Promise.all([
      withTimeout(store.readGoogleAccountId(userId), timeout),
      withTimeout(google.readIdTokenSubject(tokens.idToken), timeout),
    ]);
    if (subject === undefined || googleAccountId === undefined) {
      return failAt(
        stage,
        subject === undefined ? "id_token_invalid" : "no_google_account",
      );
    }
    if (subject !== googleAccountId) return finish("wrong-account");

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
    return finish("created");
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
