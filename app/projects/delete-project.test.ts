import { describe, expect, it } from "vitest";

import {
  describeBinPeriod,
  describeBinTimeLeft,
  isPastBinPeriod,
  listLosses,
} from "./delete-project";
import { binPeriodMs } from "./projects-api";

const deletedAt = "2026-10-22T00:00:00.000Z";
const at = (offsetMs: number) => Date.parse(deletedAt) + offsetMs;

describe("listing what is lost", () => {
  it("gives the counts where the project has any", () => {
    const tasks = [1, 2, 3].map((n) => ({
      id: String(n),
      title: "T",
      isDone: false,
    }));
    expect(listLosses({ tasks }, 2)).toEqual([
      "3 tasks",
      "2 images",
      "its assignee and due date",
    ]);
    expect(listLosses({ tasks: tasks.slice(0, 1) }, 1)[0]).toBe("1 task");
    expect(listLosses({ tasks: [] }, 0)).toEqual([
      "its tasks",
      "its images",
      "its assignee and due date",
    ]);
  });
});

describe("the cooling-off period", () => {
  it("is described in days", () => {
    expect(describeBinPeriod()).toBe("2 days");
  });

  it("gives the time left in days, then hours", () => {
    expect(describeBinTimeLeft(deletedAt, at(0))).toBe("2 days left");
    expect(describeBinTimeLeft(deletedAt, at(60_000))).toBe("1 day left");
    expect(
      describeBinTimeLeft(deletedAt, at(binPeriodMs - 5 * 3_600_000)),
    ).toBe("5 hours left");
    expect(describeBinTimeLeft(deletedAt, at(binPeriodMs - 60_000))).toBe(
      "Less than an hour left",
    );
  });

  it("says when the period has passed", () => {
    expect(isPastBinPeriod(deletedAt, at(binPeriodMs - 1))).toBe(false);
    expect(isPastBinPeriod(deletedAt, at(binPeriodMs))).toBe(true);
    expect(describeBinTimeLeft(deletedAt, at(binPeriodMs))).toMatch(
      /^Past the cooling-off period/,
    );
  });
});
