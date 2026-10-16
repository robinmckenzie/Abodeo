import { describe, expect, it } from "vitest";

import {
  hasTitle,
  newProjectFields,
  parseProject,
  serialiseProject,
  sortProjects,
  type Project,
} from "./projects";

const project: Project = {
  id: "a",
  title: "Kitchen",
  notes: "Line one\nLine two",
  assignee: "boris",
  dueDate: "2026-10-16",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
};

describe("projects", () => {
  it("needs a title with at least one non-space character", () => {
    expect(hasTitle("")).toBe(false);
    expect(hasTitle("  \n\t")).toBe(false);
    expect(hasTitle(" a ")).toBe(true);
  });

  it("starts a new project empty, unassigned and with no due date", () => {
    expect(newProjectFields).toEqual({
      title: "",
      notes: "",
      assignee: "unassigned",
      dueDate: null,
    });
  });

  it("reads back what it saves, including line breaks in notes", () => {
    expect(parseProject("a", serialiseProject(project))).toEqual(project);
  });

  it("reads back a project with no due date", () => {
    const undated = { ...project, dueDate: null };
    expect(parseProject("a", serialiseProject(undated))).toEqual(undated);
  });

  it("reads a project saved before due dates as having none, keeping the rest", () => {
    const older = { ...saved(), version: 1 };
    delete older.dueDate;
    const json = JSON.stringify(older);
    expect(parseProject("a", json)).toEqual({ ...project, dueDate: null });
  });

  it.each([
    ["damaged JSON", "{"],
    ["nothing", null],
    ["a later version", JSON.stringify({ ...saved(), version: 3 })],
    ["an empty title", JSON.stringify({ ...saved(), title: " " })],
    ["missing notes", JSON.stringify({ ...saved(), notes: undefined })],
    ["an unknown assignee", JSON.stringify({ ...saved(), assignee: "zed" })],
    ["a missing date", JSON.stringify({ ...saved(), createdAt: 1 })],
    ["a missing due date", JSON.stringify({ ...saved(), dueDate: undefined })],
    [
      "a due date that is not a day",
      JSON.stringify({ ...saved(), dueDate: "2026-02-30" }),
    ],
    [
      "a due date with a time",
      JSON.stringify({ ...saved(), dueDate: "2026-10-16T00:00" }),
    ],
  ])("treats %s as unreadable", (_, json) => {
    expect(parseProject("a", json)).toBeNull();
  });

  it("lists projects oldest first", () => {
    const later = { ...project, id: "b", createdAt: "2026-10-16T00:00:00Z" };
    expect(sortProjects([later, project]).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

function saved() {
  return JSON.parse(serialiseProject(project));
}
