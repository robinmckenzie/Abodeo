import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosaver, type AutosaveStatus } from "./autosave";
import type { SaveResult } from "./project-storage";
import type { ProjectFields } from "./projects";

let saved: Partial<ProjectFields>[];
let statuses: AutosaveStatus["state"][];
let nextResult: SaveResult;

function createTestSaver() {
  return createAutosaver({
    save: async (changes) => {
      saved.push(changes);
      return nextResult;
    },
    onStatus: (status) => statuses.push(status.state),
    delay: 500,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  saved = [];
  statuses = [];
  nextResult = { ok: true };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autosave", () => {
  it("saves after a pause in typing, sending only the fields changed", async () => {
    const saver = createTestSaver();
    saver.change({ title: "K" });
    saver.change({ title: "Ki" });
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([{ title: "Ki" }]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("saves at once when asked, without waiting for the pause", () => {
    const saver = createTestSaver();
    saver.change({ notes: "Straight away" });
    saver.saveNow();
    expect(saved).toEqual([{ notes: "Straight away" }]);
  });

  it("does not save a title that is empty or only spaces", () => {
    const saver = createTestSaver();
    saver.change({ title: "  ", notes: "Kept" });
    saver.saveNow();
    expect(saved).toEqual([{ notes: "Kept" }]);
  });

  it("keeps the last valid title typed before the title was cleared", () => {
    const saver = createTestSaver();
    saver.change({ title: "Garden" });
    saver.change({ title: "" });
    saver.saveNow();
    expect(saved).toEqual([{ title: "Garden" }]);
  });

  it("reports a failed save, and tries the change again with the next one", async () => {
    const saver = createTestSaver();
    nextResult = { ok: false, reason: "full" };
    saver.change({ notes: "First" });
    saver.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("failed");

    nextResult = { ok: true };
    saver.change({ title: "Second" });
    saver.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.at(-1)).toEqual({ notes: "First", title: "Second" });
    expect(statuses.at(-1)).toBe("saved");
  });

  it("does not let a failed older save replace newer typing", async () => {
    const saver = createTestSaver();
    nextResult = { ok: false, reason: "unavailable" };
    saver.change({ notes: "Old" });
    saver.saveNow();
    // Typed while the save was under way.
    saver.change({ notes: "New" });
    await vi.advanceTimersByTimeAsync(0);

    nextResult = { ok: true };
    saver.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.at(-1)).toEqual({ notes: "New" });
  });

  it("does not report saved while newer changes are still unsaved", async () => {
    const saver = createTestSaver();
    saver.change({ notes: "One" });
    saver.saveNow();
    saver.change({ notes: "Two" });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("pending");
  });
});
