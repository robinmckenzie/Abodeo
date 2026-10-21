// The Google Calendar calls the test needs, each allowed by the
// calendar.app.created permission alone. Errors carry Google's status code
// only, never its response body.

const calendarApi = "https://www.googleapis.com/calendar/v3";

// How long each Calendar call may take. Making a calendar took over 5
// seconds in testing (AD #10), and Google still made it.
export const googleCalendarTimeout = 20_000;

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
  // "not-found" when Google answers 404. A calendar the person deleted in
  // Google Calendar still accepted events in testing (AD #10), so this does
  // not catch that case.
  insertEvent(
    accessToken: string,
    calendarId: string,
    event: CalendarEvent,
  ): Promise<"created" | "not-found">;
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
