// The project editing lifecycle (AD #111), tested without the dashboard. An
// account's projects are the real projects endpoints over a memory store,
// behind a fake fetch. Signed out, the projects are in the browser's storage.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleProjectsRequest } from "./project-handler.server";
import { newProjectFields, type Project } from "./projects";
import { createProject, listOwnProjects } from "./project-storage";
import { TaskDrafts } from "./task-drafts";
import { createMemoryProjectStore } from "./test-projects.server";
import type { Task } from "./tasks";
import { useProjectEditing } from "./use-project-editing";
import type { ProjectsSource, ProjectsView } from "./use-projects";

const accountId = "ada";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    ...newProjectFields,
    id: crypto.randomUUID(),
    title: "Kitchen",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTask(title: string): Task {
  return { id: crypto.randomUUID(), title, isDone: false };
}

type Server = {
  projects: ReturnType<typeof createMemoryProjectStore>;
  calls: string[];
  // Answers every projects request with this status instead, when set.
  status: number | null;
  // Holds each projects request until this settles, when set.
  gate: Promise<void> | null;
};

function startServer() {
  const server: Server = {
    projects: createMemoryProjectStore(),
    calls: [],
    status: null,
    gate: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      server.calls.push(`${init.method ?? "GET"} ${path}`);
      if (server.gate) await server.gate;
      if (server.status !== null) {
        return Response.json(
          { error: "unavailable" },
          { status: server.status },
        );
      }
      return handleProjectsRequest(
        new Request(`http://localhost${path}`, {
          method: init.method,
          headers: init.headers,
          body: init.body,
        }),
        {
          readSessionUserId: async () => accountId,
          store: server.projects.store,
          reportFailure: () => {},
        },
      );
    }),
  );
  return server;
}

function seed(server: Server, ...projects: Project[]) {
  const own = new Map(projects.map((project) => [project.id, project]));
  server.projects.accounts.set(accountId, own);
}

function stored(server: Server, id: string) {
  return server.projects.accounts.get(accountId)?.get(id);
}

const accountView: ProjectsView = {
  kind: "account",
  accountId,
  generation: 1,
  state: "ready",
  projects: [],
  unreadableCount: 0,
  latestImageIds: {},
  imageCounts: {},
};

function renderEditing(view: ProjectsView, taskDrafts = new TaskDrafts()) {
  const source: ProjectsSource = {
    view,
    showLatestImage: vi.fn(),
    showSavedProject: vi.fn(),
    removeProject: vi.fn(),
    reload: vi.fn(),
  };
  const notices = {
    refreshBinCount: vi.fn(),
    onAccountFailure: vi.fn(),
    onPeopleOutdated: vi.fn(),
    onClosed: vi.fn(),
    onCreated: vi.fn(),
    onDeleted: vi.fn(),
  };
  const hook = renderHook(() =>
    useProjectEditing({ source, taskDrafts, ...notices }),
  );
  return { ...hook, source, taskDrafts, ...notices };
}

// Lets answers arrive and, with `ms`, the autosave pause pass.
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const pause = 600;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useProjectEditing signed out", () => {
  const browserView: ProjectsView = { kind: "browser", result: null };

  async function openStored(fields = {}) {
    const created = await createProject({
      ...newProjectFields,
      title: "Kitchen",
      ...fields,
    });
    if (!created.ok) throw new Error("not created");
    const editing = renderEditing(browserView);
    act(() => editing.result.current.openProject(created.project, 40, 0));
    return { editing, project: created.project };
  }

  it("autosaves an edit after the pause", async () => {
    const { editing, project } = await openStored();
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    expect(editing.result.current.open?.values.notes).toBe("Tiles");
    expect(listOwnProjects()[0].notes).toBe("");
    await settle(pause);
    expect(listOwnProjects().find(({ id }) => id === project.id)?.notes).toBe(
      "Tiles",
    );
  });

  it("saves a pending edit when the project closes", async () => {
    const { editing } = await openStored();
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    act(() => editing.result.current.closeProject());
    await settle(0);
    expect(editing.result.current.open).toBeNull();
    expect(listOwnProjects()[0].notes).toBe("Tiles");
    expect(editing.onClosed).toHaveBeenCalledWith(listOwnProjects()[0].id);
  });

  it("adds a new project once, however often Create is pressed", async () => {
    const editing = renderEditing(browserView);
    act(() => editing.result.current.openNewProject());
    act(() => editing.result.current.changeFields({ title: "Garden" }));
    await act(async () => {
      await Promise.all([
        editing.result.current.createProject(),
        editing.result.current.createProject(),
      ]);
    });
    expect(listOwnProjects().map(({ title }) => title)).toEqual(["Garden"]);
    expect(editing.onCreated).toHaveBeenCalledTimes(1);
    expect(editing.result.current.open).toBeNull();
  });

  it("asks for a title instead of adding a project without one", async () => {
    const editing = renderEditing(browserView);
    act(() => editing.result.current.openNewProject());
    await act(() => editing.result.current.createProject());
    expect(editing.result.current.open?.message?.text).toBe(
      "A project needs a title.",
    );
    expect(listOwnProjects()).toEqual([]);
  });

  it("deletes the open project from storage, closing it first", async () => {
    const { editing, project } = await openStored();
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    act(() =>
      editing.result.current.startDelete({
        imageCount: null,
        appointmentCount: null,
      }),
    );
    expect(editing.result.current.deletion?.mode).toBe("browser");
    await act(() => editing.result.current.confirmDelete());
    expect(editing.result.current.open).toBeNull();
    expect(editing.result.current.deletion).toBeNull();
    expect(
      listOwnProjects().find(({ id }) => id === project.id),
    ).toBeUndefined();
    expect(editing.onClosed).toHaveBeenCalled();
    expect(editing.onDeleted).toHaveBeenCalledTimes(1);
  });

  it("does not stop the browser leaving the page", async () => {
    const { editing } = await openStored();
    act(() => editing.result.current.changeFields({ title: "" }));
    await settle(pause);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("useProjectEditing signed in", () => {
  async function openAccount(server: Server, project = makeProject()) {
    seed(server, project);
    const editing = renderEditing(accountView);
    act(() => editing.result.current.openProject(project, 40, 0));
    await settle();
    return { editing, project };
  }

  it("shows the project read-only until its latest copy has loaded", async () => {
    const server = startServer();
    const project = makeProject();
    seed(server, project);
    const editing = renderEditing(accountView);
    act(() => editing.result.current.openProject(project, 40, 0));
    expect(editing.result.current.open?.isLoading).toBe(true);
    await settle();
    expect(editing.result.current.open?.isLoading).toBe(false);
    expect(editing.source.showSavedProject).toHaveBeenCalled();
  });

  it("autosaves an edit to the account after the pause", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    await settle(pause);
    expect(stored(server, project.id)?.notes).toBe("Tiles");
    expect(editing.source.showSavedProject).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ notes: "Tiles" }),
    );
  });

  it("saves a pending edit when the project closes", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    act(() => editing.result.current.closeProject());
    await settle(0);
    expect(stored(server, project.id)?.notes).toBe("Tiles");
  });

  it("reports a failed save as unsaved, and the warning on leaving lists it", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    server.status = 503;
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    await settle(pause);
    expect(editing.result.current.open?.message?.text).toBe(
      "Not saved: Abodeo cannot reach your projects right now.",
    );
    expect(editing.result.current.unsavedIds.has(project.id)).toBe(true);
    expect(editing.onAccountFailure).toHaveBeenCalledWith("unreachable");

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let leave = true;
    await act(async () => {
      leave = await editing.result.current.prepareToLeave();
    });
    expect(leave).toBe(false);
    expect(confirm.mock.calls[0][0]).toContain(
      "changes to the project that were not saved",
    );

    // Closed, the failed save is another project's.
    act(() => editing.result.current.closeProject());
    await settle(0);
    confirm.mockClear();
    await act(async () => {
      await editing.result.current.prepareToLeave();
    });
    expect(confirm.mock.calls[0][0]).toContain(
      "changes to other projects that were not saved",
    );
  });

  it("lets the person keep the saved version after a conflict", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    stored(server, project.id)!.notes = "Elsewhere";
    act(() => editing.result.current.changeFields({ notes: "Mine" }));
    await settle(pause);
    expect(editing.result.current.open?.hasConflict).toBe(true);
    expect(editing.result.current.open?.message?.text).toBe(
      "This project was changed on another device.",
    );

    act(() => editing.result.current.keepSavedVersion());
    await settle(pause);
    expect(editing.result.current.open?.hasConflict).toBe(false);
    expect(editing.result.current.open?.values.notes).toBe("Elsewhere");
    expect(stored(server, project.id)?.notes).toBe("Elsewhere");
  });

  it("lets the person keep their own version after a conflict", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    stored(server, project.id)!.notes = "Elsewhere";
    act(() => editing.result.current.changeFields({ notes: "Mine" }));
    await settle(pause);
    expect(editing.result.current.open?.hasConflict).toBe(true);

    act(() => editing.result.current.keepMine());
    await settle(pause);
    expect(editing.result.current.open?.hasConflict).toBe(false);
    expect(editing.result.current.open?.values.notes).toBe("Mine");
    expect(stored(server, project.id)?.notes).toBe("Mine");
  });

  it("adds a new project to the account once", async () => {
    const server = startServer();
    const editing = renderEditing(accountView);
    act(() => editing.result.current.openNewProject());
    act(() => editing.result.current.changeFields({ title: "Garden" }));
    await act(() => editing.result.current.createProject());
    const projects = [
      ...(server.projects.accounts.get(accountId)?.values() ?? []),
    ];
    expect(projects.map(({ title }) => title)).toEqual(["Garden"]);
    expect(editing.onCreated).toHaveBeenCalledTimes(1);
    expect(editing.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Garden" }),
    );
    expect(editing.source.showSavedProject).toHaveBeenCalled();
    expect(editing.result.current.open).toBeNull();
  });

  it("keeps the form and says why when adding fails", async () => {
    const server = startServer();
    const editing = renderEditing(accountView);
    act(() => editing.result.current.openNewProject());
    act(() => editing.result.current.changeFields({ title: "Garden" }));
    server.status = 503;
    await act(() => editing.result.current.createProject());
    expect(editing.result.current.open?.isLoading).toBe(false);
    expect(editing.result.current.open?.message?.text).toBe(
      "Not saved: Abodeo cannot reach your projects right now.",
    );
    expect(editing.onCreated).not.toHaveBeenCalled();
  });

  it("sends the pending edit, then closes the project, then bins it", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    const order: string[] = [];
    editing.onClosed.mockImplementation(() => order.push("closed"));
    act(() => editing.result.current.changeFields({ notes: "Tiles" }));
    act(() =>
      editing.result.current.startDelete({
        imageCount: 2,
        appointmentCount: null,
      }),
    );
    expect(editing.result.current.deletion).toMatchObject({
      mode: "bin",
      imageCount: 2,
    });
    server.calls.length = 0;
    await act(async () => {
      await editing.result.current.confirmDelete();
    });
    const methods = server.calls.map((call) => call.split(" ")[0]);
    expect(methods.indexOf("PATCH")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("PATCH")).toBeLessThan(methods.indexOf("DELETE"));
    expect(order).toEqual(["closed"]);
    expect(editing.result.current.open).toBeNull();
    expect(stored(server, project.id)).toBeUndefined();
    expect(server.projects.bins.get(accountId)?.has(project.id)).toBe(true);
    expect(editing.source.removeProject).toHaveBeenCalledWith(1, project.id);
    expect(editing.refreshBinCount).toHaveBeenCalledTimes(1);
    expect(editing.onDeleted).toHaveBeenCalledTimes(1);
  });

  it("waits for a task title being edited to be saved before closing and binning", async () => {
    const server = startServer();
    const task = makeTask("Buy tiles");
    const { editing, project } = await openAccount(
      server,
      makeProject({ tasks: [task] }),
    );
    const order: string[] = [];
    editing.onClosed.mockImplementation(() => order.push("closed"));
    // The title save is still on its way when deleting is confirmed.
    let finishTitleSave!: () => void;
    const titleSaved = new Promise<void>((resolve) => {
      finishTitleSave = resolve;
    });
    let isTitleBeingEdited = true;
    editing.result.current.finishTaskEditRef.current = async () => {
      // Closing asks again, as it does for any close.
      if (!isTitleBeingEdited) return null;
      isTitleBeingEdited = false;
      await titleSaved;
      const failure = await editing.result.current.changeTasks((tasks) =>
        tasks.map((each) => ({ ...each, title: "Buy grout" })),
      );
      order.push("title saved");
      return failure;
    };
    act(() =>
      editing.result.current.startDelete({
        imageCount: null,
        appointmentCount: null,
      }),
    );
    server.calls.length = 0;
    let deleting!: Promise<void>;
    act(() => {
      deleting = editing.result.current.confirmDelete();
    });
    await settle();
    // Nothing closes or is binned while the title is unsaved.
    expect(order).toEqual([]);
    expect(editing.onClosed).not.toHaveBeenCalled();
    expect(server.calls.some((call) => call.startsWith("DELETE"))).toBe(false);
    expect(stored(server, project.id)).toBeDefined();
    finishTitleSave();
    await act(async () => {
      await deleting;
    });
    expect(order).toEqual(["title saved", "closed"]);
    expect(server.calls.at(-1)?.startsWith("DELETE")).toBe(true);
    expect(stored(server, project.id)).toBeUndefined();
    expect(
      server.projects.bins.get(accountId)?.get(project.id)?.project.tasks[0]
        ?.title,
    ).toBe("Buy grout");
  });

  it("leaves the project and shows why when deleting fails", async () => {
    const server = startServer();
    const { editing, project } = await openAccount(server);
    act(() =>
      editing.result.current.startDelete({
        imageCount: null,
        appointmentCount: null,
      }),
    );
    server.status = 503;
    await act(async () => {
      await editing.result.current.confirmDelete();
    });
    expect(editing.result.current.deletion).toMatchObject({
      isBusy: false,
      message: "Not deleted: Abodeo cannot reach your projects right now.",
    });
    expect(stored(server, project.id)).toBeDefined();
    expect(editing.onDeleted).not.toHaveBeenCalled();
  });

  describe("changing tasks", () => {
    it("shows a task at once and keeps the saved tasks", async () => {
      const server = startServer();
      const { editing, project } = await openAccount(server);
      const task = makeTask("Buy tiles");
      let pending!: Promise<string | null>;
      act(() => {
        pending = editing.result.current.changeTasks((tasks) => [
          ...tasks,
          task,
        ]);
      });
      expect(editing.result.current.open?.values.tasks).toEqual([task]);
      let failure: string | null = "unset";
      await act(async () => {
        failure = await pending;
      });
      expect(failure).toBeNull();
      expect(stored(server, project.id)?.tasks).toEqual([task]);
      expect(editing.result.current.open?.values.tasks).toEqual([task]);
    });

    it("puts the tasks back as they were when saving fails", async () => {
      const server = startServer();
      const existing = makeTask("Measure");
      const { editing, project } = await openAccount(
        server,
        makeProject({ tasks: [existing] }),
      );
      server.status = 503;
      let pending!: Promise<string | null>;
      act(() => {
        pending = editing.result.current.changeTasks((tasks) => [
          ...tasks,
          makeTask("Buy tiles"),
        ]);
      });
      expect(editing.result.current.open?.values.tasks).toHaveLength(2);
      let failure: string | null = null;
      await act(async () => {
        failure = await pending;
      });
      expect(failure).toBe(
        "Not saved: Abodeo cannot reach your projects right now.",
      );
      expect(editing.result.current.open?.values.tasks).toEqual([existing]);
      expect(stored(server, project.id)?.tasks).toEqual([existing]);
    });

    it("does not alter another project when its save finishes after that one opened", async () => {
      const server = startServer();
      const first = makeProject({ title: "Kitchen" });
      const second = makeProject({
        title: "Garden",
        tasks: [makeTask("Mow lawn")],
      });
      seed(server, first, second);
      const editing = renderEditing(accountView);
      act(() => editing.result.current.openProject(first, 40, 0));
      await settle();

      let release!: () => void;
      server.gate = new Promise<void>((resolve) => (release = resolve));
      let pending!: Promise<string | null>;
      act(() => {
        pending = editing.result.current.changeTasks((tasks) => [
          ...tasks,
          makeTask("Buy tiles"),
        ]);
      });
      act(() => editing.result.current.openProject(second, 40, 1));
      expect(editing.result.current.open?.id).toBe(second.id);

      server.gate = null;
      release();
      await act(async () => {
        await pending;
      });
      await settle();
      expect(editing.result.current.open?.id).toBe(second.id);
      expect(editing.result.current.open?.values.tasks).toEqual(second.tasks);
      expect(stored(server, first.id)?.tasks).toHaveLength(1);
    });
  });

  describe("leaving", () => {
    it("asks about nothing and returns true when there is nothing to lose", async () => {
      const server = startServer();
      const { editing } = await openAccount(server);
      const confirm = vi.spyOn(window, "confirm");
      let leave = false;
      await act(async () => {
        leave = await editing.result.current.prepareToLeave();
      });
      expect(leave).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("lists a blank title and task text typed but not added", async () => {
      const server = startServer();
      const { editing } = await openAccount(server);
      act(() => editing.result.current.changeFields({ title: "" }));
      editing.taskDrafts.keepText("any", "Buy tiles");
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      let leave = false;
      await act(async () => {
        leave = await editing.result.current.prepareToLeave();
      });
      expect(leave).toBe(true);
      const message = confirm.mock.calls[0][0] as string;
      expect(message).toContain("the project's title, which is blank");
      expect(message).toContain("tasks typed but not yet added");
    });

    it("lists a new project that has not been added yet", async () => {
      startServer();
      const editing = renderEditing(accountView);
      act(() => editing.result.current.openNewProject());
      act(() => editing.result.current.changeFields({ title: "Garden" }));
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      let leave = true;
      await act(async () => {
        leave = await editing.result.current.prepareToLeave();
      });
      expect(leave).toBe(false);
      expect(confirm.mock.calls[0][0]).toContain(
        "the new project, which has not been added yet",
      );
    });

    it("counts a save on its way, and not the browser's warning once leaving", async () => {
      const server = startServer();
      const { editing } = await openAccount(server);
      let release!: () => void;
      server.gate = new Promise<void>((resolve) => (release = resolve));
      let sending!: Promise<unknown>;
      act(() => {
        sending = editing.result.current.trackSending(
          new Promise((resolve) => setTimeout(resolve, 10)),
        );
      });
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      act(() => editing.result.current.markLeaving());
      const second = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(second);
      expect(second.defaultPrevented).toBe(false);
      release();
      await settle(20);
      await sending;
    });
  });
});
