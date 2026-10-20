import { describe, expect, it } from "vitest";

import {
  buildDefaultProjectsFile,
  bundledDefaultProjects,
  readDefaultProjects,
} from "./default-projects";
import type { Project } from "./projects";

const kitchen: Project = {
  id: "kitchen",
  title: "Kitchen",
  notes: "Tiles",
  assignee: "andy",
  dueDate: "2026-11-01",
  tasks: [{ id: "t1", title: "Grout", isDone: false }],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("default projects", () => {
  it("reads back the projects a file was built from, in order", () => {
    const garden = { ...kitchen, id: "garden", createdAt: "2026-09-01" };
    const file = buildDefaultProjectsFile([kitchen, garden]);
    expect(readDefaultProjects(file)?.projects).toEqual([garden, kitchen]);
  });

  it("builds the same file from the projects it reads", () => {
    const file = buildDefaultProjectsFile([kitchen]);
    const read = readDefaultProjects(file);
    expect(buildDefaultProjectsFile(read!.projects)).toEqual(file);
    expect(readDefaultProjects(structuredClone(file))?.hash).toBe(read?.hash);
  });

  it("changes the hash when any data changes", () => {
    const hashOf = (project: Project) =>
      readDefaultProjects(buildDefaultProjectsFile([project]))?.hash;
    const original = hashOf(kitchen);
    expect(hashOf({ ...kitchen, notes: "Tiles." })).not.toBe(original);
    expect(
      hashOf({ ...kitchen, tasks: [{ ...kitchen.tasks[0], isDone: true }] }),
    ).not.toBe(original);
  });

  it("rejects the whole file if any entry is damaged or repeats an id", () => {
    const file = buildDefaultProjectsFile([kitchen]);
    expect(
      readDefaultProjects({ projects: [...file.projects, { id: "x" }] }),
    ).toBeNull();
    expect(
      readDefaultProjects({ projects: [...file.projects, ...file.projects] }),
    ).toBeNull();
    expect(
      readDefaultProjects({ projects: [{ ...file.projects[0], id: "" }] }),
    ).toBeNull();
    expect(readDefaultProjects({})).toBeNull();
    expect(readDefaultProjects(null)).toBeNull();
  });

  it("reads the bundled file", () => {
    expect(bundledDefaultProjects).not.toBeNull();
  });
});
