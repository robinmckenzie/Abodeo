// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { handleAppointmentRequest } from "./appointment-handler.server";
import type { CalendarRequestDependencies } from "./calendar-handler.server";
import { createCalendarTokenCookie } from "./calendar-token.server";
import {
  createFakeCalendarDependencies,
  testAccessToken,
  testSecret,
} from "./test-calendar.server";

const origin = "http://localhost:5173";
const startTime = Date.parse("2026-10-21T09:20:00Z");
const minute = 60_000;

function setUp() {
  const fakes = createFakeCalendarDependencies();
  fakes.projects.add("user-1/p-1");
  fakes.projects.add("user-1/p-2");
  fakes.projects.add("user-1/3f2a-copy-9c1d");
  fakes.projects.add("user-2/p-1");
  const failures: [string, string | undefined][] = [];
  const session = { userId: "user-1" as string | undefined };
  const dependencies: CalendarRequestDependencies = {
    ...fakes.dependencies,
    readSessionUserId: async () => session.userId,
    now: () => startTime,
    reportFailure: (stage, code) => failures.push([stage, code]),
  };
  return { ...fakes, dependencies, failures, session };
}

type TestSetUp = ReturnType<typeof setUp>;
type Options = { cookie?: string; account?: string | null };

// The Cookie header for a token made for the account.
async function tokenCookie(userId = "user-1", expiresIn = 59 * minute) {
  const setCookie = await createCalendarTokenCookie({
    secret: testSecret,
    isSecure: false,
    accessToken: testAccessToken,
    userId,
    expiresAt: startTime + expiresIn,
    now: startTime,
  });
  return setCookie.split(";")[0];
}

function headersFor({ cookie, account = "user-1" }: Options) {
  return {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(account ? { "X-Abodeo-Account": account } : {}),
  };
}

function get(path: string, options: Options = {}) {
  return new Request(`${origin}${path}`, { headers: headersFor(options) });
}

function post(body: Record<string, unknown>, options: Options = {}) {
  return new Request(`${origin}/api/calendar/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersFor(options) },
    body: JSON.stringify(body),
  });
}

const timed = {
  projectId: "p-1",
  title: "Site visit",
  notes: "Bring keys",
  allDay: false,
  start: "2026-11-02T10:00",
  end: "2026-11-02T11:00",
  timeZone: "Europe/London",
};

type Listed = { status: string; appointments: { title: string }[] };

async function list(test: TestSetUp, projectId: string, cookie?: string) {
  const response = await handleAppointmentRequest(
    get(`/api/calendar/appointments?projectId=${projectId}`, { cookie }),
    test.dependencies,
  );
  return { status: response.status, body: (await response.json()) as Listed };
}

function add(test: TestSetUp, body: Record<string, unknown>, cookie?: string) {
  return handleAppointmentRequest(post(body, { cookie }), test.dependencies);
}

const titles = (listed: Listed) =>
  listed.appointments.map((appointment) => appointment.title);

describe("who may ask", () => {
  it("refuses a request that is not signed in, names no account or names another", async () => {
    const test = setUp();
    const paths = [
      "/api/calendar/connection",
      "/api/calendar/appointments?projectId=p-1",
    ];
    for (const path of paths) {
      const noAccount = await handleAppointmentRequest(
        get(path, { account: null }),
        test.dependencies,
      );
      expect(noAccount.status).toBe(400);
      const other = await handleAppointmentRequest(
        get(path, { account: "user-2" }),
        test.dependencies,
      );
      expect(other.status).toBe(409);
      expect(await other.json()).toEqual({ error: "account_changed" });
    }
    test.session.userId = undefined;
    const signedOut = await handleAppointmentRequest(
      get(paths[1], { cookie: await tokenCookie() }),
      test.dependencies,
    );
    expect(signedOut.status).toBe(401);
  });

  it("refuses a post from another site or without JSON, and other methods", async () => {
    const test = setUp();
    const cookie = await tokenCookie();
    const crossSite = post(timed, { cookie });
    crossSite.headers.set("Origin", "https://evil.example");
    const text = new Request(`${origin}/api/calendar/appointments`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Abodeo-Account": "user-1" },
      body: "{}",
    });
    const put = new Request(`${origin}/api/calendar/appointments`, {
      method: "PUT",
    });

    const statuses = [];
    for (const request of [crossSite, text, put]) {
      statuses.push(
        (await handleAppointmentRequest(request, test.dependencies)).status,
      );
    }

    expect(statuses).toEqual([403, 400, 405]);
    expect(test.calendar.calendars.size).toBe(0);
  });

  it("never uses another account's token", async () => {
    const test = setUp();
    const others = await tokenCookie("user-2");

    expect((await list(test, "p-1", others)).body).toEqual({
      status: "needs-grant",
      connectedBefore: false,
    });
    expect((await add(test, timed, others)).status).toBe(401);
    expect(test.calendar.tokensUsed).toEqual([]);
  });

  it("keeps two accounts with the same project id apart", async () => {
    const test = setUp();
    await add(test, timed, await tokenCookie());
    test.session.userId = "user-2";
    const asSecond = (path: string) =>
      handleAppointmentRequest(
        get(path, { cookie: "", account: "user-2" }),
        test.dependencies,
      );

    const response = await asSecond("/api/calendar/appointments?projectId=p-1");

    expect(await response.json()).toMatchObject({ status: "needs-grant" });
  });
});

describe("the connection", () => {
  async function isReady(cookie?: string) {
    const response = await handleAppointmentRequest(
      get("/api/calendar/connection", { cookie }),
      setUp().dependencies,
    );
    return ((await response.json()) as { ready: boolean }).ready;
  }

  it("is ready for a token with more than five minutes left only", async () => {
    expect(await isReady(await tokenCookie("user-1", 30 * minute))).toBe(true);
    expect(await isReady(await tokenCookie("user-1", 4 * minute))).toBe(false);
    expect(await isReady(await tokenCookie("user-2"))).toBe(false);
    expect(await isReady()).toBe(false);
  });
});

describe("adding appointments", () => {
  it("adds a timed appointment to the Abodeo calendar with the project property", async () => {
    const test = setUp();

    const response = await add(test, timed, await tokenCookie());

    expect(response.status).toBe(200);
    const [[id, calendar]] = [...test.calendar.calendars];
    expect(test.store.links.get("user-1")).toBe(id);
    expect(calendar.events).toEqual([
      expect.objectContaining({
        summary: "Site visit",
        description: "Bring keys",
        start: { dateTime: "2026-11-02T10:00:00", timeZone: "Europe/London" },
        end: { dateTime: "2026-11-02T11:00:00", timeZone: "Europe/London" },
        extendedProperties: { private: { abodeoProject: "p-1" } },
      }),
    ]);
    expect(await response.json()).toMatchObject({
      appointment: { title: "Site visit", allDay: false },
    });
  });

  it("adds an all-day appointment ending on the day after", async () => {
    const test = setUp();

    await add(
      test,
      { ...timed, allDay: true, start: "2026-12-31", end: "" },
      await tokenCookie(),
    );

    const [[, calendar]] = [...test.calendar.calendars];
    expect(calendar.events[0]).toMatchObject({
      start: { date: "2026-12-31" },
      end: { date: "2027-01-01" },
    });
  });

  it("refuses bad fields and projects that are not the account's, creating nothing", async () => {
    const test = setUp();
    const cookie = await tokenCookie();
    const bad = [
      { ...timed, title: " " },
      { ...timed, end: timed.start },
      { ...timed, projectId: "../x" },
      { ...timed, allDay: "yes" },
      { ...timed, timeZone: "not a zone" },
    ];
    for (const body of bad) {
      expect((await add(test, body, cookie)).status).toBe(400);
    }

    const missing = await add(test, { ...timed, projectId: "p-9" }, cookie);

    expect(missing.status).toBe(404);
    expect(test.calendar.calendars.size).toBe(0);
  });

  it("will not add to another account's project", async () => {
    const test = setUp();
    test.projects.delete("user-1/p-2");

    const response = await add(
      test,
      { ...timed, projectId: "p-2" },
      await tokenCookie(),
    );

    expect(response.status).toBe(404);
    expect(test.calendar.calendars.size).toBe(0);
  });

  it("creates nothing and says so when the token has expired or is missing", async () => {
    const test = setUp();

    const missing = await add(test, timed);
    const expired = await add(
      test,
      timed,
      await tokenCookie("user-1", -minute),
    );

    for (const response of [missing, expired]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "token_expired" });
    }
    expect(test.calendar.calendars.size).toBe(0);
  });

  it("reports a token Google refuses, and an unreachable Google", async () => {
    const test = setUp();
    const cookie = await tokenCookie();
    test.calendar.failures.insertCalendar = "google_401";
    expect((await add(test, timed, cookie)).status).toBe(401);
    test.calendar.failures.insertCalendar = "google_500";
    expect((await add(test, timed, cookie)).status).toBe(503);
    expect(test.failures).toContainEqual(["create", "google_500"]);
  });
});

describe("listing a project's appointments", () => {
  it("shows only the project's appointments, earliest first, whatever the id looks like", async () => {
    const test = setUp();
    const cookie = await tokenCookie();
    await add(
      test,
      {
        ...timed,
        title: "Later",
        start: "2026-11-05T10:00",
        end: "2026-11-05T11:00",
      },
      cookie,
    );
    await add(test, { ...timed, title: "Earlier" }, cookie);
    await add(test, { ...timed, projectId: "p-2", title: "Elsewhere" }, cookie);
    await add(
      test,
      { ...timed, projectId: "3f2a-copy-9c1d", title: "A copy" },
      cookie,
    );

    const first = await list(test, "p-1", cookie);
    const copy = await list(test, "3f2a-copy-9c1d", cookie);

    expect(first.body.status).toBe("ok");
    expect(titles(first.body)).toEqual(["Earlier", "Later"]);
    expect(titles(copy.body)).toEqual(["A copy"]);
  });

  it("gives an empty list when there is no Abodeo calendar yet but a token", async () => {
    const test = setUp();
    expect((await list(test, "p-1", await tokenCookie())).body).toEqual({
      status: "ok",
      appointments: [],
    });
  });

  it("asks for a grant without a token, saying whether Calendar was connected before", async () => {
    const test = setUp();
    expect((await list(test, "p-1")).body).toEqual({
      status: "needs-grant",
      connectedBefore: false,
    });
    test.store.links.set("user-1", "calendar-1");
    expect((await list(test, "p-1")).body).toEqual({
      status: "needs-grant",
      connectedBefore: true,
    });
    const expired = await list(
      test,
      "p-1",
      await tokenCookie("user-1", -minute),
    );
    expect(expired.body.status).toBe("needs-grant");
  });

  it("asks for a grant when Google refuses the token, but says unavailable for other failures", async () => {
    const test = setUp();
    const cookie = await tokenCookie();
    test.store.links.set("user-1", "calendar-1");

    test.calendar.failures.listEvents = "google_401";
    expect((await list(test, "p-1", cookie)).body.status).toBe("needs-grant");
    for (const code of [
      "google_403",
      "google_404",
      "google_500",
      "google_unreachable_TimeoutError",
      "google_too_many_pages",
    ]) {
      test.calendar.failures.listEvents = code;
      expect((await list(test, "p-1", cookie)).body).toEqual({
        status: "unavailable",
      });
    }
  });

  it("refuses a project the account does not have, and a bad id", async () => {
    const test = setUp();
    expect((await list(test, "p-9", await tokenCookie())).status).toBe(404);
    expect((await list(test, "a%20b")).status).toBe(400);
  });
});

describe("secrets", () => {
  it("never puts the token in a response, a store or a log", async () => {
    const test = setUp();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cookie = await tokenCookie();
    test.calendar.failures.listEvents = "google_500";
    test.store.links.set("user-1", "calendar-1");

    const answers = [
      await handleAppointmentRequest(
        get("/api/calendar/connection", { cookie }),
        test.dependencies,
      ),
      await handleAppointmentRequest(
        get("/api/calendar/appointments?projectId=p-1", { cookie }),
        test.dependencies,
      ),
      await add(test, timed, cookie),
    ];

    for (const response of answers) {
      expect(await response.text()).not.toContain(testAccessToken);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    expect(JSON.stringify([...test.store.links])).not.toContain(
      testAccessToken,
    );
    expect(test.store.written.join(",")).not.toContain(testAccessToken);
    expect(JSON.stringify([log.mock.calls, test.failures])).not.toContain(
      testAccessToken,
    );
    log.mockRestore();
  });
});
