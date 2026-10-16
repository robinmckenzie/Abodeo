import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  describeDueDate,
  findToday,
  findWeekday,
  isCalendarDate,
  listMonthWeeks,
} from "./due-date";

describe("due dates", () => {
  it("accepts only real calendar dates, as YYYY-MM-DD", () => {
    expect(isCalendarDate("2026-10-16")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("0050-01-01")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-10-00")).toBe(false);
    expect(isCalendarDate("2026-1-16")).toBe(false);
    expect(isCalendarDate(20261016)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });

  it("finds the weekday and describes the date in full", () => {
    expect(findWeekday("2026-10-16")).toBe("Friday");
    expect(findWeekday("2026-10-18")).toBe("Sunday");
    expect(findWeekday("2026-10-19")).toBe("Monday");
    expect(describeDueDate("2026-10-16")).toBe("Friday 16 October 2026");
  });

  it("shows the same day in every time zone", () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
        process.env.TZ = zone;
        expect(describeDueDate("2026-10-16")).toBe("Friday 16 October 2026");
        expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
        expect(listMonthWeeks(2026, 9)[0][3]).toBe("2026-10-01");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("moves by days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-16", 7)).toBe("2026-10-23");
  });

  it("moves by months, keeping the day where the month has it", () => {
    expect(addMonths("2026-10-16", 1)).toBe("2026-11-16");
    expect(addMonths("2026-12-16", 1)).toBe("2027-01-16");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-03-31", -1)).toBe("2028-02-29");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("lays a month out in weeks from Monday", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = listMonthWeeks(2026, 9);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks[4]).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      null,
    ]);
    // February 2027 starts on a Monday and has exactly four weeks.
    expect(listMonthWeeks(2027, 1)).toHaveLength(4);
    expect(listMonthWeeks(2028, 1).flat().filter(Boolean)).toHaveLength(29);
  });

  it("takes today from the browser's own clock", () => {
    expect(findToday(new Date(2026, 9, 16, 23, 59))).toBe("2026-10-16");
    expect(findToday(new Date(2026, 9, 17, 0, 1))).toBe("2026-10-17");
  });
});
