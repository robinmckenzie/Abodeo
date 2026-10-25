import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStoredPerson,
  countStoredAssignedProjects,
  loadPeople,
  removeStoredPerson,
  renameStoredPerson,
} from "./people-management";
import { peopleKey, readStoredPeople } from "./people-storage";
import {
  createProject,
  loadProjects,
  saveProjectChanges,
} from "./project-storage";
import { newProjectFields } from "./projects";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const fields = { ...newProjectFields, title: "Shed" };

// Saves a project that is assigned to someone, as an earlier version could.
async function createAssigned(title: string, assignee: string) {
  const created = await createProject({ ...fields, title });
  if (!created.ok) throw new Error("not created");
  const key = `abodeo-project:${created.project.id}`;
  localStorage.setItem(
    key,
    localStorage.getItem(key)!.replace('"unassigned"', `"${assignee}"`),
  );
  return created.project.id;
}

const assigneesOf = () => {
  const loaded = loadProjects();
  return loaded.ok ? loaded.projects.map((project) => project.assignee) : [];
};

describe("the browser's list of people", () => {
  it("starts empty for a browser with no projects, writing nothing", () => {
    expect(loadPeople()).toEqual({ ok: true, people: [] });
    expect(localStorage.getItem(peopleKey)).toBeNull();
  });

  it("starts with those the projects are assigned to, and keeps them", async () => {
    await createAssigned("One", "boris");
    await createAssigned("Two", "andy");
    expect(loadPeople()).toEqual({
      ok: true,
      people: [
        { id: "andy", name: "Andy" },
        { id: "boris", name: "Boris" },
      ],
    });
    // Fixed once saved: nothing assigned later changes it.
    await createAssigned("Three", "clement");
    expect(loadPeople()).toMatchObject({
      people: [{ id: "andy" }, { id: "boris" }],
    });
  });

  it("leaves a list it cannot read as it is", async () => {
    localStorage.setItem(peopleKey, "{damaged");
    expect(loadPeople()).toEqual({ ok: false, reason: "unreadable" });
    expect(await addStoredPerson("a", "Dora")).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(localStorage.getItem(peopleKey)).toBe("{damaged");
  });

  it("adds, renames and refuses bad names, keeping each change", async () => {
    expect(await addStoredPerson("a", "  Dora ")).toMatchObject({
      ok: true,
      people: [{ id: "a", name: "Dora" }],
    });
    expect(await addStoredPerson("a", "Dora")).toMatchObject({ ok: true });
    expect(await addStoredPerson("b", "dora")).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(await renameStoredPerson("a", "Dorothy")).toMatchObject({
      ok: true,
    });
    expect(await renameStoredPerson("zed", "Zed")).toEqual({
      ok: false,
      reason: "not-found",
    });
    const stored = readStoredPeople();
    expect(stored).toEqual({
      state: "found",
      people: [{ id: "a", name: "Dorothy" }],
    });
  });

  it("keeps a person's projects when they are renamed", async () => {
    await createAssigned("One", "andy");
    await loadPeople();
    await renameStoredPerson("andy", "Anders");
    expect(assigneesOf()).toEqual(["andy"]);
  });

  it("refuses to assign someone who is not in the list", async () => {
    const id = await createAssigned("One", "andy");
    loadPeople();
    expect(await saveProjectChanges(id, { assignee: "zed" })).toEqual({
      ok: false,
      reason: "unknown-assignee",
    });
    expect(await saveProjectChanges(id, { assignee: "unassigned" })).toEqual({
      ok: true,
    });
    expect(await saveProjectChanges(id, { assignee: "andy" })).toEqual({
      ok: true,
    });
    expect(await createProject({ ...fields, assignee: "zed" })).toEqual({
      ok: false,
      reason: "unknown-assignee",
    });
  });

  describe("removing someone", () => {
    it("counts the projects assigned to them", async () => {
      await createAssigned("One", "andy");
      await createAssigned("Two", "andy");
      await createAssigned("Three", "boris");
      expect(countStoredAssignedProjects("andy")).toBe(2);
      expect(countStoredAssignedProjects("zed")).toBe(0);
    });

    it.each([
      ["with Web Locks", true],
      ["without Web Locks", false],
    ])("sets their projects to Unassigned %s", async (_, hasLocks) => {
      if (hasLocks) {
        vi.stubGlobal("navigator", {
          locks: { request: (_name: string, work: () => unknown) => work() },
        });
      } else {
        vi.stubGlobal("navigator", {});
      }
      await createAssigned("One", "andy");
      await createAssigned("Two", "boris");
      await createAssigned("Three", "andy");
      loadPeople();
      const result = await removeStoredPerson("andy", 2);
      expect(result).toEqual({
        ok: true,
        people: [{ id: "boris", name: "Boris" }],
      });
      expect(assigneesOf().sort()).toEqual([
        "boris",
        "unassigned",
        "unassigned",
      ]);
      expect(readStoredPeople()).toMatchObject({
        people: [{ id: "boris" }],
      });
    });

    it("makes creating an assigned project take its turn with removing people", async () => {
      const names: string[] = [];
      vi.stubGlobal("navigator", {
        locks: {
          request: (name: string, work: () => unknown) => {
            names.push(name);
            return work();
          },
        },
      });
      loadPeople();
      await createProject({ ...fields, assignee: "andy" });
      expect(names).toEqual(["abodeo-people"]);
    });

    it("changes nothing when the count is no longer the one confirmed", async () => {
      await createAssigned("One", "andy");
      loadPeople();
      expect(await removeStoredPerson("andy", 0)).toEqual({
        ok: false,
        reason: "count-changed",
        count: 1,
      });
      expect(assigneesOf()).toEqual(["andy"]);
      expect(readStoredPeople()).toMatchObject({ people: [{ id: "andy" }] });
    });

    it("leaves projects that cannot be read alone", async () => {
      await createAssigned("One", "andy");
      loadPeople();
      localStorage.setItem(
        "abodeo-project:future",
        JSON.stringify({ version: 99, assignee: "andy" }),
      );
      expect(await removeStoredPerson("andy", 1)).toMatchObject({ ok: true });
      expect(localStorage.getItem("abodeo-project:future")).toBe(
        JSON.stringify({ version: 99, assignee: "andy" }),
      );
    });

    it("finds the person already removed when sent again", async () => {
      await createAssigned("One", "andy");
      loadPeople();
      await removeStoredPerson("andy", 1);
      expect(await removeStoredPerson("andy", 1)).toEqual({
        ok: true,
        people: [],
      });
    });

    it("sets every project assigned to them to Unassigned when no count was confirmed, without Web Locks", async () => {
      vi.stubGlobal("navigator", {});
      const id = await createAssigned("One", "andy");
      loadPeople();
      const other = await createAssigned("Two", "andy");
      const result = await removeStoredPerson("andy");
      expect(result).toMatchObject({ ok: true });
      expect(assigneesOf()).toEqual(["unassigned", "unassigned"]);
      expect([id, other]).toHaveLength(2);
    });
  });
});
