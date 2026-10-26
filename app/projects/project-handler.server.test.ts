// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { handleProjectsRequest } from "./project-handler.server";
import { serialiseProject, type Project } from "./projects";
import { accountHeader } from "./projects-api";
import { createMemoryProjectStore } from "./test-projects.server";

const baseUrl = "http://localhost:5173";

// The session cookie is simply the account's id.
const readSessionUserId = async (headers: Headers) =>
  headers.get("cookie") ?? undefined;

function createHandler(
  overrides: Partial<Parameters<typeof handleProjectsRequest>[1]> = {},
) {
  const memory = createMemoryProjectStore();
  const handle = (request: Request) =>
    handleProjectsRequest(request, {
      readSessionUserId,
      store: memory.store,
      reportFailure: () => {},
      defaultIds: ["default-1"],
      ...overrides,
    });
  return { ...memory, handle };
}

function send(
  path: string,
  {
    account = "ada",
    pageAccount = account,
    method = "GET",
    body,
    contentType = "application/json",
  }: {
    account?: string | null;
    pageAccount?: string | null;
    method?: string;
    body?: unknown;
    contentType?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (account) headers.cookie = account;
  if (pageAccount) headers[accountHeader] = pageAccount;
  if (body !== undefined) headers["Content-Type"] = contentType;
  return new Request(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const fields = {
  title: "Paint the shed",
  notes: "",
  assignee: "andy",
  dueDate: null,
  tasks: [],
};

async function create(
  handle: (request: Request) => Promise<Response>,
  account: string,
  id: string,
  title = fields.title,
) {
  return handle(
    send("/api/projects", {
      account,
      method: "POST",
      body: { id, fields: { ...fields, title } },
    }),
  );
}

describe("the projects endpoints", () => {
  it("refuse a request without a valid sign-in", async () => {
    const { handle, calls } = createHandler();
    const response = await handle(
      send("/api/projects", { account: null, pageAccount: "ada" }),
    );
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuse a request from a page working for another account", async () => {
    const { handle, calls } = createHandler();
    const response = await handle(
      send("/api/projects", { account: "ada", pageAccount: "bob" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "account_changed" });
    expect(calls).toEqual([]);
  });

  it("refuse a request that does not name the page's account", async () => {
    const { handle } = createHandler();
    const response = await handle(send("/api/projects", { pageAccount: null }));
    expect(response.status).toBe(400);
  });

  it("use only the signed-in account, ignoring any account in the body", async () => {
    const { handle, accounts } = createHandler();
    await handle(
      send("/api/projects", {
        method: "POST",
        body: { id: "p1", userId: "bob", fields: { ...fields, userId: "bob" } },
      }),
    );
    expect([...accounts.keys()]).toEqual(["ada"]);
    expect(accounts.get("ada")!.get("p1")).not.toHaveProperty("userId");
  });

  it("never let one account read or change another's project", async () => {
    const { handle, accounts } = createHandler();
    await create(handle, "ada", "p1");

    expect(
      (await handle(send("/api/projects/p1", { account: "bob" }))).status,
    ).toBe(404);
    const save = await handle(
      send("/api/projects/p1", {
        account: "bob",
        method: "PATCH",
        body: { base: { title: fields.title }, changes: { title: "Bob's" } },
      }),
    );
    expect(save.status).toBe(404);
    const list = await handle(send("/api/projects", { account: "bob" }));
    expect((await list.json()).projects).toEqual([]);
    expect(accounts.get("ada")!.get("p1")!.title).toBe(fields.title);
  });

  it("answer a save based on an out-of-date field with the saved project", async () => {
    const { handle } = createHandler();
    await create(handle, "ada", "p1");
    const change = (base: string, title: string) =>
      handle(
        send("/api/projects/p1", {
          method: "PATCH",
          body: { base: { title: base }, changes: { title } },
        }),
      );
    expect((await change(fields.title, "Newer")).status).toBe(200);

    const response = await change(fields.title, "Older device");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "conflict",
      fields: ["title"],
      project: { title: "Newer" },
    });
  });

  it("merge changes to different fields made elsewhere", async () => {
    const { handle } = createHandler();
    await create(handle, "ada", "p1");
    await handle(
      send("/api/projects/p1", {
        method: "PATCH",
        body: { base: { notes: "" }, changes: { notes: "Green" } },
      }),
    );
    const response = await handle(
      send("/api/projects/p1", {
        method: "PATCH",
        body: { base: { title: fields.title }, changes: { title: "Fence" } },
      }),
    );
    expect(await response.json()).toMatchObject({
      project: { title: "Fence", notes: "Green" },
    });
  });

  it("need a JSON body for changes", async () => {
    const { handle } = createHandler();
    const response = await handle(
      send("/api/projects", {
        method: "POST",
        body: { id: "p1", fields },
        contentType: "text/plain",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuse a body that is too large", async () => {
    const { handle } = createHandler();
    const response = await handle(
      send("/api/projects", {
        method: "POST",
        body: { id: "p1", fields: { ...fields, notes: "x".repeat(300_000) } },
      }),
    );
    expect(response.status).toBe(413);
  });

  it("refuse invalid values and default project ids", async () => {
    const { handle } = createHandler();
    expect((await create(handle, "ada", "p1", " ")).status).toBe(400);
    expect((await create(handle, "ada", "default-1")).status).toBe(400);
    const imported = await handle(
      send("/api/projects/import", {
        method: "POST",
        body: {
          projects: [
            {
              id: "default-1",
              ...JSON.parse(serialiseProject(project("default-1"))),
            },
          ],
        },
      }),
    );
    expect(imported.status).toBe(400);
  });

  it("move a browser's projects into the account", async () => {
    const { handle, accounts } = createHandler();
    const body = {
      projects: [{ id: "p1", ...JSON.parse(serialiseProject(project("p1"))) }],
    };
    const first = await handle(
      send("/api/projects/import", { method: "POST", body }),
    );
    expect(await first.json()).toEqual({ outcomes: { p1: "moved" } });
    const again = await handle(
      send("/api/projects/import", { method: "POST", body }),
    );
    expect(await again.json()).toEqual({ outcomes: { p1: "already-moved" } });
    expect(accounts.get("ada")!.size).toBe(1);
  });

  it("say the store is unavailable when it fails or does not answer", async () => {
    vi.useFakeTimers();
    try {
      const { store } = createMemoryProjectStore();
      const failing = createHandler({
        store: {
          ...store,
          list: async () => Promise.reject(new Error("down")),
        },
      });
      expect((await failing.handle(send("/api/projects"))).status).toBe(503);

      const hanging = createHandler({
        store: { ...store, list: () => new Promise(() => {}) },
        timeout: 1000,
      });
      const response = hanging.handle(send("/api/projects"));
      await vi.advanceTimersByTimeAsync(1000);
      expect((await response).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answer without letting the browser keep a copy", async () => {
    const { handle } = createHandler();
    const response = await handle(send("/api/projects"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("naming someone in a project request (AD #61)", () => {
  const refusing = {
    create: async () => ({ kind: "unknown-assignee" as const }),
    saveChanges: async () => ({ kind: "unknown-assignee" as const }),
  };

  it("answers a create or a save naming someone not in the list with unknown_assignee", async () => {
    const memory = createMemoryProjectStore();
    const { handle } = createHandler({
      store: { ...memory.store, ...refusing },
    });
    const created = await create(handle, "ada", "p1");
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: "unknown_assignee" });
    const saved = await handle(
      send("/api/projects/p1", {
        method: "PATCH",
        body: {
          base: { assignee: "unassigned" },
          changes: { assignee: "zed" },
        },
      }),
    );
    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({ error: "unknown_assignee" });
  });

  it("passes the browser's people on with an import", async () => {
    const memory = createMemoryProjectStore();
    const importProjects = vi.fn(memory.store.importProjects);
    const { handle } = createHandler({
      store: { ...memory.store, importProjects },
    });
    const sent = { ...project("p1"), version: 3 };
    const people = [{ id: "x1", name: "Anders" }];
    const response = await handle(
      send("/api/projects/import", {
        method: "POST",
        body: { projects: [sent], people },
      }),
    );
    expect(response.status).toBe(200);
    expect(importProjects).toHaveBeenCalledWith(
      "ada",
      [expect.objectContaining({ id: "p1" })],
      people,
    );
  });

  it("imports without people when none are sent, and refuses invalid ones", async () => {
    const memory = createMemoryProjectStore();
    const importProjects = vi.fn(memory.store.importProjects);
    const { handle } = createHandler({
      store: { ...memory.store, importProjects },
    });
    const sent = { ...project("p1"), version: 3 };
    await handle(
      send("/api/projects/import", {
        method: "POST",
        body: { projects: [sent] },
      }),
    );
    expect(importProjects).toHaveBeenCalledWith(
      "ada",
      expect.any(Array),
      undefined,
    );
    for (const people of [
      "Anders",
      [{ id: "x1" }],
      [
        { id: "x1", name: "Anders" },
        { id: "x2", name: "anders" },
      ],
    ]) {
      const response = await handle(
        send("/api/projects/import", {
          method: "POST",
          body: { projects: [sent], people },
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(importProjects).toHaveBeenCalledTimes(1);
  });
});

function project(id: string): Project {
  return {
    ...fields,
    assignee: "andy",
    id,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("deleting projects (AD #62 Delete Projects)", () => {
  const json = (response: Response) => response.json();

  it("puts a project in the bin, lists it there, restores it, and deletes it for good", async () => {
    const { handle } = createHandler();
    await create(handle, "ada", "p1");

    const removed = await handle(
      send("/api/projects/p1", { method: "DELETE", body: {} }),
    );
    expect(removed.status).toBe(200);
    expect((await json(await handle(send("/api/projects")))).projects).toEqual(
      [],
    );
    const bin = await json(await handle(send("/api/projects/bin")));
    expect(
      bin.projects.map((entry: { project: Project }) => entry.project.id),
    ).toEqual(["p1"]);

    const restored = await handle(
      send("/api/projects/p1/restore", { method: "POST", body: {} }),
    );
    expect(restored.status).toBe(200);
    expect(
      (await json(await handle(send("/api/projects")))).projects,
    ).toHaveLength(1);

    await handle(send("/api/projects/p1", { method: "DELETE", body: {} }));
    const gone = await handle(
      send("/api/projects/p1/permanent", { method: "DELETE", body: {} }),
    );
    expect(gone.status).toBe(200);
    expect(
      (await json(await handle(send("/api/projects/bin")))).projects,
    ).toEqual([]);
  });

  it("answers not found for a project that is not there to delete, restore or delete for good", async () => {
    const { handle } = createHandler();
    for (const [path, method] of [
      ["/api/projects/none", "DELETE"],
      ["/api/projects/none/restore", "POST"],
      ["/api/projects/none/permanent", "DELETE"],
    ]) {
      const response = await handle(send(path, { method, body: {} }));
      expect(response.status).toBe(404);
    }
  });

  it("keeps each account's bin to itself", async () => {
    const { handle } = createHandler();
    await create(handle, "ada", "p1");
    await handle(send("/api/projects/p1", { method: "DELETE", body: {} }));

    expect(
      (await json(await handle(send("/api/projects/bin", { account: "bob" }))))
        .projects,
    ).toEqual([]);
    const response = await handle(
      send("/api/projects/p1/restore", {
        account: "bob",
        method: "POST",
        body: {},
      }),
    );
    expect(response.status).toBe(404);
  });

  it("refuses these without a sign-in, from another account's page, or the wrong method", async () => {
    const { handle } = createHandler();
    expect(
      (
        await handle(
          send("/api/projects/p1", {
            account: null,
            pageAccount: "ada",
            method: "DELETE",
            body: {},
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await handle(send("/api/projects/bin", { pageAccount: "bob" }))).status,
    ).toBe(409);
    expect(
      (await handle(send("/api/projects/p1/restore", { method: "GET" })))
        .status,
    ).toBe(405);
    expect(
      (await handle(send("/api/projects/bin", { method: "POST", body: {} })))
        .status,
    ).toBe(405);
    expect(
      (await handle(send("/api/projects/p1/other", { method: "GET" }))).status,
    ).toBe(404);
    expect(
      (
        await handle(
          send("/api/projects/p1", {
            method: "DELETE",
            contentType: "text/plain",
            body: {},
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("does not let a project be made with the id of the bin", async () => {
    const { handle } = createHandler();
    expect((await create(handle, "ada", "bin")).status).toBe(400);
  });
});
