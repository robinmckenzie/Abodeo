// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createGoogleCalendar,
  GoogleCalendarError,
} from "./google-calendar.server";

function fakeFetch(...responses: Response[]) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => {
      const response = responses.shift();
      if (!response) throw new Error("no response");
      return response;
    },
  );
}

const event = {
  summary: "Abodeo test appointment",
  description: "Test",
  start: { dateTime: "2026-10-21T10:00:00.000Z" },
  end: { dateTime: "2026-10-21T10:30:00.000Z" },
};

describe("createGoogleCalendar", () => {
  it("makes a calendar with the token and gives its ID", async () => {
    const fetchFn = fakeFetch(
      Response.json({ id: "abc@group.calendar.google.com" }),
    );
    const calendar = createGoogleCalendar(fetchFn as typeof fetch);

    const id = await calendar.insertCalendar("token", {
      summary: "Abodeo",
      timeZone: "Europe/London",
    });

    expect(id).toBe("abc@group.calendar.google.com");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
    expect(JSON.parse(String(init.body))).toEqual({
      summary: "Abodeo",
      timeZone: "Europe/London",
    });
  });

  it("adds an event, and reports a calendar that no longer exists", async () => {
    const fetchFn = fakeFetch(
      Response.json({ id: "event" }),
      new Response(null, { status: 404 }),
    );
    const calendar = createGoogleCalendar(fetchFn as typeof fetch);

    expect(await calendar.insertEvent("token", "a@b c", event)).toBe("created");
    expect(await calendar.insertEvent("token", "a@b c", event)).toBe(
      "not-found",
    );
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/a%40b%20c/events",
    );
  });

  it("deletes a calendar", async () => {
    const fetchFn = fakeFetch(new Response(null, { status: 204 }));
    const calendar = createGoogleCalendar(fetchFn as typeof fetch);

    await calendar.deleteCalendar("token", "spare");

    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/spare",
    );
    expect(fetchFn.mock.calls[0][1].method).toBe("DELETE");
  });

  it("reports failures by status code only", async () => {
    const calendar = createGoogleCalendar(
      fakeFetch(
        Response.json(
          { error: { message: "private details" } },
          { status: 403 },
        ),
      ) as typeof fetch,
    );
    const unreachable = createGoogleCalendar(fakeFetch() as typeof fetch);

    const refused = await calendar
      .insertEvent("token", "id", event)
      .catch((error: unknown) => error);
    const lost = await unreachable
      .deleteCalendar("token", "id")
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(GoogleCalendarError);
    expect((refused as GoogleCalendarError).code).toBe("google_403");
    expect((refused as Error).message).not.toContain("private");
    expect((lost as GoogleCalendarError).code).toBe("google_unreachable_Error");
  });
});
