import { describe, expect, it } from "vitest";

import {
  describeLosses,
  isNewProjectChanged,
  joinList,
  pickFormValues,
  reconcileCreatedProject,
  toggleId,
} from "./project-editing";
import { newProjectFields, type ProjectFields } from "./projects";

const fields = (overrides: Partial<ProjectFields> = {}): ProjectFields => ({
  ...newProjectFields,
  title: "Garden",
  ...overrides,
});

describe("reconcileCreatedProject", () => {
  it("asks for nothing when the project was added as sent", () => {
    const sent = fields();
    expect(reconcileCreatedProject(sent, [sent], sent)).toEqual({
      changes: {},
      isLost: false,
    });
  });

  it("sends again a field still as an earlier Create left it", () => {
    const first = fields({ notes: "Soil" });
    const second = fields({ notes: "Soil and seed" });
    expect(reconcileCreatedProject(second, [first, second], first)).toEqual({
      changes: { notes: "Soil and seed" },
      isLost: false,
    });
  });

  it("leaves a field changed elsewhere, losing nothing if it was not changed here", () => {
    const sent = fields({ notes: "Soil" });
    const added = fields({ notes: "Changed elsewhere" });
    expect(reconcileCreatedProject(sent, [sent], added)).toEqual({
      changes: {},
      isLost: false,
    });
  });

  it("reports a loss when a field changed elsewhere was also changed here", () => {
    const first = fields({ notes: "Soil" });
    const second = fields({ notes: "Soil and seed" });
    const added = fields({ notes: "Changed elsewhere" });
    expect(reconcileCreatedProject(second, [first, second], added)).toEqual({
      changes: {},
      isLost: true,
    });
  });
});

describe("isNewProjectChanged", () => {
  it("is false for the blank form and true once anything is entered", () => {
    expect(isNewProjectChanged(newProjectFields)).toBe(false);
    expect(isNewProjectChanged(fields({ notes: "x" }))).toBe(true);
    expect(isNewProjectChanged(fields({ dueDate: "2026-12-01" }))).toBe(true);
  });
});

describe("describeLosses", () => {
  it("joins what would be lost into the question", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
    expect(describeLosses(["a", "b"])).toBe(
      "Leaving now will lose a and b.\n\nOK continues without them. Cancel stays here.",
    );
  });
});

describe("pickFormValues and toggleId", () => {
  it("keeps only the form's fields", () => {
    const project = { ...fields(), id: "x", createdAt: "", updatedAt: "" };
    expect(Object.keys(pickFormValues(project)).sort()).toEqual(
      ["assignee", "dueDate", "notes", "tasks", "title"].sort(),
    );
  });

  it("changes the set only when membership changes", () => {
    const empty: ReadonlySet<string> = new Set();
    expect(toggleId(empty, "a", false)).toBe(empty);
    const withA = toggleId(empty, "a", true);
    expect(withA.has("a")).toBe(true);
    expect(toggleId(withA, "a", true)).toBe(withA);
    expect(toggleId(withA, "a", false).has("a")).toBe(false);
  });
});
