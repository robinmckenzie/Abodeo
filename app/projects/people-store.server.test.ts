// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createPeopleStore } from "./people-store.server";
import { serialiseProject, type Project } from "./projects";
import { createFakeDatabase } from "./test-database.server";

const project = (id: string, overrides: Partial<Project> = {}) =>
  ({
    id,
    title: id,
    notes: "",
    assignee: "unassigned",
    dueDate: null,
    tasks: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  }) satisfies Project;

function setUp(assignees: Record<string, string> = {}) {
  const fake = createFakeDatabase();
  for (const [id, assignee] of Object.entries(assignees)) {
    fake.projects.push({
      user_id: "ada",
      id,
      data: JSON.parse(serialiseProject(project(id, { assignee }))),
      revision: 1,
    });
  }
  const store = createPeopleStore(fake.database);
  const assigneesOf = () =>
    Object.fromEntries(
      fake.projects.map((row) => [
        row.id,
        (row.data as { assignee: string }).assignee,
      ]),
    );
  return { fake, store, assigneesOf };
}

describe("the people store", () => {
  it("starts an account with no projects with an empty list, writing nothing on a read", async () => {
    const { fake, store } = setUp();
    expect(await store.read("ada")).toEqual({
      people: [],
      revision: 0,
      established: false,
    });
    expect(fake.people.size).toBe(0);
  });

  it("starts with whichever of Andy, Boris and Clement the projects use, in that order", async () => {
    const { fake, store } = setUp({ p1: "clement", p2: "andy", p3: "zed" });
    expect(await store.read("ada")).toEqual({
      people: [
        { id: "andy", name: "Andy" },
        { id: "clement", name: "Clement" },
      ],
      revision: 0,
      established: false,
    });
    expect(fake.people.size).toBe(0);
  });

  it("saves the list with the first change, which includes those starting people", async () => {
    const { fake, store } = setUp({ p1: "andy" });
    const outcome = await store.apply("ada", {
      op: "add",
      id: "new-1",
      name: "  Dora   Lee ",
    });
    expect(outcome).toEqual({
      kind: "done",
      people: [
        { id: "andy", name: "Andy" },
        { id: "new-1", name: "Dora Lee" },
      ],
      revision: 2,
    });
    expect(fake.people.get("ada")?.revision).toBe(2);
    expect(await store.read("ada")).toMatchObject({
      established: true,
      revision: 2,
    });
  });

  it("runs the preparation before reading, such as receiving the defaults", async () => {
    const fake = createFakeDatabase();
    const prepared: string[] = [];
    const store = createPeopleStore(fake.database, {
      prepare: async (userId) => void prepared.push(userId),
    });
    await store.read("ada");
    await store.apply("ada", { op: "establish" });
    expect(prepared).toEqual(["ada", "ada"]);
  });

  it("establishes an empty list, once", async () => {
    const { fake, store } = setUp();
    expect(await store.apply("ada", { op: "establish" })).toEqual({
      kind: "done",
      people: [],
      revision: 1,
    });
    expect(await store.apply("ada", { op: "establish" })).toMatchObject({
      revision: 1,
    });
    expect(fake.people.size).toBe(1);
  });

  it("adds a person once however often the add is sent", async () => {
    const { store } = setUp();
    const add = { op: "add", id: "new-1", name: "Dora" } as const;
    await store.apply("ada", add);
    const again = await store.apply("ada", add);
    expect(again).toEqual({
      kind: "done",
      people: [{ id: "new-1", name: "Dora" }],
      revision: 2,
    });
  });

  it("refuses names that are blank, too long or taken, whatever the case", async () => {
    const { store } = setUp();
    await store.apply("ada", { op: "add", id: "a", name: "Dora" });
    expect(await store.apply("ada", { op: "add", id: "b", name: " " })).toEqual(
      { kind: "invalid-name", problem: "blank" },
    );
    expect(
      await store.apply("ada", { op: "add", id: "b", name: "x".repeat(41) }),
    ).toEqual({ kind: "invalid-name", problem: "too-long" });
    expect(
      await store.apply("ada", { op: "add", id: "b", name: "DORA" }),
    ).toEqual({ kind: "duplicate" });
    expect(
      await store.apply("ada", { op: "add", id: "b", name: "unassigned" }),
    ).toEqual({ kind: "duplicate" });
  });

  it("renames without touching any project", async () => {
    const { fake, store, assigneesOf } = setUp({ p1: "andy" });
    await store.apply("ada", { op: "establish" });
    const outcome = await store.apply("ada", {
      op: "rename",
      id: "andy",
      name: "Anders",
    });
    expect(outcome).toMatchObject({
      kind: "done",
      people: [{ id: "andy", name: "Anders" }],
    });
    expect(assigneesOf()).toEqual({ p1: "andy" });
    expect(fake.people.get("ada")?.revision).toBe(2);
    expect(
      await store.apply("ada", { op: "rename", id: "nobody", name: "X" }),
    ).toEqual({ kind: "not-found" });
  });

  it("lets a person change the case of their own name", async () => {
    const { store } = setUp({ p1: "andy" });
    expect(
      await store.apply("ada", { op: "rename", id: "andy", name: "ANDY" }),
    ).toMatchObject({ kind: "done", people: [{ id: "andy", name: "ANDY" }] });
  });

  describe("removing", () => {
    it("counts the projects without changing anything", async () => {
      const { fake, store } = setUp({ p1: "andy", p2: "andy", p3: "boris" });
      fake.projects.push({
        user_id: "ada",
        id: "future",
        data: { version: 99, assignee: "andy" },
        revision: 1,
      });
      expect(
        await store.apply("ada", { op: "remove", id: "andy", dryRun: true }),
      ).toEqual({ kind: "preview", count: 2, unreadable: 1 });
      expect(fake.people.size).toBe(0);
    });

    it("sets only the readable projects assigned to them to Unassigned", async () => {
      const { fake, store, assigneesOf } = setUp({
        p1: "andy",
        p2: "andy",
        p3: "boris",
      });
      fake.projects.push({
        user_id: "ada",
        id: "future",
        data: { version: 99, assignee: "andy" },
        revision: 1,
      });
      const outcome = await store.apply("ada", {
        op: "remove",
        id: "andy",
        expectedCount: 2,
      });
      expect(outcome).toMatchObject({
        kind: "done",
        people: [{ id: "boris", name: "Boris" }],
      });
      expect(assigneesOf()).toEqual({
        p1: "unassigned",
        p2: "unassigned",
        p3: "boris",
        future: "andy",
      });
      // Unreadable projects are left exactly as they were.
      expect(fake.projects.at(-1)?.data).toEqual({
        version: 99,
        assignee: "andy",
      });
    });

    it("changes nothing when the count is no longer the one confirmed", async () => {
      const { store, assigneesOf } = setUp({ p1: "andy", p2: "andy" });
      await store.apply("ada", { op: "establish" });
      expect(
        await store.apply("ada", {
          op: "remove",
          id: "andy",
          expectedCount: 1,
        }),
      ).toEqual({ kind: "count-changed", count: 2, unreadable: 0 });
      expect(assigneesOf()).toEqual({ p1: "andy", p2: "andy" });
      expect(await store.read("ada")).toMatchObject({
        people: [{ id: "andy", name: "Andy" }],
      });
    });

    it("finds the person already removed when the removal is sent again", async () => {
      const { store } = setUp({ p1: "andy" });
      await store.apply("ada", { op: "remove", id: "andy" });
      expect(
        await store.apply("ada", {
          op: "remove",
          id: "andy",
          expectedCount: 1,
        }),
      ).toMatchObject({ kind: "done", people: [] });
    });

    it("holds the list until it is done", async () => {
      const { fake, store } = setUp({ p1: "andy" });
      await store.apply("ada", { op: "remove", id: "andy" });
      expect(
        fake.statements.some(({ text }) =>
          text.includes("from account_people where user_id = $1 for update"),
        ),
      ).toBe(true);
      expect(fake.released()).toBe(1);
    });
  });

  it("never changes a list it cannot read", async () => {
    const { fake, store } = setUp();
    fake.people.set("ada", { data: { version: 9, people: [] }, revision: 3 });
    expect(await store.read("ada")).toBe("unreadable");
    expect(
      await store.apply("ada", { op: "add", id: "a", name: "Dora" }),
    ).toEqual({ kind: "unreadable" });
    expect(fake.people.get("ada")).toEqual({
      data: { version: 9, people: [] },
      revision: 3,
    });
  });

  it("only reads and changes the account it is given", async () => {
    const { fake, store } = setUp();
    await store.apply("ada", { op: "add", id: "a", name: "Dora" });
    await store.apply("bob", { op: "add", id: "b", name: "Dora" });
    expect(await store.read("bob")).toMatchObject({
      people: [{ id: "b", name: "Dora" }],
    });
    for (const { text, values } of fake.statements) {
      if (/^(begin|commit|rollback|set local|select pg_advisory)/.test(text))
        continue;
      expect(text).toMatch(/user_id = \$1|values \(\$1/);
      expect(["ada", "bob"]).toContain(values[0]);
    }
  });
});
