import { describe, expect, it, vi } from "vitest";

import {
  addAccountPerson,
  countAccountAssignedProjects,
  establishAccountPeople,
  loadAccountPeople,
  removeAccountPerson,
  renameAccountPerson,
} from "./account-people";
import { handlePeopleRequest } from "./people-handler.server";
import { createPeopleStore } from "./people-store.server";
import { serialiseProject, type Project } from "./projects";
import { createFakeDatabase } from "./test-database.server";

// The real endpoints over the fake database, for the account "ada".
function createServer(assignees: Record<string, string> = {}) {
  const fake = createFakeDatabase();
  for (const [id, assignee] of Object.entries(assignees)) {
    const project: Project = {
      id,
      title: id,
      notes: "",
      assignee,
      dueDate: null,
      tasks: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    fake.projects.push({
      user_id: "ada",
      id,
      data: JSON.parse(serialiseProject(project)),
      revision: 1,
    });
  }
  const store = createPeopleStore(fake.database);
  const fetchFn = vi.fn(async (path: string, init: RequestInit = {}) =>
    handlePeopleRequest(
      new Request(`http://localhost${path}`, {
        method: init.method,
        headers: init.headers,
        body: init.body,
      }),
      {
        readSessionUserId: async () => "ada",
        store,
        reportFailure: () => {},
      },
    ),
  ) as unknown as typeof fetch;
  return { fake, fetchFn };
}

describe("an account's people", () => {
  it("loads the list, derived from the projects until one is saved", async () => {
    const { fetchFn } = createServer({ p1: "boris" });
    expect(await loadAccountPeople("ada", fetchFn)).toEqual({
      ok: true,
      people: [{ id: "boris", name: "Boris" }],
      revision: 0,
      established: false,
    });
  });

  it("says when the page is working for another account", async () => {
    const { fetchFn } = createServer();
    expect(await loadAccountPeople("bob", fetchFn)).toEqual({
      ok: false,
      reason: "account-changed",
    });
  });

  it("says when the server cannot be reached", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadAccountPeople("ada", fetchFn)).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("says when the saved list cannot be read", async () => {
    const { fake, fetchFn } = createServer();
    fake.people.set("ada", { data: { version: 9, people: [] }, revision: 1 });
    expect(await loadAccountPeople("ada", fetchFn)).toEqual({
      ok: false,
      reason: "list-unreadable",
    });
  });

  it("adds and renames, giving the list as saved", async () => {
    const { fetchFn } = createServer();
    expect(await addAccountPerson("ada", "d1", " Dora ", fetchFn)).toEqual({
      ok: true,
      people: [{ id: "d1", name: "Dora" }],
      revision: 2,
      established: true,
    });
    expect(
      await renameAccountPerson("ada", "d1", "Dorothy", fetchFn),
    ).toMatchObject({ ok: true, people: [{ id: "d1", name: "Dorothy" }] });
  });

  it("names what is wrong with a name", async () => {
    const { fetchFn } = createServer();
    await addAccountPerson("ada", "d1", "Dora", fetchFn);
    expect(await addAccountPerson("ada", "d2", " ", fetchFn)).toEqual({
      ok: false,
      reason: "blank",
    });
    expect(
      await addAccountPerson("ada", "d2", "x".repeat(41), fetchFn),
    ).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(await addAccountPerson("ada", "d2", "dora", fetchFn)).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(await renameAccountPerson("ada", "zed", "Zed", fetchFn)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("establishes the list", async () => {
    const { fake, fetchFn } = createServer();
    expect(await establishAccountPeople("ada", fetchFn)).toMatchObject({
      ok: true,
      established: true,
    });
    expect(fake.people.size).toBe(1);
  });

  it("counts the projects to be changed, then removes with that count", async () => {
    const { fetchFn } = createServer({ p1: "andy", p2: "andy" });
    expect(await countAccountAssignedProjects("ada", "andy", fetchFn)).toEqual({
      ok: true,
      count: 2,
      unreadable: 0,
    });
    expect(await removeAccountPerson("ada", "andy", 2, fetchFn)).toMatchObject({
      ok: true,
      people: [],
    });
  });

  it("is told the new count when it has changed", async () => {
    const { fake, fetchFn } = createServer({ p1: "andy" });
    await establishAccountPeople("ada", fetchFn);
    expect(await removeAccountPerson("ada", "andy", 0, fetchFn)).toEqual({
      ok: false,
      reason: "count-changed",
      count: 1,
      unreadable: 0,
    });
    expect(fake.people.get("ada")?.revision).toBe(1);
  });
});
