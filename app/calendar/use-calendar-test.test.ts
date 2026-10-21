import { describe, expect, it } from "vitest";

import { buildGoogleCalendarAddress } from "./use-calendar-test";

describe("buildGoogleCalendarAddress", () => {
  it("names the account to open", () => {
    expect(buildGoogleCalendarAddress("ada+home@example.com")).toBe(
      "https://calendar.google.com/calendar/r?authuser=ada%2Bhome%40example.com",
    );
  });
});
