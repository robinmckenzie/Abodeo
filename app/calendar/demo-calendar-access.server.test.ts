// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createCalendarTokenCookie,
  readCalendarToken,
  unknownTokenLifetime,
} from "./calendar-token.server";
import {
  createDemoCalendarAccessStore,
  readCalendarAccess,
  saveDemoCalendarAccess,
} from "./demo-calendar-access.server";
import {
  createFakeCalendarGoogle,
  createMemoryDemoAccessStore,
  testAccessToken,
  testRefreshedToken,
  testRefreshToken,
  testSecret,
} from "./test-calendar.server";

const now = 1_000_000;
const minute = 60_000;

describe("createDemoCalendarAccessStore", () => {
  function fakeDatabase(rows: Record<string, unknown>[] = []) {
    return {
      query: vi.fn<
        (
          text: string,
          values: unknown[],
        ) => Promise<{ rows: Record<string, unknown>[] }>
      >(async () => ({ rows })),
    };
  }

  it("reads the token stored for the account only", async () => {
    const database = fakeDatabase([{ refresh_token: "encrypted" }]);
    const store = createDemoCalendarAccessStore(database);

    expect(await store.readRefreshToken("demo-user")).toBe("encrypted");
    expect(database.query.mock.calls[0][0]).toContain("where user_id = $1");
    expect(database.query.mock.calls[0][1]).toEqual(["demo-user"]);
    expect(
      await createDemoCalendarAccessStore(fakeDatabase()).readRefreshToken(
        "user-1",
      ),
    ).toBeUndefined();
  });

  it("keeps one row, replacing what was stored before", async () => {
    const database = fakeDatabase();
    await createDemoCalendarAccessStore(database).save("demo-user", "new");

    expect(database.query.mock.calls[0][0]).toContain(
      "on conflict (id) do update",
    );
    expect(database.query.mock.calls[0][1]).toEqual(["demo-user", "new"]);
  });

  it("says when access was stored, or that none is", async () => {
    const stored = createDemoCalendarAccessStore(
      fakeDatabase([{ saved_at: "2026-11-13T10:00:00.000Z" }]),
    );
    expect((await stored.readSavedAt())?.toISOString()).toBe(
      "2026-11-13T10:00:00.000Z",
    );
    expect(
      await createDemoCalendarAccessStore(fakeDatabase()).readSavedAt(),
    ).toBeNull();
  });
});

function setUp() {
  const { google, refreshes, refresh } = createFakeCalendarGoogle();
  const access = createMemoryDemoAccessStore();
  const failures: [string, string | undefined][] = [];
  const read = (cookieHeader: string | null, userId = "demo-user") =>
    readCalendarAccess({
      cookieHeader,
      userId,
      secret: testSecret,
      isSecure: false,
      google,
      store: access.store,
      now,
      reportFailure: (stage, code) => failures.push([stage, code]),
    });
  const storeAccess = () =>
    saveDemoCalendarAccess(
      access.store,
      testSecret,
      "demo-user",
      testRefreshToken,
    );
  return { access, refreshes, refresh, failures, read, storeAccess };
}

async function cookieFor(userId: string, expiresIn: number, isStored = false) {
  const setCookie = await createCalendarTokenCookie({
    secret: testSecret,
    isSecure: false,
    accessToken: testAccessToken,
    userId,
    expiresAt: now + expiresIn,
    now,
    isStored,
  });
  return setCookie.split(";")[0];
}

describe("saveDemoCalendarAccess", () => {
  it("stores the refresh token encrypted, never as it is", async () => {
    const test = setUp();
    await test.storeAccess();

    expect(test.access.saved.userId).toBe("demo-user");
    expect(test.access.saved.token).toBeTruthy();
    expect(test.access.saved.token).not.toContain(testRefreshToken);
  });
});

describe("readCalendarAccess", () => {
  it("uses a good cookie without looking for stored access", async () => {
    const test = setUp();
    await test.storeAccess();
    test.access.hooks.fail = new Error("not read");

    const access = await test.read(await cookieFor("demo-user", 50 * minute));

    expect(access.token?.accessToken).toBe(testAccessToken);
    expect(access.hasStoredAccess).toBe(false);
    expect(access.cookie).toBeUndefined();
    expect(test.refreshes).toEqual([]);
    expect(test.failures).toEqual([]);
  });

  it("knows a cookie that came from stored access", async () => {
    const test = setUp();
    const access = await test.read(
      await cookieFor("demo-user", 50 * minute, true),
    );
    expect(access.hasStoredAccess).toBe(true);
  });

  it("leaves an account with nothing stored as it was", async () => {
    const test = setUp();
    await test.storeAccess();

    const none = await test.read(null, "user-1");
    const ending = await test.read(
      await cookieFor("user-1", 2 * minute),
      "user-1",
    );

    expect(none).toEqual({ token: undefined, hasStoredAccess: false });
    expect(ending.token?.isNearExpiry).toBe(true);
    expect(ending.hasStoredAccess).toBe(false);
    expect(test.refreshes).toEqual([]);
  });

  it("gets a token from Google with the stored refresh token, and keeps it in a marked cookie", async () => {
    const test = setUp();
    await test.storeAccess();

    for (const cookie of [null, await cookieFor("demo-user", 2 * minute)]) {
      const access = await test.read(cookie);

      expect(access.token).toEqual({
        accessToken: testRefreshedToken,
        expiresAt: now + unknownTokenLifetime,
        isNearExpiry: false,
        isStored: true,
      });
      expect(access.hasStoredAccess).toBe(true);
      expect(access.cookie).toContain("Path=/api/calendar");
      expect(access.cookie).not.toContain(testRefreshedToken);
      const kept = await readCalendarToken(
        access.cookie?.split(";")[0] ?? null,
        testSecret,
        "demo-user",
        now,
      );
      expect(kept?.accessToken).toBe(testRefreshedToken);
      expect(kept?.isStored).toBe(true);
    }
    // Google was given the token as Robin's grant gave it.
    expect(test.refreshes).toEqual([testRefreshToken, testRefreshToken]);
  });

  it("reports a refusal by Google, still saying the access is stored", async () => {
    const test = setUp();
    await test.storeAccess();
    test.refresh.fail = true;

    const access = await test.read(null);

    expect(access).toEqual({ token: undefined, hasStoredAccess: true });
    expect(test.failures).toEqual([["stored_access_refresh", undefined]]);
  });

  it("treats a table that cannot be read as nothing stored", async () => {
    const test = setUp();
    test.access.hooks.fail = Object.assign(new Error("relation missing"), {
      code: "42P01",
    });

    const access = await test.read(null, "user-1");

    expect(access).toEqual({ token: undefined, hasStoredAccess: false });
    expect(test.failures).toEqual([["stored_access_read", "42P01"]]);
  });
});
