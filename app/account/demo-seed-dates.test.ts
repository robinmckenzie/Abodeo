// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  dateFromRule,
  moveEvent,
  ruleForDate,
  ruleForEvent,
  SeedPastDateError,
} from "./demo-seed-dates";
import type { CalendarEvent } from "../calendar/google-calendar.server";

// Tuesday 17 November 2026, 14:00 UTC.
const tuesday = Date.parse("2026-11-17T14:00:00Z");
// Sunday 22 November 2026, 15:00 UTC.
const sundayAfternoon = Date.parse("2026-11-22T15:00:00Z");
const sunday = 0;
const saturday = 6;

const brunch: CalendarEvent = {
  summary: "Brunch",
  description: "",
  start: { dateTime: "2026-11-22T10:00:00Z" },
  end: { dateTime: "2026-11-22T12:30:00Z" },
};

describe("ruleForDate and dateFromRule (due dates)", () => {
  it("counts the weekdays from today", () => {
    expect(ruleForDate("2026-11-22", tuesday)).toEqual({
      weekday: sunday,
      nth: 1,
    });
    expect(ruleForDate("2026-12-05", tuesday)).toEqual({
      weekday: saturday,
      nth: 3,
    });
  });

  it("counts today as the first", () => {
    expect(ruleForDate("2026-11-17", tuesday)).toEqual({ weekday: 2, nth: 1 });
  });

  it("refuses a day that has gone", () => {
    expect(() => ruleForDate("2026-11-16", tuesday)).toThrow(SeedPastDateError);
  });

  it("works the date out again from another day", () => {
    const rule = ruleForDate("2026-11-22", tuesday);
    expect(dateFromRule(rule, Date.parse("2026-12-03T09:00:00Z"))).toBe(
      "2026-12-06",
    );
    expect(dateFromRule(rule, sundayAfternoon)).toBe("2026-11-22");
  });
});

describe("ruleForEvent and moveEvent (appointments)", () => {
  it("refuses a start that has passed, such as 10:00 on a Sunday afternoon", () => {
    expect(() => ruleForEvent(brunch, sundayAfternoon)).toThrow(
      SeedPastDateError,
    );
  });

  it("is the first Sunday ahead when saved before the start", () => {
    expect(ruleForEvent(brunch, tuesday)).toEqual({ weekday: sunday, nth: 1 });
    expect(ruleForEvent(brunch, Date.parse("2026-11-22T08:00:00Z"))).toEqual({
      weekday: sunday,
      nth: 1,
    });
  });

  it("is the next Sunday when worked out after the start has passed", () => {
    const moved = moveEvent(
      brunch,
      { weekday: sunday, nth: 1 },
      sundayAfternoon,
    );
    expect(moved.start).toEqual({ dateTime: "2026-11-29T10:00:00Z" });
    expect(moved.end).toEqual({ dateTime: "2026-11-29T12:30:00Z" });
  });

  it("keeps the time and length, and the rest of the event", () => {
    const event = { ...brunch, description: "Bring fruit" };
    const moved = moveEvent(event, { weekday: sunday, nth: 2 }, tuesday);
    expect(moved.start).toEqual({ dateTime: "2026-11-29T10:00:00Z" });
    expect(moved.summary).toBe("Brunch");
    expect(moved.description).toBe("Bring fruit");
  });

  it("moves an end on a later day by the same number of days", () => {
    const event: CalendarEvent = {
      ...brunch,
      end: { dateTime: "2026-11-23T01:00:00Z" },
    };
    const same = moveEvent(event, { weekday: sunday, nth: 1 }, tuesday);
    expect(same.end).toEqual({ dateTime: "2026-11-23T01:00:00Z" });
    const later = moveEvent(event, { weekday: sunday, nth: 2 }, tuesday);
    expect(later.end).toEqual({ dateTime: "2026-11-30T01:00:00Z" });
  });

  it("sends wall time and zone, without the offset, when it has a zone", () => {
    const event: CalendarEvent = {
      ...brunch,
      start: {
        dateTime: "2026-11-22T10:00:00+00:00",
        timeZone: "Europe/London",
      },
      end: { dateTime: "2026-11-22T12:30:00+00:00", timeZone: "Europe/London" },
    };
    const moved = moveEvent(event, { weekday: sunday, nth: 2 }, tuesday);
    expect(moved.start).toEqual({
      dateTime: "2026-11-29T10:00:00",
      timeZone: "Europe/London",
    });
  });

  it("keeps the offset when there is no zone name", () => {
    const event: CalendarEvent = {
      ...brunch,
      start: { dateTime: "2026-11-22T10:00:00+02:00" },
      end: { dateTime: "2026-11-22T11:00:00+02:00" },
    };
    expect(
      moveEvent(event, { weekday: sunday, nth: 2 }, tuesday).start,
    ).toEqual({ dateTime: "2026-11-29T10:00:00+02:00" });
  });

  it("moves an all-day event, which counts until the end of its day", () => {
    const event: CalendarEvent = {
      ...brunch,
      start: { date: "2026-11-22" },
      end: { date: "2026-11-23" },
    };
    expect(ruleForEvent(event, sundayAfternoon)).toEqual({
      weekday: sunday,
      nth: 1,
    });
    const moved = moveEvent(
      event,
      { weekday: sunday, nth: 1 },
      sundayAfternoon,
    );
    expect(moved.start).toEqual({ date: "2026-11-22" });
    expect(moved.end).toEqual({ date: "2026-11-23" });
  });
});
