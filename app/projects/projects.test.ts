import { describe, expect, it } from "vitest";

import {
  hasTitle,
  newProjectFields,
  parseProject,
  serialiseProject,
  sortProjects,
  sortProjectsByDueDate,
  type Project,
} from "./projects";

const project: Project = {
  id: "a",
  title: "Kitchen",
  notes: "Line one\nLine two",
  assignee: "boris",
  dueDate: "2026-10-16",
  tasks: [
    { id: "t1", title: "Buy tiles", isDone: true },
    { id: "t2", title: "**Grout**", isDone: false },
  ],
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
      tasks: [],
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
    expect(parseProject("a", json)).toEqual({
      ...project,
      dueDate: null,
      tasks: [],
    });
  });

  it("reads a project saved before tasks as having none, keeping the rest", () => {
    const older = { ...saved(), version: 2 };
    delete older.tasks;
    const json = JSON.stringify(older);
    expect(parseProject("a", json)).toEqual({ ...project, tasks: [] });
  });

  it("reads back a project with no tasks", () => {
    const empty = { ...project, tasks: [] };
    expect(parseProject("a", serialiseProject(empty))).toEqual(empty);
  });

  it.each([
    ["damaged JSON", "{"],
    ["nothing", null],
    ["a later version", JSON.stringify({ ...saved(), version: 4 })],
    ["an empty title", JSON.stringify({ ...saved(), title: " " })],
    ["missing notes", JSON.stringify({ ...saved(), notes: undefined })],
    [
      "an assignee that is not an id",
      JSON.stringify({ ...saved(), assignee: "not an id!" }),
    ],
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
    ["missing tasks", JSON.stringify({ ...saved(), tasks: undefined })],
    [
      "a task without a title",
      JSON.stringify({
        ...saved(),
        tasks: [{ id: "t", title: " ", isDone: false }],
      }),
    ],
    [
      "a task without a done state",
      JSON.stringify({ ...saved(), tasks: [{ id: "t", title: "A" }] }),
    ],
  ])("treats %s as unreadable", (_, json) => {
    expect(parseProject("a", json)).toBeNull();
  });

  it("reads a project assigned to someone it knows nothing about", () => {
    // Who exists is for the list of people to say, so that removing someone
    // never makes a project unreadable.
    const json = JSON.stringify({ ...saved(), assignee: "zed" });
    expect(parseProject("a", json)?.assignee).toBe("zed");
  });

  it("lists projects by due date, then those without one by title", () => {
    const make = (id: string, title: string, dueDate: string | null) => ({
      ...project,
      id,
      title,
      dueDate,
    });
    const sorted = sortProjectsByDueDate([
      make("a", "Zed", null),
      make("b", "Later", "2026-12-01"),
      make("c", "apple", null),
      make("d", "Sooner", "2026-11-01"),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("lists projects oldest first", () => {
    const later = { ...project, id: "b", createdAt: "2026-10-16T00:00:00Z" };
    expect(sortProjects([later, project]).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

function saved() {
  return JSON.parse(serialiseProject(project));
}
