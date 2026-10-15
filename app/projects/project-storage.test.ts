import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  hasProjectsScript,
  hasSavedProjects,
  loadProjects,
  projectKeyPrefix,
  saveProjectChanges,
} from "./project-storage";

const fields = {
  title: "Kitchen",
  notes: "Tiles\nGrout",
  assignee: "andy" as const,
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
    expect(hasSavedProjects()).toBe(false);
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
    expect(localStorage.getItem(`${projectKeyPrefix}bad`)).toBe("{damaged");
  });

  it("counts only projects as saved, not tuning settings", () => {
    localStorage.setItem("abodeo-fade-tuning", "{}");
    localStorage.setItem("abodeo-project-presentation", "in-place");
    expect(hasSavedProjects()).toBe(false);
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    expect(hasSavedProjects()).toBe(true);
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
