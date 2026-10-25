import { describe, expect, it } from "vitest";

import {
  addOneDay,
  addOneHour,
  buildProjectReturnSearch,
  isDate,
  isWallTime,
  maxNotesLength,
  maxTitleLength,
  validateAppointmentFields,
  type AppointmentFields,
} from "./appointments-api";

const timed: AppointmentFields = {
  title: " Site visit ",
  notes: "Bring keys",
  allDay: false,
  start: "2026-11-02T10:00",
  end: "2026-11-02T11:30",
};

describe("dates and times", () => {
  it("accepts only real dates and wall times", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-2-3")).toBe(false);
    expect(isWallTime("2026-11-02T23:59")).toBe(true);
    expect(isWallTime("2026-11-02T24:00")).toBe(false);
    expect(isWallTime("2026-11-02T10:60")).toBe(false);
    expect(isWallTime("2026-11-02")).toBe(false);
  });

  it("adds a day across month and year ends", () => {
    expect(addOneDay("2026-11-02")).toBe("2026-11-03");
    expect(addOneDay("2026-12-31")).toBe("2027-01-01");
    expect(addOneDay("2028-02-28")).toBe("2028-02-29");
  });

  it("adds an hour across midnight, and gives nothing for a bad time", () => {
    expect(addOneHour("2026-11-02T10:15")).toBe("2026-11-02T11:15");
    expect(addOneHour("2026-12-31T23:30")).toBe("2027-01-01T00:30");
    expect(addOneHour("")).toBe("");
  });
});

describe("validateAppointmentFields", () => {
  it("trims the title and keeps a timed appointment's times", () => {
    expect(validateAppointmentFields(timed)).toEqual({
      ok: true,
      value: { ...timed, title: "Site visit" },
    });
  });

  it("makes an all-day appointment end on the day after", () => {
    const result = validateAppointmentFields({
      ...timed,
      allDay: true,
      start: "2026-12-31",
      end: "ignored",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { allDay: true, start: "2026-12-31", end: "2027-01-01" },
    });
  });

  it("refuses a missing or over-long title and over-long notes", () => {
    expect(validateAppointmentFields({ ...timed, title: "  " })).toEqual({
      ok: false,
      problem: "title-missing",
    });
    expect(
      validateAppointmentFields({
        ...timed,
        title: "a".repeat(maxTitleLength + 1),
      }),
    ).toEqual({ ok: false, problem: "title-too-long" });
    expect(
      validateAppointmentFields({
        ...timed,
        notes: "a".repeat(maxNotesLength + 1),
      }),
    ).toEqual({ ok: false, problem: "notes-too-long" });
  });

  it("refuses bad times, and an end that is not after the start", () => {
    expect(validateAppointmentFields({ ...timed, start: "tomorrow" })).toEqual({
      ok: false,
      problem: "start-invalid",
    });
    expect(validateAppointmentFields({ ...timed, end: "" })).toEqual({
      ok: false,
      problem: "end-invalid",
    });
    expect(validateAppointmentFields({ ...timed, end: timed.start })).toEqual({
      ok: false,
      problem: "end-before-start",
    });
    expect(
      validateAppointmentFields({ ...timed, allDay: true, start: "bad" }),
    ).toEqual({ ok: false, problem: "start-invalid" });
  });
});

describe("buildProjectReturnSearch", () => {
  it("names the project, and the form only when asked", () => {
    expect(
      buildProjectReturnSearch({ projectId: "a-b", openForm: true }).toString(),
    ).toBe("project=a-b&appointment=new");
    expect(
      buildProjectReturnSearch({
        projectId: "a-b",
        openForm: false,
      }).toString(),
    ).toBe("project=a-b");
  });
});
