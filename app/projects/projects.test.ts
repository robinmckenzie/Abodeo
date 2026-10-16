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
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
};

describe("projects", () => {
  it("needs a title with at least one non-space character", () => {
    expect(hasTitle("")).toBe(false);
    expect(hasTitle("  \n\t")).toBe(false);
    expect(hasTitle(" a ")).toBe(true);
  });

  it("starts a new project empty and unassigned", () => {
    expect(newProjectFields).toEqual({
      title: "",
      notes: "",
      assignee: "unassigned",
    });
  });

  it("reads back what it saves, including line breaks in notes", () => {
    expect(parseProject("a", serialiseProject(project))).toEqual(project);
  });

  it.each([
    ["damaged JSON", "{"],
    ["nothing", null],
    ["a later version", JSON.stringify({ ...saved(), version: 2 })],
    ["an empty title", JSON.stringify({ ...saved(), title: " " })],
    ["missing notes", JSON.stringify({ ...saved(), notes: undefined })],
    ["an unknown assignee", JSON.stringify({ ...saved(), assignee: "zed" })],
    ["a missing date", JSON.stringify({ ...saved(), createdAt: 1 })],
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
