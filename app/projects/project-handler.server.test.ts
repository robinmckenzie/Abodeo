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

function project(id: string): Project {
  return {
    ...fields,
    assignee: "andy",
    id,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}
