import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDefaultProjectsFile,
  readDefaultProjects,
  type DefaultProjects,
} from "./default-projects";
import {
  createProject,
  hasProjectsScript,
  hasOwnProjects,
  loadProjects,
  markProjectsAsDefaults,
  projectKeyPrefix,
  receiveDefaultProjects,
  resetToDefaultProjects,
  saveProjectChanges,
  saveProjectTasks,
} from "./project-storage";
import type { Project } from "./projects";
import { addTasks, deleteTask, setTaskDone } from "./tasks";

const fields = {
  title: "Kitchen",
  notes: "Tiles\nGrout",
  assignee: "andy" as const,
  dueDate: null,
  tasks: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-has-projects");
  history.replaceState(null, "", "/");
});

describe("project storage", () => {
  it("keeps created projects, with line breaks in notes", async () => {
    await createProject(fields);
    await createProject({ ...fields, title: "Kitchen" });
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects.map((p) => p.title)).toEqual([
      "Kitchen",
      "Kitchen",
    ]);
    expect(loaded.ok && loaded.projects[0].notes).toBe("Tiles\nGrout");
  });

  it("keeps a due date, and its change or clearing", async () => {
    const created = await createProject({ ...fields, dueDate: "2026-10-16" });
    if (!created.ok) throw new Error("not created");
    const loadDueDate = () => {
      const loaded = loadProjects();
      return loaded.ok && loaded.projects[0].dueDate;
    };
    expect(loadDueDate()).toBe("2026-10-16");
    await saveProjectChanges(created.project.id, { dueDate: "2027-02-28" });
    expect(loadDueDate()).toBe("2027-02-28");
    await saveProjectChanges(created.project.id, { dueDate: null });
    expect(loadDueDate()).toBeNull();
  });

  it("keeps tasks, applying each change to the tasks as saved", async () => {
    const created = await createProject(fields);
    if (!created.ok) throw new Error("not created");
    const { id } = created.project;
    const tiles = { id: "t1", title: "Tiles", isDone: false };
    const grout = { id: "t2", title: "Grout", isDone: false };
    expect(
      await saveProjectTasks(id, (tasks) => addTasks(tasks, [tiles])),
    ).toEqual({ ok: true, tasks: [tiles] });
    // Another tab adds a task, which this tab has not seen.
    await saveProjectTasks(id, (tasks) => addTasks(tasks, [grout]));
    await saveProjectTasks(id, (tasks) => setTaskDone(tasks, "t1", true));
    const loadTasks = () => {
      const loaded = loadProjects();
      return loaded.ok && loaded.projects[0].tasks;
    };
    expect(loadTasks()).toEqual([{ ...tiles, isDone: true }, grout]);
    // A change to another field keeps the tasks.
    await saveProjectChanges(id, { notes: "More" });
    await saveProjectTasks(id, (tasks) => deleteTask(tasks, "t2"));
    expect(loadTasks()).toEqual([{ ...tiles, isDone: true }]);
  });

  it("does not create a project without a title", async () => {
    const result = await createProject({ ...fields, title: "   " });
    expect(result).toEqual({ ok: false, reason: "no-title" });
    expect(localStorage.length).toBe(0);
  });

  it("writes before it first waits, so a save as the page is left completes", () => {
    void createProject(fields);
    expect(localStorage.length).toBe(1);
  });

  it("saves only the fields changed, keeping changes made elsewhere", async () => {
    const created = await createProject(fields);
    if (!created.ok) throw new Error("not created");
    const key = projectKeyPrefix + created.project.id;
    // Another tab changes the notes.
    const other = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...other, notes: "Theirs" }));

    await saveProjectChanges(created.project.id, { title: "Bathroom" });

    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved.title).toBe("Bathroom");
    expect(saved.notes).toBe("Theirs");
  });

  it("keeps another tab's new project when this tab creates one", async () => {
    await createProject(fields);
    // Another tab creates one, which this tab has not seen.
    localStorage.setItem(
      `${projectKeyPrefix}other`,
      localStorage.getItem(localStorage.key(0)!)!,
    );
    await createProject({ ...fields, title: "Garden" });
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects).toHaveLength(3);
  });

  it("reports full storage and leaves saved projects exactly as they were", async () => {
    const created = await createProject(fields);
    if (!created.ok) throw new Error("not created");
    const before = { ...localStorage };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });

    expect(await createProject(fields)).toEqual({ ok: false, reason: "full" });
    expect(
      await saveProjectChanges(created.project.id, { notes: "More" }),
    ).toEqual({ ok: false, reason: "full" });
    expect(
      await saveProjectTasks(created.project.id, (tasks) => tasks),
    ).toEqual({ ok: false, reason: "full" });
    expect({ ...localStorage }).toEqual(before);
  });

  it("reports storage that cannot be used", async () => {
    localStorage.setItem(`${projectKeyPrefix}a`, "{}");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(await createProject(fields)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(loadProjects()).toEqual({ ok: false });
    expect(hasOwnProjects()).toBe(false);
  });

  it("counts unreadable projects and never saves over them", async () => {
    await createProject(fields);
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");

    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects).toHaveLength(1);
    expect(loaded.ok && loaded.unreadableCount).toBe(1);
    expect(await saveProjectChanges("bad", { title: "Fixed" })).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await saveProjectTasks("bad", (tasks) => tasks)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(localStorage.getItem(`${projectKeyPrefix}bad`)).toBe("{damaged");
  });

  it("counts only projects as saved, not tuning settings", () => {
    localStorage.setItem("abodeo-fade-tuning", "{}");
    localStorage.setItem("abodeo-project-presentation", "in-place");
    expect(hasOwnProjects()).toBe(false);
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    expect(hasOwnProjects()).toBe(true);
  });
});

describe("hasProjectsScript", () => {
  const runScript = () => new Function(hasProjectsScript)();
  const isMarked = () =>
    document.documentElement.hasAttribute("data-has-projects");

  it("marks the page when a project is saved, readable or not", async () => {
    runScript();
    expect(isMarked()).toBe(false);
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    runScript();
    expect(isMarked()).toBe(true);
  });

  it("does not mark the page for tuning settings alone", () => {
    localStorage.setItem("abodeo-button-tuning", "{}");
    runScript();
    expect(isMarked()).toBe(false);
  });

  it("does not mark the page when the welcome screen is asked for", async () => {
    await createProject(fields);
    history.replaceState(null, "", "/?welcome");
    runScript();
    expect(isMarked()).toBe(false);
  });

  it("does nothing when storage cannot be used", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    localStorage.setItem(`${projectKeyPrefix}a`, "{}");
    expect(runScript).not.toThrow();
    expect(isMarked()).toBe(false);
  });
});

function makeDefault(id: string, title: string): Project {
  return {
    ...fields,
    id,
    title,
    createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeDefaults(...projects: Project[]): DefaultProjects {
  return readDefaultProjects(buildDefaultProjectsFile(projects))!;
}

function loadTitles() {
  const loaded = loadProjects();
  return loaded.ok ? loaded.projects.map((p) => p.title) : null;
}

const hall = makeDefault("d1", "Hall");
const loft = makeDefault("d22", "Loft");
const shed = makeDefault("d333", "Shed");

describe("default projects", () => {
  it("adds the defaults alongside the visitor's own projects", async () => {
    await createProject({ ...fields, title: "Mine" });
    expect(receiveDefaultProjects(makeDefaults(hall, loft))).toEqual({
      ok: true,
    });
    expect(loadTitles()?.sort()).toEqual(["Hall", "Loft", "Mine"]);
  });

  it("keeps edits to defaults when the defaults have not changed", async () => {
    const defaults = makeDefaults(hall);
    receiveDefaultProjects(defaults);
    await saveProjectChanges("d1", { notes: "Edited" });
    receiveDefaultProjects(makeDefaults(hall));
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects[0].notes).toBe("Edited");
    expect(loadTitles()).toEqual(["Hall"]);
  });

  it("replaces, adds and removes defaults when they change, keeping own projects", async () => {
    receiveDefaultProjects(makeDefaults(hall, loft));
    await saveProjectChanges("d1", { notes: "Edited" });
    const mine = await createProject({ ...fields, title: "Mine" });
    if (!mine.ok) throw new Error("not created");
    const newHall = { ...hall, title: "Hallway" };
    receiveDefaultProjects(makeDefaults(newHall, shed));
    const loaded = loadProjects();
    if (!loaded.ok) throw new Error("not loaded");
    expect(loaded.projects.map((p) => p.title).sort()).toEqual([
      "Hallway",
      "Mine",
      "Shed",
    ]);
    expect(loaded.projects.find((p) => p.id === "d1")?.notes).toBe(hall.notes);
    expect(loaded.projects.find((p) => p.id === mine.project.id)).toEqual(
      mine.project,
    );
  });

  it("does not duplicate defaults on later loads or changes", () => {
    receiveDefaultProjects(makeDefaults(hall));
    receiveDefaultProjects(makeDefaults(hall));
    receiveDefaultProjects(makeDefaults({ ...hall, notes: "New" }));
    expect(loadTitles()).toEqual(["Hall"]);
  });

  it("writes nothing when there are no defaults and none were received", () => {
    receiveDefaultProjects(makeDefaults());
    expect(localStorage.length).toBe(0);
  });

  it("changes nothing for a damaged defaults file", async () => {
    receiveDefaultProjects(makeDefaults(hall));
    receiveDefaultProjects(null);
    expect(loadTitles()).toEqual(["Hall"]);
  });

  it("never writes over or removes a default it cannot read", () => {
    receiveDefaultProjects(makeDefaults(hall, loft));
    localStorage.setItem(`${projectKeyPrefix}d1`, '{"version":99}');
    localStorage.setItem(`${projectKeyPrefix}d22`, '{"version":99}');
    receiveDefaultProjects(makeDefaults({ ...hall, notes: "New" }));
    expect(localStorage.getItem(`${projectKeyPrefix}d1`)).toBe(
      '{"version":99}',
    );
    expect(localStorage.getItem(`${projectKeyPrefix}d22`)).toBe(
      '{"version":99}',
    );
    // Still defaults, so not the visitor's own.
    expect(hasOwnProjects()).toBe(false);
  });

  it("tries again on the next load if storage fails part way", () => {
    const defaults = makeDefaults(hall, loft);
    const setItem = Storage.prototype.setItem;
    let writes = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      writes += 1;
      if (writes === 2) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      setItem.call(this, key, value);
    });
    expect(receiveDefaultProjects(defaults)).toEqual({
      ok: false,
      reason: "full",
    });
    vi.restoreAllMocks();
    receiveDefaultProjects(defaults);
    expect(loadTitles()).toEqual(["Hall", "Loft"]);
  });

  it("counts projects saved as defaults as defaults, without copying them", async () => {
    const created = await createProject({ ...fields, title: "Saved" });
    if (!created.ok) throw new Error("not created");
    expect(hasOwnProjects()).toBe(true);
    const defaults = makeDefaults(created.project);
    markProjectsAsDefaults(defaults);
    expect(hasOwnProjects()).toBe(false);
    await saveProjectChanges(created.project.id, { notes: "Edited" });
    receiveDefaultProjects(defaults);
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects.map((p) => p.notes)).toEqual([
      "Edited",
    ]);
  });

  it("resets to exactly the defaults, readable projects or not", async () => {
    receiveDefaultProjects(makeDefaults(hall));
    await saveProjectChanges("d1", { notes: "Edited" });
    await createProject({ ...fields, title: "Mine" });
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    localStorage.setItem("abodeo-fade-tuning", "{}");
    expect(resetToDefaultProjects(makeDefaults(hall, loft))).toEqual({
      ok: true,
    });
    const loaded = loadProjects();
    expect(loaded).toEqual({
      ok: true,
      projects: [hall, loft],
      unreadableCount: 0,
    });
    expect(localStorage.getItem("abodeo-fade-tuning")).toBe("{}");
    expect(hasOwnProjects()).toBe(false);
  });

  it("removes nothing when a reset cannot write the defaults", async () => {
    await createProject({ ...fields, title: "Mine" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(resetToDefaultProjects(makeDefaults(hall))).toEqual({
      ok: false,
      reason: "full",
    });
    expect(loadTitles()).toEqual(["Mine"]);
  });

  it("does not count defaults as the visitor's own projects", async () => {
    const runScript = () => new Function(hasProjectsScript)();
    const isMarked = () =>
      document.documentElement.hasAttribute("data-has-projects");
    receiveDefaultProjects(makeDefaults(hall));
    expect(hasOwnProjects()).toBe(false);
    runScript();
    expect(isMarked()).toBe(false);
    await createProject({ ...fields, title: "Mine" });
    expect(hasOwnProjects()).toBe(true);
    runScript();
    expect(isMarked()).toBe(true);
  });
});
