import { describe, expect, it } from "vitest";

import { activityReportInterval, isActivityReportDue } from "./activity-report";

describe("isActivityReportDue", () => {
  it("reports the first activity", () => {
    expect(isActivityReportDue(null, 5_000)).toBe(true);
  });

  it("waits a whole interval after the last report", () => {
    expect(isActivityReportDue(5_000, 5_000 + activityReportInterval - 1)).toBe(
      false,
    );
    expect(isActivityReportDue(5_000, 5_000 + activityReportInterval)).toBe(
      true,
    );
  });

  it("reports again if the clock has gone back", () => {
    expect(isActivityReportDue(5_000, 4_000)).toBe(true);
  });
});
