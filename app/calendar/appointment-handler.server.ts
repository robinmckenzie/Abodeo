// A project's appointments (AD #70 Add Appointments To Projects), which are
// events in the account's Abodeo calendar in Google Calendar, linked to the
// project by a private property. Abodeo keeps no copy. The endpoints make
// every Google call, with the token from its cookie, so the browser never
// sees the token:
// - GET calendarConnectionPath says whether the token is good enough to open
//   the appointment form;
// - GET calendarAppointmentsPath?projectId= lists the project's appointments;
// - POST calendarAppointmentsPath adds one.
// Like the projects endpoints, each names the account the page works for.
// Neither the token nor Google's response bodies are logged.
import {
  accountStoreTimeout,
  respondWithError,
  respondWithJson,
  withTimeout,
} from "../account/account-profile.server";
import { isProjectId } from "../projects/projects-api";
import { readRequestAccount } from "../projects/request-account.server";
import {
  appointmentProjectProperty,
  calendarAppointmentsPath,
  calendarConnectionPath,
  validateAppointmentFields,
  type Appointment,
  type AppointmentsResponse,
  type ConnectionResponse,
} from "./appointments-api";
import {
  insertAbodeoEvent,
  normaliseTimeZone,
  type CalendarRequestDependencies,
} from "./calendar-handler.server";
import { readCalendarToken } from "./calendar-token.server";
import {
  GoogleCalendarError,
  type CalendarEvent,
  type CalendarEventRecord,
} from "./google-calendar.server";

function reportAppointmentFailure(stage: string, code: string | undefined) {
  console.error(JSON.stringify({ type: "appointment_failed", stage, code }));
}

export function isAppointmentPath(pathname: string) {
  return (
    pathname === calendarConnectionPath || pathname === calendarAppointmentsPath
  );
}

function readFailureCode(error: unknown) {
  if (error instanceof GoogleCalendarError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[\w-]{1,40}$/.test(code)
    ? code
    : "unknown";
}

// Whether Google refused because the token is no good (ended, or without the
// Calendar permission), so that the person should go through Google again.
function isTokenRefused(error: unknown) {
  return (
    error instanceof GoogleCalendarError &&
    (error.code === "google_401" ||
      (error.code === "google_403" && error.isMissingPermission))
  );
}

function readTime(time: CalendarEvent["start"]) {
  return "date" in time ? time.date : time.dateTime;
}

function toAppointment(event: CalendarEventRecord): Appointment {
  return {
    id: event.id,
    title: event.summary,
    notes: event.description,
    allDay: "date" in event.start,
    start: readTime(event.start),
    end: readTime(event.end),
  };
}

export async function handleAppointmentRequest(
  request: Request,
  dependencies: CalendarRequestDependencies,
): Promise<Response> {
  const {
    readSessionUserId,
    store,
    calendar,
    secret,
    hasProject,
    now = Date.now,
    timeout = accountStoreTimeout,
    reportFailure = reportAppointmentFailure,
  } = dependencies;
  const url = new URL(request.url);
  const isConnection = url.pathname === calendarConnectionPath;
  const isWrite = request.method === "POST" && !isConnection;
  if (request.method !== "GET" && !isWrite) {
    return respondWithError(405, "method_not_allowed");
  }
  if (isWrite) {
    // A form on another site cannot send JSON or the account header, so this
    // stops other sites adding appointments, as for the other endpoints.
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) {
      return respondWithJson(403, { error: "forbidden" });
    }
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
      return respondWithError(400, "invalid_request");
    }
  }
  try {
    const account = await readRequestAccount(
      request,
      readSessionUserId,
      timeout,
    );
    if (account.kind === "refused") {
      return respondWithJson(account.status, { error: account.error });
    }
    const { userId } = account;
    const token = await readCalendarToken(
      request.headers.get("Cookie"),
      secret,
      userId,
      now(),
    );

    if (isConnection) {
      return respondWithJson(200, {
        ready: token !== undefined && !token.isNearExpiry,
      } satisfies ConnectionResponse);
    }

    if (!isWrite) {
      const projectId = url.searchParams.get("projectId");
      if (!isProjectId(projectId)) {
        return respondWithError(400, "invalid_request");
      }
      if (!(await withTimeout(hasProject(userId, projectId), timeout))) {
        return respondWithJson(404, { error: "not_found" });
      }
      const calendarId = await withTimeout(
        store.readCalendarId(userId),
        timeout,
      );
      const answer = (body: AppointmentsResponse) => respondWithJson(200, body);
      const needsGrant = () =>
        answer({
          status: "needs-grant",
          connectedBefore: calendarId !== undefined,
        });
      if (!token) return needsGrant();
      // No Abodeo calendar yet: there genuinely are no appointments.
      if (calendarId === undefined) {
        return answer({ status: "ok", appointments: [] });
      }
      try {
        const events = await calendar.listEvents(
          token.accessToken,
          calendarId,
          { name: appointmentProjectProperty, value: projectId },
        );
        return answer({
          status: "ok",
          appointments: events.map(toAppointment),
        });
      } catch (error) {
        if (isTokenRefused(error)) return needsGrant();
        // Never an empty list: a 404 can also mean no access to the calendar.
        reportFailure("list", readFailureCode(error));
        return answer({ status: "unavailable" });
      }
    }

    let body: Record<string, unknown>;
    try {
      body = ((await request.json()) as Record<string, unknown> | null) ?? {};
    } catch {
      return respondWithError(400, "invalid_request");
    }
    const { projectId, title, notes, allDay, start, end } = body;
    const timeZone = normaliseTimeZone(body.timeZone);
    if (
      !isProjectId(projectId) ||
      typeof title !== "string" ||
      typeof notes !== "string" ||
      typeof allDay !== "boolean" ||
      typeof start !== "string" ||
      typeof end !== "string"
    ) {
      return respondWithJson(400, { error: "invalid" });
    }
    const fields = validateAppointmentFields({
      title,
      notes,
      allDay,
      start,
      end,
    });
    // A timed appointment needs the browser's time zone to be placed.
    if (!fields.ok || (!allDay && timeZone === null)) {
      return respondWithJson(400, { error: "invalid" });
    }
    if (!(await withTimeout(hasProject(userId, projectId), timeout))) {
      return respondWithJson(404, { error: "not_found" });
    }
    if (!token) return respondWithJson(401, { error: "token_expired" });
    const value = fields.value;
    const placeTime = (wallTime: string) => ({
      dateTime: `${wallTime}:00`,
      ...(timeZone ? { timeZone } : {}),
    });
    const event: CalendarEvent = {
      summary: value.title,
      description: value.notes,
      extendedProperties: {
        private: { [appointmentProjectProperty]: projectId },
      },
      start: value.allDay ? { date: value.start } : placeTime(value.start),
      end: value.allDay ? { date: value.end } : placeTime(value.end),
    };
    try {
      const created = await insertAbodeoEvent({
        accessToken: token.accessToken,
        userId,
        timeZone,
        event,
        store,
        calendar,
        timeout,
        reportFailure,
      });
      return respondWithJson(200, { appointment: toAppointment(created) });
    } catch (error) {
      if (isTokenRefused(error)) {
        return respondWithJson(401, { error: "token_expired" });
      }
      reportFailure("create", readFailureCode(error));
      return respondWithJson(503, { error: "unavailable" });
    }
  } catch (error) {
    reportFailure("request", readFailureCode(error));
    return respondWithError(503, "unavailable");
  }
}
