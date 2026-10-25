// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { testConfig } from "../account/test-account.server";
import {
  calendarGrantCookieName,
  calendarGrantLifetime,
  calendarScope,
  createCalendarGoogle,
} from "./calendar-grant.server";
import {
  buildTestAppointment,
  findNextWholeHour,
  handleCalendarRequest,
  normaliseTimeZone,
  testAppointmentTitle,
  type CalendarRequestDependencies,
} from "./calendar-handler.server";
import {
  createFakeCalendarDependencies,
  testAccessToken,
  testIdToken,
} from "./test-calendar.server";

const origin = "http://localhost:5173";
const startTime = Date.parse("2026-10-21T09:20:00Z");

function setUp({ userId = "user-1" as string | undefined } = {}) {
  const fakes = createFakeCalendarDependencies();
  fakes.store.googleAccounts.set("user-1", "google-sub-1");
  fakes.store.googleAccounts.set("user-2", "google-sub-2");
  const failures: [string, string | undefined][] = [];
  const session = { userId };
  let time = startTime;
  const dependencies: CalendarRequestDependencies = {
    ...fakes.dependencies,
    readSessionUserId: async () => session.userId,
    now: () => time,
    reportFailure: (stage, code) => failures.push([stage, code]),
  };
  const handle = (request: Request) =>
    handleCalendarRequest(request, dependencies);
  const advance = (milliseconds: number) => {
    time += milliseconds;
  };
  return { ...fakes, dependencies, failures, session, handle, advance };
}

type TestSetUp = ReturnType<typeof setUp>;

function postStart(
  body: unknown = { timeZone: "Europe/London" },
  contentType = "application/json",
) {
  return new Request(`${origin}/api/calendar/test-appointment`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

// Starts the grant, giving the cookie, the state and Google's address.
async function start(test: TestSetUp, body?: unknown) {
  const response = await test.handle(postStart(body));
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  return {
    setCookie,
    cookie: setCookie.split(";")[0],
    state: new URL(url).searchParams.get("state") ?? "",
    url: new URL(url),
  };
}

function callback(query: string, cookie?: string) {
  return new Request(`${origin}/api/calendar/callback?${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

// Goes through Google and back, giving the result in the dashboard address.
async function runTest(test: TestSetUp, body?: unknown) {
  const { cookie, state } = await start(test, body);
  const response = await test.handle(
    callback(`state=${encodeURIComponent(state)}&code=google-code`, cookie),
  );
  return readResult(response);
}

function readResult(response: Response) {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("Location") ?? "");
  expect(location.pathname).toBe("/dashboard");
  return location.searchParams.get("calendar");
}

function eventCount(test: TestSetUp) {
  return [...test.calendar.calendars.values()].reduce(
    (count, calendar) => count + calendar.events.length,
    0,
  );
}

describe("starting the Calendar test", () => {
  it("refuses anything but a JSON post from a signed-in account", async () => {
    const test = setUp();
    expect((await test.handle(postStart({}, "text/plain"))).status).toBe(400);
    expect(
      (
        await test.handle(
          new Request(`${origin}/api/calendar/test-appointment`),
        )
      ).status,
    ).toBe(405);
    test.session.userId = undefined;
    const signedOut = await test.handle(postStart());
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("Set-Cookie")).toBeNull();
  });

  it("sets a short-lived cookie for the Calendar paths only, and suggests the signed-in Google account", async () => {
    const test = setUp();
    const { setCookie, url } = await start(test);

    expect(setCookie).toMatch(new RegExp(`^${calendarGrantCookieName}=[^;]+;`));
    expect(setCookie).toContain("Path=/api/calendar");
    expect(setCookie).toContain(`Max-Age=${calendarGrantLifetime / 1000}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
    expect(url.searchParams.get("login_hint")).toBe("google-sub-1");
    // The cookie is encrypted: neither the verifier nor the account shows.
    expect(setCookie).not.toContain(url.searchParams.get("test_verifier"));
    expect(setCookie).not.toContain("user-1");
  });

  it("marks the cookie Secure over https", async () => {
    const test = setUp();
    test.dependencies.isSecure = true;
    const { setCookie } = await start(test);
    expect(setCookie).toContain("Secure");
  });

  it("reports the test as unavailable when the database fails", async () => {
    const test = setUp();
    test.store.hooks.fail = Object.assign(new Error("connection details"), {
      code: "ECONNREFUSED",
    });
    const response = await test.handle(postStart());
    expect(response.status).toBe(503);
    expect(test.failures).toEqual([["start", "ECONNREFUSED"]]);
  });
});

describe("Google's Calendar address", () => {
  it("asks only for the Calendar permission, online, without earlier permissions or a consent prompt", async () => {
    const google = createCalendarGoogle(testConfig);
    const url = await google.createAuthorizationURL({
      state: "state-1",
      codeVerifier: "v".repeat(64),
      loginHint: "google-sub-1",
    });

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    const parameters = url.searchParams;
    expect(parameters.get("scope")?.split(" ")).toEqual([
      "openid",
      calendarScope,
    ]);
    expect(parameters.get("access_type")).toBe("online");
    expect(parameters.get("include_granted_scopes")).toBe("false");
    expect(parameters.get("login_hint")).toBe("google-sub-1");
    expect(parameters.get("state")).toBe("state-1");
    expect(parameters.get("code_challenge_method")).toBe("S256");
    expect(parameters.get("code_challenge")).toBeTruthy();
    expect(parameters.has("prompt")).toBe(false);
    expect(parameters.get("redirect_uri")).toBe(
      `${testConfig.baseUrl}/api/calendar/callback`,
    );
  });
});

describe("returning from Google", () => {
  it("makes the Abodeo calendar and the appointment on first use", async () => {
    const test = setUp();

    const { cookie, state } = await start(test);
    const response = await test.handle(
      callback(`state=${state}&code=google-code`, cookie),
    );

    expect(readResult(response)).toBe("created");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(test.google.exchanges).toEqual([
      { code: "google-code", codeVerifier: expect.any(String) },
    ]);
    const [[id, calendar]] = [...test.calendar.calendars];
    expect(calendar.summary).toBe("Abodeo");
    expect(calendar.events).toHaveLength(1);
    expect(calendar.events[0].summary).toBe(testAppointmentTitle);
    expect(test.store.links.get("user-1")).toBe(id);
  });

  it("reuses the same calendar next time", async () => {
    const test = setUp();
    expect(await runTest(test)).toBe("created");
    expect(await runTest(test)).toBe("created");

    expect(test.calendar.calendars.size).toBe(1);
    expect(eventCount(test)).toBe(2);
  });

  it("makes a new calendar when the old one was deleted, and keeps its ID instead", async () => {
    const test = setUp();
    await runTest(test);
    const oldId = test.store.links.get("user-1") ?? "";
    test.calendar.calendars.delete(oldId);

    expect(await runTest(test)).toBe("created");

    const newId = test.store.links.get("user-1");
    expect(newId).not.toBe(oldId);
    expect(test.calendar.calendars.get(newId ?? "")?.events).toHaveLength(1);
  });

  it("reports a refusal at Google as denied", async () => {
    const test = setUp();
    const { cookie, state } = await start(test);
    const response = await test.handle(
      callback(`error=access_denied&state=${state}`, cookie),
    );

    expect(readResult(response)).toBe("denied");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(test.google.exchanges).toHaveLength(0);
  });

  it("believes a refusal only with the grant's cookie and state", async () => {
    const test = setUp();
    const { cookie, state } = await start(test);

    const withoutCookie = await test.handle(
      callback(`error=access_denied&state=${state}`),
    );
    const wrongState = await test.handle(
      callback("error=access_denied&state=other", cookie),
    );

    expect(readResult(withoutCookie)).toBe("failed");
    expect(readResult(wrongState)).toBe("failed");
  });

  it("logs no code or Google answer when the real token exchange fails", async () => {
    const test = setUp();
    test.dependencies.google = createCalendarGoogle(testConfig);
    test.dependencies.reportFailure = undefined;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const googleFetch = vi.fn(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "private-detail" },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", googleFetch);
    try {
      const { cookie, state } = await start(test);
      const response = await test.handle(
        callback(`state=${state}&code=google-code`, cookie),
      );

      expect(readResult(response)).toBe("failed");
      expect(googleFetch).toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
      const output = JSON.stringify(logged.mock.calls);
      expect(output).not.toContain("private-detail");
      expect(output).not.toContain("google-code");
      expect(output).not.toContain("invalid_grant");
    } finally {
      vi.unstubAllGlobals();
      logged.mockRestore();
    }
  });

  it("logs Google's other errors only by known code", async () => {
    const test = setUp();
    const { cookie, state } = await start(test);

    await test.handle(callback(`error=server_error&state=${state}`, cookie));
    await test.handle(
      callback(`error=private-note-from-someone&state=${state}`, cookie),
    );

    expect(test.failures).toEqual([
      ["google", "server_error"],
      ["google", "other"],
    ]);
  });

  it("waits for Google's token exchange longer than for the database", async () => {
    const test = setUp();
    test.dependencies.timeout = 20;
    const exchange = test.google.google.exchangeCode;
    test.google.google.exchangeCode = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return exchange(input);
    };

    expect(await runTest(test)).toBe("created");
  });

  it("reports an unticked Calendar permission as denied", async () => {
    const test = setUp();
    test.google.answer.tokens = {
      ...test.google.answer.tokens,
      scopes: ["openid"],
    };

    expect(await runTest(test)).toBe("denied");
    expect(test.calendar.calendars.size).toBe(0);
  });

  it("refuses a different Google account from the signed-in one", async () => {
    const test = setUp();
    test.google.answer.subject = "google-sub-other";

    expect(await runTest(test)).toBe("wrong-account");
    expect(test.calendar.calendars.size).toBe(0);
    expect(test.store.links.size).toBe(0);
  });

  it("fails without exchanging the code when the cookie is missing, unreadable or expired", async () => {
    const test = setUp();
    const { cookie, state } = await start(test);

    const missing = await test.handle(callback(`state=${state}&code=c`));
    const unreadable = await test.handle(
      callback(`state=${state}&code=c`, `${calendarGrantCookieName}=nonsense`),
    );
    test.advance(calendarGrantLifetime);
    const expired = await test.handle(
      callback(`state=${state}&code=c`, cookie),
    );

    for (const response of [missing, unreadable, expired]) {
      expect(readResult(response)).toBe("failed");
    }
    expect(test.google.exchanges).toHaveLength(0);
    expect(test.failures.map(([, code]) => code)).toEqual([
      "grant_missing",
      "grant_unreadable",
      "grant_expired",
    ]);
  });

  it("fails when the state does not match or another account is signed in", async () => {
    const test = setUp();
    const { cookie, state } = await start(test);

    const wrongState = await test.handle(
      callback("state=other&code=c", cookie),
    );
    test.session.userId = "user-2";
    const otherAccount = await test.handle(
      callback(`state=${state}&code=c`, cookie),
    );
    test.session.userId = undefined;
    const signedOut = await test.handle(
      callback(`state=${state}&code=c`, cookie),
    );

    for (const response of [wrongState, otherAccount, signedOut]) {
      expect(readResult(response)).toBe("failed");
    }
    expect(test.google.exchanges).toHaveLength(0);
  });

  it("fails, never reporting success, when Google or the database fails", async () => {
    const google = setUp();
    google.calendar.failures.insertEvent = "google_500";
    expect(await runTest(google)).toBe("failed");
    expect(google.failures).toContainEqual(["appointment", "google_500"]);

    const database = setUp();
    const { cookie, state } = await start(database);
    database.store.hooks.fail = Object.assign(new Error("details"), {
      code: "57P01",
    });
    const response = await database.handle(
      callback(`state=${state}&code=c`, cookie),
    );
    expect(readResult(response)).toBe("failed");
    expect(database.calendar.calendars.size).toBe(0);

    const exchange = setUp();
    exchange.google.google.exchangeCode = async () => {
      throw new Error("token endpoint");
    };
    expect(await runTest(exchange)).toBe("failed");
  });

  it("waits for Google longer than for the database, as making a calendar can be slow", async () => {
    const test = setUp();
    test.dependencies.timeout = 20;
    const insert = test.calendar.calendar.insertCalendar;
    test.calendar.calendar.insertCalendar = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return insert(...args);
    };

    expect(await runTest(test)).toBe("created");
    expect(test.calendar.calendars.size).toBe(1);
  });

  it("keeps one calendar when another test saves the first calendar at the same time", async () => {
    const test = setUp();
    const winner = await test.calendar.calendar.insertCalendar("other", {
      summary: "Abodeo",
      timeZone: null,
    });
    test.store.hooks.beforeSave = () => {
      test.store.links.set("user-1", winner);
      test.store.hooks.beforeSave = undefined;
    };

    expect(await runTest(test)).toBe("created");

    expect(test.store.links.get("user-1")).toBe(winner);
    expect([...test.calendar.calendars.keys()]).toEqual([winner]);
    expect(test.calendar.calendars.get(winner)?.events).toHaveLength(1);
  });

  it("keeps one calendar when another test replaces a deleted calendar at the same time", async () => {
    const test = setUp();
    await runTest(test);
    test.calendar.calendars.delete(test.store.links.get("user-1") ?? "");
    const winner = await test.calendar.calendar.insertCalendar("other", {
      summary: "Abodeo",
      timeZone: null,
    });
    test.store.hooks.beforeSave = () => {
      test.store.links.set("user-1", winner);
      test.store.hooks.beforeSave = undefined;
    };

    expect(await runTest(test)).toBe("created");

    expect(test.store.links.get("user-1")).toBe(winner);
    expect([...test.calendar.calendars.keys()]).toEqual([winner]);
    expect(test.calendar.calendars.get(winner)?.events).toHaveLength(1);
  });

  it("still creates the appointment when the spare calendar cannot be deleted", async () => {
    const test = setUp();
    const winner = await test.calendar.calendar.insertCalendar("other", {
      summary: "Abodeo",
      timeZone: null,
    });
    test.store.hooks.beforeSave = () => {
      test.store.links.set("user-1", winner);
    };
    test.calendar.failures.deleteCalendar = "google_503";

    expect(await runTest(test)).toBe("created");
    expect(test.calendar.calendars.get(winner)?.events).toHaveLength(1);
    expect(test.failures).toEqual([["spare_calendar_left", "google_503"]]);
  });

  it("passes no token or code to the database or the logs", async () => {
    const test = setUp();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    test.calendar.failures.insertEvent = "google_500";
    await runTest(test);
    test.calendar.failures.insertEvent = undefined;
    await runTest(test);

    const kept = JSON.stringify([
      test.store.written,
      test.failures,
      logged.mock.calls,
    ]);
    for (const secret of [testAccessToken, testIdToken, "google-code"]) {
      expect(kept).not.toContain(secret);
    }
    expect(
      test.calendar.tokensUsed.every((token) => token === testAccessToken),
    ).toBe(true);
    logged.mockRestore();
  });
});

describe("the test appointment", () => {
  it("accepts only IANA time zone names", () => {
    expect(normaliseTimeZone("Europe/London")).toBe("Europe/London");
    expect(normaliseTimeZone("UTC")).toBe("UTC");
    for (const value of ["+01:00", "Not/AZone", "", 3, null, "a".repeat(65)]) {
      expect(normaliseTimeZone(value)).toBeNull();
    }
  });

  it("starts at the next whole hour in the person's time zone and lasts 30 minutes", () => {
    const now = Date.parse("2026-10-21T09:20:30.500Z");
    expect(new Date(findNextWholeHour(now, null)).toISOString()).toBe(
      "2026-10-21T10:00:00.000Z",
    );
    // India is 5 hours 30 minutes ahead, so its next whole hour is at 09:30
    // UTC.
    expect(new Date(findNextWholeHour(now, "Asia/Kolkata")).toISOString()).toBe(
      "2026-10-21T09:30:00.000Z",
    );
    expect(
      new Date(
        findNextWholeHour(Date.parse("2026-10-21T10:00:00Z"), null),
      ).toISOString(),
    ).toBe("2026-10-21T11:00:00.000Z");

    const appointment = buildTestAppointment(now, "Europe/London");
    expect(appointment.start).toEqual({
      dateTime: "2026-10-21T10:00:00.000Z",
      timeZone: "Europe/London",
    });
    expect(appointment.end).toEqual({
      dateTime: "2026-10-21T10:30:00.000Z",
      timeZone: "Europe/London",
    });
  });

  it("gives the new calendar the browser's time zone", async () => {
    const test = setUp();
    const insert = vi.spyOn(test.calendar.calendar, "insertCalendar");
    await runTest(test, { timeZone: "Europe/London" });
    expect(insert).toHaveBeenCalledWith(testAccessToken, {
      summary: "Abodeo",
      timeZone: "Europe/London",
    });
  });
});

describe("a grant for a project's appointments", () => {
  function postProjectStart(
    body: Record<string, unknown>,
    account: string | null = "user-1",
  ) {
    return new Request(`${origin}/api/calendar/test-appointment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(account ? { "X-Abodeo-Account": account } : {}),
      },
      body: JSON.stringify({ timeZone: "Europe/London", ...body }),
    });
  }

  async function startForProject(
    test: TestSetUp,
    body: Record<string, unknown>,
  ) {
    const response = await test.handle(postProjectStart(body));
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    return {
      cookie: (response.headers.get("Set-Cookie") ?? "").split(";")[0],
      state: new URL(url).searchParams.get("state") ?? "",
    };
  }

  function readReturn(response: Response) {
    expect(response.status).toBe(302);
    const { pathname, searchParams } = new URL(
      response.headers.get("Location") ?? "",
    );
    expect(pathname).toBe("/dashboard");
    return Object.fromEntries(searchParams);
  }

  it("names the account the page works for, and a valid project", async () => {
    const test = setUp();
    const project = { projectId: "p-1", openForm: true };

    expect((await test.handle(postProjectStart(project, null))).status).toBe(
      400,
    );
    const other = await test.handle(postProjectStart(project, "user-2"));
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: "account_changed" });
    expect(other.headers.get("Set-Cookie")).toBeNull();
    for (const projectId of ["", "a b", "x".repeat(101), 5, "../x"]) {
      expect((await test.handle(postProjectStart({ projectId }))).status).toBe(
        400,
      );
    }
    test.session.userId = undefined;
    expect((await test.handle(postProjectStart(project))).status).toBe(401);
  });

  it("returns to the project with its form, connecting and creating nothing", async () => {
    const test = setUp();
    // A copy's id is not a UUID.
    const projectId = "3f2a-copy-9c1d";
    const { cookie, state } = await startForProject(test, {
      projectId,
      openForm: true,
    });

    const response = await test.handle(
      callback(`state=${state}&code=google-code`, cookie),
    );

    expect(readReturn(response)).toEqual({
      project: projectId,
      appointment: "new",
      calendar: "connected",
    });
    expect(test.calendar.calendars.size).toBe(0);
    const cookies = response.headers.getSetCookie();
    const token = cookies.find((value) =>
      value.startsWith("abodeo_calendar_token="),
    );
    expect(token).toContain("HttpOnly");
    expect(token).toContain("Path=/api/calendar");
    expect(token).not.toContain(testAccessToken);
    expect(cookies.some((value) => value.includes("Max-Age=0"))).toBe(true);
  });

  it("returns to the project without the form when it was not asked for", async () => {
    const test = setUp();
    const { cookie, state } = await startForProject(test, {
      projectId: "p-1",
      openForm: false,
    });

    const response = await test.handle(
      callback(`state=${state}&code=google-code`, cookie),
    );

    expect(readReturn(response)).toEqual({
      project: "p-1",
      calendar: "connected",
    });
  });

  it("returns to the project after a refusal, a wrong account or a failure, with no token", async () => {
    const refused = setUp();
    const first = await startForProject(refused, {
      projectId: "p-1",
      openForm: true,
    });
    const denied = await refused.handle(
      callback(`state=${first.state}&error=access_denied`, first.cookie),
    );
    expect(readReturn(denied)).toEqual({ project: "p-1", calendar: "denied" });
    expect(
      denied.headers
        .getSetCookie()
        .some((value) => value.startsWith("abodeo_calendar_token=")),
    ).toBe(false);

    const wrong = setUp();
    wrong.google.answer.subject = "google-sub-other";
    const second = await startForProject(wrong, { projectId: "p-1" });
    expect(
      readReturn(
        await wrong.handle(
          callback(`state=${second.state}&code=c`, second.cookie),
        ),
      ),
    ).toEqual({ project: "p-1", calendar: "wrong-account" });

    const failed = setUp();
    const third = await startForProject(failed, { projectId: "p-1" });
    expect(
      readReturn(
        await failed.handle(
          callback(`state=${third.state}&code=`, third.cookie),
        ),
      ),
    ).toEqual({ project: "p-1", calendar: "failed" });
  });

  it("keeps the token for the account's calendar test too, without logging it", async () => {
    const test = setUp();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie, state } = await start(test);

    const response = await test.handle(
      callback(`state=${state}&code=google-code`, cookie),
    );

    expect(readResult(response)).toBe("created");
    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("abodeo_calendar_token=")),
    ).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(testAccessToken);
    log.mockRestore();
  });

  it("follows Google's expiry for the token's lifetime", async () => {
    const test = setUp();
    test.google.answer.tokens.accessTokenExpiresAt = startTime + 600_000;
    const { cookie, state } = await startForProject(test, {
      projectId: "p-1",
    });

    const response = await test.handle(
      callback(`state=${state}&code=google-code`, cookie),
    );

    const token = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("abodeo_calendar_token="));
    expect(token).toContain("Max-Age=600");
  });
});
