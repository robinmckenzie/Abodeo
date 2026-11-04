import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  declineMove,
  deleteStoredProject,
  forgetDeclinedMove,
  hasProjectsScript,
  isMoveDeclined,
  listOwnProjects,
  removeAccountHint,
  removeProjectsIfUnchanged,
  writeAccountHint,
  hasOwnProjects,
  loadProjects,
  projectKeyPrefix,
  saveProjectChanges,
  saveProjectTasks,
} from "./project-storage";
import { addTasks, deleteTask, setTaskDone } from "./tasks";

const fields = {
  title: "Kitchen",
  notes: "Tiles\nGrout",
  assignee: "unassigned",
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

describe("deleting a stored project (AD #62 Delete Projects)", () => {
  it("removes the project for good, and no other", async () => {
    const first = await createProject(fields);
    const second = await createProject({ ...fields, title: "Garden" });
    if (!first.ok || !second.ok) throw new Error("not created");

    expect(deleteStoredProject(first.project.id)).toEqual({ ok: true });
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects.map((p) => p.title)).toEqual([
      "Garden",
    ]);
    expect(deleteStoredProject(first.project.id)).toEqual({ ok: true });
  });

  it("reports storage that will not let it", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(deleteStoredProject("p1")).toEqual({
      ok: false,
      reason: "unavailable",
    });
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

describe("whether the visitor has projects, for the welcome screen", () => {
  const runScript = () => new Function(hasProjectsScript)();
  const isMarked = () =>
    document.documentElement.hasAttribute("data-has-projects");

  it("counts none while only other settings are saved", () => {
    localStorage.setItem("abodeo-fade-tuning", "{}");
    expect(hasOwnProjects()).toBe(false);
    runScript();
    expect(isMarked()).toBe(false);
  });

  it("counts any saved project, even one that cannot be read", async () => {
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    expect(hasOwnProjects()).toBe(true);
    runScript();
    expect(isMarked()).toBe(true);
    document.documentElement.removeAttribute("data-has-projects");

    localStorage.clear();
    await createProject({ ...fields, title: "Mine" });
    expect(hasOwnProjects()).toBe(true);
    runScript();
    expect(isMarked()).toBe(true);
  });
});

describe("a browser's own projects, for moving into an account", () => {
  it("lists every readable project", async () => {
    const first = await createProject(fields);
    const second = await createProject({ ...fields, title: "Hall" });
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    if (!first.ok || !second.ok) throw new Error("Not created");

    expect(listOwnProjects().map(({ id }) => id).sort()).toEqual(
      [first.project.id, second.project.id].sort(),
    );
  });

  it("removes a moved project only if it has not changed since", async () => {
    const kept = await createProject(fields);
    const removed = await createProject({ ...fields, title: "Hall" });
    if (!kept.ok || !removed.ok) throw new Error("Not created");
    await saveProjectChanges(kept.project.id, { notes: "Changed in a tab" });

    removeProjectsIfUnchanged([kept.project, removed.project]);

    expect(loadProjects()).toMatchObject({
      projects: [{ id: kept.project.id, notes: "Changed in a tab" }],
    });
  });

  it("remembers a declined move for one account until forgotten", () => {
    declineMove("ada");
    expect(isMoveDeclined("ada")).toBe(true);
    expect(isMoveDeclined("grace")).toBe(false);
    forgetDeclinedMove();
    expect(isMoveDeclined("ada")).toBe(false);
  });
});

describe("the signed-in account's hint for the welcome screen", () => {
  const runScript = () => new Function(hasProjectsScript)();
  const isMarked = () =>
    document.documentElement.hasAttribute("data-has-projects");

  afterEach(() => {
    removeAccountHint();
    document.documentElement.removeAttribute("data-has-projects");
  });

  it("decides instead of the browser's projects while it is there", async () => {
    await createProject(fields);
    writeAccountHint("ada", false);
    expect(hasOwnProjects()).toBe(false);
    runScript();
    expect(isMarked()).toBe(false);

    writeAccountHint("ada", true);
    localStorage.removeItem(
      Object.keys(localStorage).find((key) =>
        key.startsWith(projectKeyPrefix),
      )!,
    );
    expect(hasOwnProjects()).toBe(true);
    runScript();
    expect(isMarked()).toBe(true);
  });

  it("leaves the browser's projects to decide once removed", async () => {
    writeAccountHint("ada", true);
    removeAccountHint();
    expect(hasOwnProjects()).toBe(false);
    await createProject(fields);
    expect(hasOwnProjects()).toBe(true);
  });
});
