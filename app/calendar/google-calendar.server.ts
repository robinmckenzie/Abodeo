// The Google Calendar calls the test needs, each allowed by the
// calendar.app.created permission alone. Errors carry Google's status code
// only, never its response body.

const calendarApi = "https://www.googleapis.com/calendar/v3";

// How long each Calendar call may take.
export const googleCalendarTimeout = 5000;

export class GoogleCalendarError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type CalendarEvent = {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
};

export type GoogleCalendar = {
  // Makes a calendar and gives its ID.
  insertCalendar(
    accessToken: string,
    calendar: { summary: string; timeZone: string | null },
  ): Promise<string>;
  // "not-found" when the calendar no longer exists, such as after the person
  // deleted it.
  insertEvent(
    accessToken: string,
    calendarId: string,
    event: CalendarEvent,
  ): Promise<"created" | "not-found">;
  deleteCalendar(accessToken: string, calendarId: string): Promise<void>;
};

type Fetch = typeof fetch;

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
    } catch {
      throw new GoogleCalendarError("google_unreachable");
    }
  };
  const fail = (response: Response) =>
    new GoogleCalendarError(`google_${response.status}`);
  const calendarPath = (calendarId: string) =>
    `/calendars/${encodeURIComponent(calendarId)}`;

  return {
    async insertCalendar(accessToken, { summary, timeZone }) {
      const response = await send(accessToken, "/calendars", "POST", {
        summary,
        ...(timeZone ? { timeZone } : {}),
      });
      if (!response.ok) throw fail(response);
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
      if (!response.ok) throw fail(response);
      return "created";
    },
    async deleteCalendar(accessToken, calendarId) {
      const response = await send(
        accessToken,
        calendarPath(calendarId),
        "DELETE",
      );
      if (!response.ok) throw fail(response);
    },
  };
}
