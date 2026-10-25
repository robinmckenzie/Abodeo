// The Google Calendar calls Abodeo needs, each allowed by the
// calendar.app.created permission alone. Errors carry Google's status code
// only, never its response body. The one thing read from a 403 is whether
// its reason is on a short list, to tell a missing permission from a quota
// limit.

const calendarApi = "https://www.googleapis.com/calendar/v3";

// How long each Calendar call may take. Making a calendar took over 5
// seconds in testing (AD #10), and Google still made it.
export const googleCalendarTimeout = 20_000;

// The most pages of events read before giving up, so that a list is never
// silently short.
export const maxEventPages = 20;

// Google's reasons for a 403 that mean the person has not given Abodeo the
// permission, as opposed to a quota or rate limit.
const missingPermissionReasons = [
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
];

export class GoogleCalendarError extends Error {
  readonly code: string;
  // For a 403 only: true when Google's reason is a missing permission.
  readonly isMissingPermission: boolean;

  constructor(code: string, isMissingPermission = false) {
    super(code);
    this.code = code;
    this.isMissingPermission = isMissingPermission;
  }
}

// A timed event has a date-time, with a time zone or an offset. An all-day
// event has a date, and its end is the day after.
export type EventTime =
  { dateTime: string; timeZone?: string } | { date: string };

export type CalendarEvent = {
  summary: string;
  description: string;
  start: EventTime;
  end: EventTime;
  extendedProperties?: { private: Record<string, string> };
};

// An event as Google holds it.
export type CalendarEventRecord = CalendarEvent & { id: string };

export type GoogleCalendar = {
  // Makes a calendar and gives its ID.
  insertCalendar(
    accessToken: string,
    calendar: { summary: string; timeZone: string | null },
  ): Promise<string>;
  // "not-found" when Google answers 404. A calendar the person deleted in
  // Google Calendar still accepted events in testing (AD #10), so this does
  // not catch that case.
  insertEvent(
    accessToken: string,
    calendarId: string,
    event: CalendarEvent,
  ): Promise<CalendarEventRecord | "not-found">;
  // Every event in the calendar whose private property has the value,
  // earliest first. Rejects if Google does not give them all.
  listEvents(
    accessToken: string,
    calendarId: string,
    property: { name: string; value: string },
  ): Promise<CalendarEventRecord[]>;
  deleteCalendar(accessToken: string, calendarId: string): Promise<void>;
};

type Fetch = typeof fetch;

// Why a request got no answer, such as TimeoutError or ECONNRESET: the
// network error's code, or the error's name. Never its message.
function readFetchFailure(error: unknown) {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const value =
    typeof cause?.code === "string"
      ? cause.code
      : (error as { name?: unknown } | null)?.name;
  return typeof value === "string" && /^[\w-]{1,40}$/.test(value)
    ? value
    : "unknown";
}

function readEventTime(value: unknown): EventTime | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { date, dateTime, timeZone } = value as Record<string, unknown>;
  if (typeof dateTime === "string") {
    return typeof timeZone === "string" ? { dateTime, timeZone } : { dateTime };
  }
  return typeof date === "string" ? { date } : undefined;
}

// An event from Google's answer, or undefined if it lacks what Abodeo needs.
function readEvent(value: unknown): CalendarEventRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, summary, description, start, end, extendedProperties } =
    value as Record<string, unknown>;
  const from = readEventTime(start);
  const to = readEventTime(end);
  if (typeof id !== "string" || !id || !from || !to) return undefined;
  const privateProperties = (
    extendedProperties as { private?: Record<string, unknown> } | undefined
  )?.private;
  const properties: Record<string, string> = {};
  for (const [name, property] of Object.entries(privateProperties ?? {})) {
    if (typeof property === "string") properties[name] = property;
  }
  return {
    id,
    summary: typeof summary === "string" ? summary : "",
    description: typeof description === "string" ? description : "",
    start: from,
    end: to,
    extendedProperties: { private: properties },
  };
}

export function createGoogleCalendar(
  fetchFn: Fetch = fetch,
  timeout = googleCalendarTimeout,
): GoogleCalendar {
  const send = async (
    accessToken: string,
    path: string,
    method: string,
    body?: unknown,
  ) => {
    try {
      return await fetchFn(`${calendarApi}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new GoogleCalendarError(
        `google_unreachable_${readFetchFailure(error)}`,
      );
    }
  };
  // Reads Google's reason for a 403 and keeps only whether it is on the
  // list. The body is read for that and is never kept or logged.
  const fail = async (response: Response) => {
    let isMissingPermission = false;
    if (response.status === 403) {
      const body: unknown = await response.json().catch(() => undefined);
      const error = (body as { error?: Record<string, unknown> } | undefined)
        ?.error;
      const reasons = [
        ...(Array.isArray(error?.errors) ? error.errors : []),
        ...(Array.isArray(error?.details) ? error.details : []),
      ].map((item) => (item as { reason?: unknown } | null)?.reason);
      isMissingPermission = reasons.some(
        (reason) =>
          typeof reason === "string" &&
          missingPermissionReasons.includes(reason),
      );
    }
    return new GoogleCalendarError(
      `google_${response.status}`,
      isMissingPermission,
    );
  };
  const calendarPath = (calendarId: string) =>
    `/calendars/${encodeURIComponent(calendarId)}`;

  return {
    async insertCalendar(accessToken, { summary, timeZone }) {
      const response = await send(accessToken, "/calendars", "POST", {
        summary,
        ...(timeZone ? { timeZone } : {}),
      });
      if (!response.ok) throw await fail(response);
      const body: unknown = await response.json().catch(() => undefined);
      const id = (body as { id?: unknown } | undefined)?.id;
      if (typeof id !== "string" || !id) {
        throw new GoogleCalendarError("google_no_calendar_id");
      }
      return id;
    },
    async insertEvent(accessToken, calendarId, event) {
      const response = await send(
        accessToken,
        `${calendarPath(calendarId)}/events`,
        "POST",
        event,
      );
      if (response.status === 404) return "not-found";
      if (!response.ok) throw await fail(response);
      const created = readEvent(await response.json().catch(() => undefined));
      if (!created) throw new GoogleCalendarError("google_no_event_id");
      return created;
    },
    async listEvents(accessToken, calendarId, { name, value }) {
      const events: CalendarEventRecord[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < maxEventPages; page += 1) {
        const query = new URLSearchParams({
          privateExtendedProperty: `${name}=${value}`,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
          ...(pageToken ? { pageToken } : {}),
        });
        const response = await send(
          accessToken,
          `${calendarPath(calendarId)}/events?${query}`,
          "GET",
        );
        if (!response.ok) throw await fail(response);
        const body: unknown = await response.json().catch(() => undefined);
        const items = (body as { items?: unknown } | undefined)?.items;
        for (const item of Array.isArray(items) ? items : []) {
          const event = readEvent(item);
          if (event) events.push(event);
        }
        const next = (body as { nextPageToken?: unknown } | undefined)
          ?.nextPageToken;
        if (typeof next !== "string" || !next) return events;
        pageToken = next;
      }
      throw new GoogleCalendarError("google_too_many_pages");
    },
    async deleteCalendar(accessToken, calendarId) {
      const response = await send(
        accessToken,
        calendarPath(calendarId),
        "DELETE",
      );
      if (!response.ok) throw await fail(response);
    },
  };
}
