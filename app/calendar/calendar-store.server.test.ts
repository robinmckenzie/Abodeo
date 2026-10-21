// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createCalendarStore } from "./calendar-store.server";

describe("createCalendarStore", () => {
  function fakeDatabase(
    rowCount: number,
    rows: Record<string, unknown>[] = [],
  ) {
    return {
      query: vi.fn<
        (
          text: string,
          values: unknown[],
        ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
      >(async () => ({ rows, rowCount })),
    };
  }

  it("reads the calendar and the Google account of the account only", async () => {
    const database = fakeDatabase(1, [
      { calendar_id: "calendar-1", account_id: "google-sub-1" },
    ]);
    const store = createCalendarStore(database);

    expect(await store.readCalendarId("user-1")).toBe("calendar-1");
    expect(await store.readGoogleAccountId("user-1")).toBe("google-sub-1");
    expect(database.query.mock.calls[0][1]).toEqual(["user-1"]);
    expect(database.query.mock.calls[1][0]).toContain("provider_id = 'google'");
  });

  it("says whether a calendar was saved", async () => {
    const saved = createCalendarStore(fakeDatabase(1));
    const lost = createCalendarStore(fakeDatabase(0));

    expect(await saved.saveFirstCalendarId("user-1", "calendar-1")).toBe(true);
    expect(await lost.saveFirstCalendarId("user-1", "calendar-1")).toBe(false);
    expect(await saved.replaceCalendarId("user-1", "old", "new")).toBe(true);
    expect(await lost.replaceCalendarId("user-1", "old", "new")).toBe(false);
  });

  it("saves a first calendar without overwriting one, and replaces only the deleted one", async () => {
    const database = fakeDatabase(1);
    const store = createCalendarStore(database);

    await store.saveFirstCalendarId("user-1", "calendar-1");
    await store.replaceCalendarId("user-1", "calendar-1", "calendar-2");

    expect(database.query.mock.calls[0][0]).toContain(
      "on conflict (user_id) do nothing",
    );
    expect(database.query.mock.calls[1][0]).toContain(
      "where user_id = $1 and calendar_id = $2",
    );
    expect(database.query.mock.calls[1][1]).toEqual([
      "user-1",
      "calendar-1",
      "calendar-2",
    ]);
  });
});
