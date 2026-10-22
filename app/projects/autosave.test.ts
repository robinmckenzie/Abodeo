import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAutosaver,
  type AutosaveStatus,
  type ProjectSaveResult,
} from "./autosave";
import type { ProjectFields } from "./projects";

let saved: Partial<ProjectFields>[];
let statuses: AutosaveStatus["state"][];
let nextResult: ProjectSaveResult;

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

  it("tells whether everything is saved once a save asked for is done", async () => {
    const saver = createTestSaver();
    expect(await saver.saveNow()).toBe(true);
    saver.change({ notes: "Lost" });
    nextResult = { ok: false, reason: "full" };
    expect(await saver.saveNow()).toBe(false);
    // Nothing new to send, but the failed change is still unsaved.
    expect(await saver.saveNow()).toBe(false);
    nextResult = { ok: true };
    saver.change({ notes: "Kept" });
    expect(await saver.saveNow()).toBe(true);
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

describe("a failed save followed by a newer one", () => {
  it("does not put back a value that a later change has replaced", async () => {
    let finishFirst: (result: ProjectSaveResult) => void = () => {};
    const sent: Partial<ProjectFields>[] = [];
    let calls = 0;
    const saver = createAutosaver({
      save: (changes) => {
        sent.push(changes);
        calls++;
        if (calls === 1) {
          return new Promise((resolve) => (finishFirst = resolve));
        }
        return Promise.resolve({ ok: true });
      },
      onStatus: () => {},
    });
    saver.change({ title: "Older" });
    const first = saver.saveNow();
    saver.change({ title: "Newer" });
    const second = saver.saveNow();
    await second;
    finishFirst({ ok: false, reason: "unreachable" });
    await first;

    saver.change({ notes: "Then notes" });
    await saver.saveNow();

    expect(sent).toEqual([
      { title: "Older" },
      { title: "Newer" },
      { notes: "Then notes" },
    ]);
  });
});

describe("discarding unsaved changes", () => {
  it("drops only the fields given and clears the failure", async () => {
    const saver = createTestSaver();
    nextResult = { ok: false, reason: "conflict" };
    saver.change({ title: "Mine", notes: "Also mine" });
    await saver.saveNow();
    expect(statuses.at(-1)).toBe("failed");

    saver.discard(["title"]);
    expect(statuses.at(-1)).toBe("pending");
    nextResult = { ok: true };
    expect(await saver.saveNow()).toBe(true);

    expect(saved.at(-1)).toEqual({ notes: "Also mine" });
  });
});
