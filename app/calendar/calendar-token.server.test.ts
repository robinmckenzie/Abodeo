// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  calendarTokenLifetime,
  calendarTokenNearExpiry,
  clearCalendarTokenCookie,
  createCalendarTokenCookie,
  readCalendarToken,
} from "./calendar-token.server";
import { testAccessToken, testSecret } from "./test-calendar.server";

const now = 1_000_000;
const minute = 60_000;

// The Cookie header a browser would send back for a Set-Cookie value.
function toCookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

async function makeCookie(expiresAt = now + 59 * minute, userId = "user-1") {
  return createCalendarTokenCookie({
    secret: testSecret,
    isSecure: false,
    accessToken: testAccessToken,
    userId,
    expiresAt,
    now,
  });
}

describe("the Calendar token cookie", () => {
  it("is encrypted, HttpOnly, scoped to the Calendar endpoints and capped at 55 minutes", async () => {
    const cookie = await makeCookie();

    expect(cookie).not.toContain(testAccessToken);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/calendar");
    expect(cookie).toContain(`Max-Age=${calendarTokenLifetime / 1000}`);
    expect(cookie).not.toContain("Secure");
  });

  it("is marked Secure over https, and follows an earlier Google expiry", async () => {
    const cookie = await createCalendarTokenCookie({
      secret: testSecret,
      isSecure: true,
      accessToken: testAccessToken,
      userId: "user-1",
      expiresAt: now + 10 * minute,
      now,
    });

    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=600");
  });

  it("reads back the token for the same account", async () => {
    const header = toCookieHeader(await makeCookie());

    expect(await readCalendarToken(header, testSecret, "user-1", now)).toEqual({
      accessToken: testAccessToken,
      expiresAt: now + calendarTokenLifetime,
      isNearExpiry: false,
    });
  });

  it("does not give a token made for another account", async () => {
    const header = toCookieHeader(await makeCookie());

    expect(
      await readCalendarToken(header, testSecret, "user-2", now),
    ).toBeUndefined();
  });

  it("does not give a tampered, wrongly keyed, missing or expired token", async () => {
    const cookie = await makeCookie();
    const header = toCookieHeader(cookie);

    expect(
      await readCalendarToken(
        header.slice(0, -4) + "AAAA",
        testSecret,
        "user-1",
        now,
      ),
    ).toBeUndefined();
    expect(
      await readCalendarToken(
        header,
        "another-secret-long-enough-xxxxxxxxxxxx",
        "user-1",
        now,
      ),
    ).toBeUndefined();
    expect(
      await readCalendarToken(null, testSecret, "user-1", now),
    ).toBeUndefined();
    expect(
      await readCalendarToken(
        header,
        testSecret,
        "user-1",
        now + calendarTokenLifetime,
      ),
    ).toBeUndefined();
  });

  it("is near expiry when under five minutes are left", async () => {
    const header = toCookieHeader(await makeCookie());
    const left = (ms: number) =>
      readCalendarToken(
        header,
        testSecret,
        "user-1",
        now + calendarTokenLifetime - ms,
      );

    expect((await left(calendarTokenNearExpiry - 1))?.isNearExpiry).toBe(true);
    expect((await left(calendarTokenNearExpiry))?.isNearExpiry).toBe(false);
  });

  it("is not set at all for a token that has already ended, and can be cleared", async () => {
    expect(await makeCookie(now)).toBe(clearCalendarTokenCookie(false));
    expect(clearCalendarTokenCookie(false)).toContain("Max-Age=0");
  });
});
