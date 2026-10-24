import { describe, expect, it } from "vitest";

import {
  applyProjectChanges,
  findConflictingFields,
  readProjectFields,
  readProjectSave,
} from "./project-changes";
import type { Project } from "./projects";

const saved: Project = {
  id: "p1",
  title: "Paint the shed",
  notes: "Green",
  assignee: "andy",
  dueDate: "2026-11-01",
  tasks: [{ id: "t1", title: "Buy paint", isDone: false }],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("findConflictingFields", () => {
  it("finds none when each changed field is as the change expected", () => {
    expect(
      findConflictingFields(
        saved,
        { title: "Paint the shed" },
        { title: "Paint the fence" },
      ),
    ).toEqual([]);
  });

  it("finds a changed field whose saved value has changed since", () => {
    expect(
      findConflictingFields(
        saved,
        { title: "Paint it", notes: "Green" },
        { title: "Paint the fence", notes: "Blue" },
      ),
    ).toEqual(["title"]);
  });

  it("ignores fields changed elsewhere that this change leaves alone", () => {
    expect(
      findConflictingFields(saved, { notes: "Green" }, { notes: "Blue" }),
    ).toEqual([]);
  });

  it("compares tasks by their ids, titles, completion and order", () => {
    const base = [{ id: "t1", title: "Buy paint", isDone: true }];
    expect(
      findConflictingFields(saved, { tasks: base }, { tasks: [] }),
    ).toEqual(["tasks"]);
    expect(
      findConflictingFields(saved, { tasks: saved.tasks }, { tasks: [] }),
    ).toEqual([]);
  });

  it("tells a due date removed from one that is unchanged", () => {
    expect(
      findConflictingFields(saved, { dueDate: null }, { dueDate: null }),
    ).toEqual(["dueDate"]);
  });
});

describe("applyProjectChanges", () => {
  it("changes only the fields given and the time of the change", () => {
    const next = applyProjectChanges(
      saved,
      { notes: "Blue", dueDate: null },
      "2026-10-03T00:00:00.000Z",
    );
    expect(next).toEqual({
      ...saved,
      notes: "Blue",
      dueDate: null,
      updatedAt: "2026-10-03T00:00:00.000Z",
    });
  });
});

describe("reading a save from a request", () => {
  it("keeps only the project's fields", () => {
    expect(
      readProjectFields({ title: "A", userId: "someone-else", id: "x" }),
    ).toEqual({ title: "A" });
  });

  it("refuses an invalid value", () => {
    expect(readProjectFields({ title: " " })).toBeUndefined();
    expect(readProjectFields({ assignee: "not an id!" })).toBeUndefined();
    expect(readProjectFields({ dueDate: "tomorrow" })).toBeUndefined();
    expect(readProjectFields({ tasks: [{ id: "t" }] })).toBeUndefined();
  });

  it("needs a base for each changed field", () => {
    expect(
      readProjectSave({ base: {}, changes: { title: "A" } }),
    ).toBeUndefined();
    expect(
      readProjectSave({ base: { title: "B" }, changes: { title: "A" } }),
    ).toEqual({ base: { title: "B" }, changes: { title: "A" } });
  });

  it("needs a change", () => {
    expect(readProjectSave({ base: {}, changes: {} })).toBeUndefined();
    expect(readProjectSave(null)).toBeUndefined();
  });
});
