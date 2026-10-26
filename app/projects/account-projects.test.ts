import { afterEach, describe, expect, it, vi } from "vitest";

import {
  binAccountProject,
  deleteAccountProjectPermanently,
  keepaliveLimit,
  loadAccountBin,
  loadAccountProjects,
  openAccountProject,
  restoreAccountProject,
  setPageLeaving,
} from "./account-projects";
import { handleProjectsRequest } from "./project-handler.server";
import type { Project } from "./projects";
import { moveTask, setTaskDone, renameTask, type Task } from "./tasks";
import { createMemoryProjectStore } from "./test-projects.server";

afterEach(() => {
  setPageLeaving(false);
});

const tasks: Task[] = [
  { id: "a", title: "Tiles", isDone: false },
  { id: "b", title: "Grout", isDone: false },
  { id: "c", title: "Seal", isDone: false },
];

const project: Project = {
  id: "p1",
  title: "Bathroom",
  notes: "",
  assignee: "andy",
  dueDate: null,
  tasks,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

// The real endpoints over a memory store, for the account "ada", with each
// request's body recorded. A request can be held until released.
async function createServer() {
  const memory = createMemoryProjectStore();
  await memory.store.create("ada", "p1", project);
  const sent: { init: RequestInit; body: unknown }[] = [];
  let hold: Promise<void> | null = null;
  const fetchFn = vi.fn(async (path: string, init: RequestInit = {}) => {
    sent.push({ init, body: init.body ? JSON.parse(String(init.body)) : null });
    if (hold) await hold;
    return handleProjectsRequest(
      new Request(`http://localhost${path}`, {
        method: init.method,
        headers: init.headers,
        body: init.body,
      }),
      {
        readSessionUserId: async () => "ada",
        store: memory.store,
        reportFailure: () => {},
        defaultIds: [],
      },
    );
  }) as unknown as typeof fetch;
  const saved = () => memory.accounts.get("ada")!.get("p1")!;
  const changeElsewhere = (changes: Partial<Project>) =>
    memory.accounts.get("ada")!.set("p1", { ...saved(), ...changes });
  const holdRequests = () => {
    let release = () => {};
    hold = new Promise((resolve) => (release = resolve));
    return () => {
      hold = null;
      release();
    };
  };
  return { fetchFn, sent, saved, changeElsewhere, holdRequests };
}

describe("an opened account project", () => {
  it("sends saves one at a time, in order, each based on the last answer", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    const release = server.holdRequests();

    const first = opened.saveChanges({ title: "Bathroom tiles" });
    const second = opened.saveChanges({ title: "Bathroom, tiled" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.sent).toHaveLength(1);
    release();

    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(server.sent.map(({ body }) => body)).toEqual([
      { base: { title: "Bathroom" }, changes: { title: "Bathroom tiles" } },
      {
        base: { title: "Bathroom tiles" },
        changes: { title: "Bathroom, tiled" },
      },
    ]);
    expect(server.saved().title).toBe("Bathroom, tiled");
  });

  it("refuses a field changed elsewhere, and does not send it again until a version is chosen", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    server.changeElsewhere({ title: "Theirs" });

    expect(await opened.saveChanges({ title: "Mine" })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(opened.readConflict()).toMatchObject({ fields: ["title"] });
    expect(await opened.saveChanges({ title: "Mine" })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(server.sent).toHaveLength(1);

    opened.keepMine();
    expect(await opened.saveChanges({ title: "Mine" })).toMatchObject({
      ok: true,
    });
    expect(server.saved().title).toBe("Mine");
  });

  it("gives the saved version of the fields in conflict when chosen", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    server.changeElsewhere({ title: "Theirs" });
    await opened.saveChanges({ title: "Mine" });

    expect(opened.takeSavedVersion()).toEqual({ title: "Theirs" });
    expect(opened.readConflict()).toBeNull();
    expect(
      await opened.saveChanges({ title: "Theirs, renamed" }),
    ).toMatchObject({ ok: true });
  });

  it("applies a task change again to tasks changed elsewhere, when they do not overlap", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    server.changeElsewhere({ tasks: renameTask(tasks, "c", "Seal twice") });

    const result = await opened.saveTasks((list) =>
      setTaskDone(list, "a", true),
    );

    expect(result).toMatchObject({ ok: true });
    expect(server.saved().tasks).toEqual([
      { id: "a", title: "Tiles", isDone: true },
      { id: "b", title: "Grout", isDone: false },
      { id: "c", title: "Seal twice", isDone: false },
    ]);
  });

  it("does not apply a task change that overlaps one made elsewhere, giving the saved tasks", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    const theirs = moveTask(tasks, "a", 2);
    server.changeElsewhere({ tasks: theirs });

    const result = await opened.saveTasks((list) => moveTask(list, "c", 0));

    expect(result).toEqual({
      ok: false,
      reason: "tasks-conflict",
      tasks: theirs,
    });
    expect(server.saved().tasks).toEqual(theirs);
  });

  it("loads the latest copy and bases later saves on it", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    server.changeElsewhere({ notes: "From another device" });

    expect(await opened.load()).toMatchObject({
      ok: true,
      project: { notes: "From another device" },
    });
    expect(await opened.saveChanges({ notes: "Mine" })).toMatchObject({
      ok: true,
    });
  });

  it("names the page's account on every request", async () => {
    const server = await createServer();
    await openAccountProject("ada", project, server.fetchFn).load();
    expect(server.sent[0].init.headers).toMatchObject({
      "X-Abodeo-Account": "ada",
    });
  });

  it("sends saves started as the page is left so that they can finish, if small enough", async () => {
    const server = await createServer();
    const opened = openAccountProject("ada", project, server.fetchFn);
    setPageLeaving(true);

    await opened.saveChanges({ notes: "Short" });
    await opened.saveChanges({ notes: "x".repeat(keepaliveLimit) });

    expect(server.sent.map(({ init }) => init.keepalive)).toEqual([
      true,
      false,
    ]);
  });

  it("says when the server cannot be reached", async () => {
    const opened = openAccountProject("ada", project, (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch);
    expect(await opened.saveChanges({ notes: "x" })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("deleting account projects (AD #62 Delete Projects)", () => {
  it("bins a project, finds it in the Bin, restores it and deletes it for good", async () => {
    const { fetchFn } = await createServer();
    expect(await loadAccountProjects("ada", fetchFn)).toMatchObject({
      ok: true,
      projects: [{ id: "p1" }],
    });

    expect(await binAccountProject("ada", "p1", fetchFn)).toEqual({ ok: true });
    expect(await loadAccountProjects("ada", fetchFn)).toMatchObject({
      projects: [],
    });
    const bin = await loadAccountBin("ada", fetchFn);
    expect(bin).toMatchObject({
      ok: true,
      projects: [{ project: { id: "p1" }, deletedAt: expect.any(String) }],
    });

    expect(await restoreAccountProject("ada", "p1", fetchFn)).toEqual({
      ok: true,
    });
    expect(await loadAccountProjects("ada", fetchFn)).toMatchObject({
      projects: [{ id: "p1" }],
    });

    await binAccountProject("ada", "p1", fetchFn);
    expect(await deleteAccountProjectPermanently("ada", "p1", fetchFn)).toEqual(
      {
        ok: true,
      },
    );
    expect(await loadAccountBin("ada", fetchFn)).toMatchObject({
      projects: [],
    });
  });

  it("counts a project already gone as deleted, but not as restored", async () => {
    const { fetchFn } = await createServer();
    expect(await binAccountProject("ada", "none", fetchFn)).toEqual({
      ok: true,
    });
    expect(
      await deleteAccountProjectPermanently("ada", "none", fetchFn),
    ).toEqual({ ok: true });
    expect(await restoreAccountProject("ada", "none", fetchFn)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("reports a server that cannot be reached", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await binAccountProject("ada", "p1", fetchFn)).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(await loadAccountBin("ada", fetchFn)).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});
