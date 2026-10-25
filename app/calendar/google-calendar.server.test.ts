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
      Response.json({ id: "event", ...event }),
      new Response(null, { status: 404 }),
    );
    const calendar = createGoogleCalendar(fetchFn as typeof fetch);

    expect(await calendar.insertEvent("token", "a@b c", event)).toMatchObject({
      id: "event",
    });
    expect(await calendar.insertEvent("token", "a@b c", event)).toBe(
      "not-found",
    );
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/a%40b%20c/events",
    );
  });

  it("sends the project property and gives the created event back", async () => {
    const fetchFn = fakeFetch(
      Response.json({
        id: "e1",
        summary: "Visit",
        start: { date: "2026-11-01" },
        end: { date: "2026-11-02" },
        extendedProperties: { private: { abodeoProject: "p1" } },
      }),
    );
    const calendar = createGoogleCalendar(fetchFn as typeof fetch);

    const created = await calendar.insertEvent("token", "id", {
      ...event,
      extendedProperties: { private: { abodeoProject: "p1" } },
    });

    expect(JSON.parse(String(fetchFn.mock.calls[0][1].body))).toMatchObject({
      extendedProperties: { private: { abodeoProject: "p1" } },
    });
    expect(created).toEqual({
      id: "e1",
      summary: "Visit",
      description: "",
      start: { date: "2026-11-01" },
      end: { date: "2026-11-02" },
      extendedProperties: { private: { abodeoProject: "p1" } },
    });
  });

  it("lists a property's events across pages, skipping unreadable ones", async () => {
    const item = (id: string) => ({
      id,
      summary: id,
      start: { dateTime: "2026-11-02T10:00:00Z", timeZone: "Europe/London" },
      end: { dateTime: "2026-11-02T11:00:00Z" },
    });
    const fetchFn = fakeFetch(
      Response.json({ items: [item("a"), { nope: true }], nextPageToken: "t" }),
      Response.json({ items: [item("b")] }),
    );
    const calendar = createGoogleCalendar(fetchFn as typeof fetch);

    const events = await calendar.listEvents("token", "a@b", {
      name: "abodeoProject",
      value: "p 1",
    });

    expect(events.map(({ id }) => id)).toEqual(["a", "b"]);
    const first = new URL(fetchFn.mock.calls[0][0]);
    expect(first.pathname).toBe("/calendar/v3/calendars/a%40b/events");
    expect(first.searchParams.get("privateExtendedProperty")).toBe(
      "abodeoProject=p 1",
    );
    expect(first.searchParams.get("singleEvents")).toBe("true");
    expect(first.searchParams.get("orderBy")).toBe("startTime");
    expect(
      new URL(fetchFn.mock.calls[1][0]).searchParams.get("pageToken"),
    ).toBe("t");
  });

  it("rejects rather than give a short list when there are too many pages", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ items: [], nextPageToken: "more" }),
    );
    const calendar = createGoogleCalendar(fetchFn as unknown as typeof fetch);

    const error = await calendar
      .listEvents("token", "id", { name: "n", value: "v" })
      .catch((caught: unknown) => caught);

    expect((error as GoogleCalendarError).code).toBe("google_too_many_pages");
    expect(fetchFn).toHaveBeenCalledTimes(20);
  });

  it("tells a missing permission from a quota limit on a 403", async () => {
    const forbid = (reason: string) =>
      createGoogleCalendar(
        fakeFetch(
          Response.json(
            { error: { errors: [{ reason, message: "secret text" }] } },
            { status: 403 },
          ),
        ) as typeof fetch,
      )
        .listEvents("token", "id", { name: "n", value: "v" })
        .then(
          () => {
            throw new Error("expected a rejection");
          },
          (error: unknown) => error as GoogleCalendarError,
        );

    const missing = await forbid("insufficientPermissions");
    const quota = await forbid("rateLimitExceeded");

    expect(missing.isMissingPermission).toBe(true);
    expect(quota.isMissingPermission).toBe(false);
    expect(missing.code).toBe("google_403");
    expect(missing.message).not.toContain("secret");
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
