// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readDefaultProjects, type DefaultProjects } from "./default-projects";
import {
  buildCopyId,
  createProjectStore,
  type TransactionalDatabase,
} from "./project-store.server";
import { serialiseProject, type Project } from "./projects";

type Row = { user_id: string; id: string; data: unknown; revision: number };

// Stands in for Postgres, understanding only the store's own statements, and
// recording each one with its values.
function createFakeDatabase() {
  const projects: Row[] = [];
  const records = new Map<string, { hash: string; ids: string[] }>();
  const statements: { text: string; values: unknown[] }[] = [];
  // Runs just before a save's update, as another save landing in between.
  let beforeUpdate: (() => void) | null = null;
  let isFailing = false;

  const find = (userId: string, id: string) =>
    projects.find((row) => row.user_id === userId && row.id === id);

  const query = async (text: string, values: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    statements.push({ text: sql, values });
    if (isFailing) throw Object.assign(new Error("down"), { code: "57P01" });
    const [userId] = values as string[];
    if (/^(begin|commit|rollback|set local)/.test(sql)) return { rows: [] };
    if (sql.startsWith("select hash, ids from project_defaults_received")) {
      const record = records.get(userId);
      return { rows: record ? [{ ...record }] : [] };
    }
    if (sql.startsWith("insert into project_defaults_received")) {
      if (!records.has(userId)) records.set(userId, { hash: "", ids: [] });
      return { rows: [] };
    }
    if (sql.startsWith("update project_defaults_received")) {
      records.set(userId, {
        hash: values[1] as string,
        ids: JSON.parse(values[2] as string),
      });
      return { rows: [] };
    }
    if (sql.startsWith("insert into project ")) {
      const entries = JSON.parse(values[1] as string) as {
        id: string;
        data: unknown;
      }[];
      const overwrite = sql.includes("do update");
      const rows = [];
      for (const { id, data } of entries) {
        const existing = find(userId, id);
        if (!existing) {
          projects.push({ user_id: userId, id, data, revision: 1 });
          rows.push({ id });
        } else if (overwrite) {
          existing.data = data;
          existing.revision++;
          rows.push({ id });
        }
      }
      return { rows };
    }
    if (
      sql.startsWith(
        "select id, data from project where user_id = $1 and id in",
      )
    ) {
      const ids = JSON.parse(values[1] as string) as string[];
      return {
        rows: projects
          .filter((row) => row.user_id === userId && ids.includes(row.id))
          .map(({ id, data }) => ({ id, data })),
      };
    }
    if (sql.startsWith("delete from project")) {
      const ids = JSON.parse(values[1] as string) as string[];
      for (const id of ids) {
        const index = projects.indexOf(find(userId, id)!);
        if (index >= 0) projects.splice(index, 1);
      }
      return { rows: [] };
    }
    if (sql === "select id, data from project where user_id = $1") {
      return {
        rows: projects
          .filter((row) => row.user_id === userId)
          .map(({ id, data }) => ({ id, data })),
      };
    }
    if (sql.startsWith("select data from project")) {
      const row = find(userId, values[1] as string);
      return { rows: row ? [{ data: row.data }] : [] };
    }
    if (sql.startsWith("select data, revision from project")) {
      const row = find(userId, values[1] as string);
      return {
        rows: row ? [{ data: row.data, revision: String(row.revision) }] : [],
      };
    }
    if (sql.startsWith("update project set data")) {
      beforeUpdate?.();
      beforeUpdate = null;
      const row = find(userId, values[1] as string);
      if (!row || String(row.revision) !== values[3]) return { rows: [] };
      row.data = JSON.parse(values[2] as string);
      row.revision++;
      return { rows: [{ id: row.id }] };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  };

  let released = 0;
  const database: TransactionalDatabase = {
    query,
    connect: async () => ({ query, release: () => void released++ }),
  };
  return {
    database,
    projects,
    records,
    statements,
    released: () => released,
    setBeforeUpdate: (work: () => void) => (beforeUpdate = work),
    fail: () => (isFailing = true),
  };
}

const project = (id: string, title: string, overrides: Partial<Project> = {}) =>
  ({
    id,
    title,
    notes: "",
    assignee: "unassigned",
    dueDate: null,
    tasks: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  }) satisfies Project;

const savedForm = (value: Project) => JSON.parse(serialiseProject(value));

function makeDefaults(projects: Project[]): DefaultProjects {
  return readDefaultProjects({
    projects: projects.map((value) => ({ id: value.id, ...savedForm(value) })),
  })!;
}

const now = () => "2026-10-22T00:00:00.000Z";

describe("the project store", () => {
  it("only ever reads and changes rows of the account it is given", async () => {
    const fake = createFakeDatabase();
    const store = createProjectStore(fake.database, { defaults: null, now });
    await store.create("ada", "p1", project("p1", "Ada's"));
    await store.create("bob", "p1", project("p1", "Bob's"));

    expect((await store.list("ada")).projects.map((p) => p.title)).toEqual([
      "Ada's",
    ]);
    expect(
      await store.saveChanges("bob", "p1", { title: "Bob's" }, { title: "B" }),
    ).toMatchObject({ kind: "saved" });
    expect(await store.read("ada", "p1")).toMatchObject({
      project: { title: "Ada's" },
    });
    for (const { text, values } of fake.statements) {
      if (/^(begin|commit|rollback|set local)/.test(text)) continue;
      expect(text).toMatch(/user_id = \$1|select \$1/);
      expect(["ada", "bob"]).toContain(values[0]);
    }
  });

  it("gives the project already made when a create is sent again", async () => {
    const fake = createFakeDatabase();
    const store = createProjectStore(fake.database, { defaults: null, now });
    await store.create("ada", "p1", project("p1", "First"));
    const again = await store.create("ada", "p1", project("p1", "Second"));
    expect(again).toMatchObject({ kind: "found", project: { title: "First" } });
    expect(fake.projects).toHaveLength(1);
  });

  it("refuses a field changed since the save's base, giving the saved project", async () => {
    const fake = createFakeDatabase();
    const store = createProjectStore(fake.database, { defaults: null, now });
    await store.create("ada", "p1", project("p1", "Paint"));
    await store.saveChanges(
      "ada",
      "p1",
      { title: "Paint" },
      { title: "Paint it" },
    );

    const outcome = await store.saveChanges(
      "ada",
      "p1",
      { title: "Paint", notes: "" },
      { title: "Paint the shed", notes: "Green" },
    );

    expect(outcome).toMatchObject({
      kind: "conflict",
      fields: ["title"],
      project: { title: "Paint it", notes: "" },
    });
  });

  it("keeps a field changed elsewhere when saving another", async () => {
    const fake = createFakeDatabase();
    const store = createProjectStore(fake.database, { defaults: null, now });
    await store.create("ada", "p1", project("p1", "Paint"));
    await store.saveChanges(
      "ada",
      "p1",
      { title: "Paint" },
      { title: "Paint it" },
    );

    const outcome = await store.saveChanges(
      "ada",
      "p1",
      { notes: "" },
      { notes: "Green" },
    );

    expect(outcome).toMatchObject({
      kind: "saved",
      project: { title: "Paint it", notes: "Green" },
    });
  });

  it("reads again when another save lands between its read and its write", async () => {
    const fake = createFakeDatabase();
    const store = createProjectStore(fake.database, { defaults: null, now });
    await store.create("ada", "p1", project("p1", "Paint"));
    fake.setBeforeUpdate(() => {
      const row = fake.projects[0];
      row.data = { ...(row.data as object), title: "Changed between" };
      row.revision++;
    });

    const outcome = await store.saveChanges(
      "ada",
      "p1",
      { title: "Paint" },
      { title: "Mine" },
    );

    // The second read finds the title changed, so it is refused.
    expect(outcome).toMatchObject({ kind: "conflict", fields: ["title"] });
    expect(fake.projects[0].data).toMatchObject({ title: "Changed between" });
  });

  it("never overwrites a project this version cannot read", async () => {
    const fake = createFakeDatabase();
    const store = createProjectStore(fake.database, { defaults: null, now });
    fake.projects.push({
      user_id: "ada",
      id: "p1",
      data: { version: 99, title: "From the future" },
      revision: 1,
    });

    expect(
      await store.saveChanges("ada", "p1", { notes: "" }, { notes: "x" }),
    ).toEqual({ kind: "unreadable" });
    expect((await store.list("ada")).unreadableCount).toBe(1);
    expect(fake.projects[0].data).toEqual({
      version: 99,
      title: "From the future",
    });
  });

  describe("moving a browser's projects in", () => {
    it("moves each project once, however often it is sent", async () => {
      const fake = createFakeDatabase();
      const store = createProjectStore(fake.database, { defaults: null, now });
      const sent = [project("p1", "Shed"), project("p2", "Fence")];

      expect(await store.importProjects("ada", sent)).toEqual({
        p1: "moved",
        p2: "moved",
      });
      expect(await store.importProjects("ada", sent)).toEqual({
        p1: "already-moved",
        p2: "already-moved",
      });
      expect(fake.projects).toHaveLength(2);
    });

    it("adds a copy when the account's project differs, and only one copy", async () => {
      const fake = createFakeDatabase();
      const store = createProjectStore(fake.database, { defaults: null, now });
      await store.importProjects("ada", [project("p1", "Shed")]);
      const changed = project("p1", "Shed, painted");

      expect(await store.importProjects("ada", [changed])).toEqual({
        p1: "moved-as-copy",
      });
      // The copy is edited in the account, then the same browser copy is
      // sent again, as after a lost answer.
      const copy = fake.projects.find(
        (row) => row.id === buildCopyId(changed),
      )!;
      copy.data = { ...(copy.data as object), notes: "Edited since" };
      expect(await store.importProjects("ada", [changed])).toEqual({
        p1: "already-moved",
      });
      expect(fake.projects.map((row) => row.id)).toEqual([
        "p1",
        buildCopyId(changed),
      ]);
    });
  });

  describe("default projects", () => {
    it("are received once, and not again while they are unchanged", async () => {
      const fake = createFakeDatabase();
      const defaults = makeDefaults([project("d1", "Welcome")]);
      const store = createProjectStore(fake.database, { defaults, now });

      const first = await store.list("ada");
      expect(first.projects.map((p) => p.id)).toEqual(["d1"]);
      expect(first.defaultIds).toEqual(["d1"]);
      expect(fake.released()).toBe(1);

      const count = fake.statements.length;
      await store.list("ada");
      expect(fake.statements.slice(count).map(({ text }) => text)).toEqual([
        "select hash, ids from project_defaults_received where user_id = $1",
        "select id, data from project where user_id = $1",
      ]);
      expect(fake.released()).toBe(1);
    });

    it("replace edits and remove defaults the app no longer has, leaving the account's own", async () => {
      const fake = createFakeDatabase();
      const old = makeDefaults([
        project("d1", "Welcome"),
        project("d2", "Old"),
      ]);
      await createProjectStore(fake.database, { defaults: old, now }).list(
        "ada",
      );
      const store = createProjectStore(fake.database, {
        defaults: makeDefaults([project("d1", "Welcome back")]),
        now,
      });
      await store.saveChanges("ada", "d1", { notes: "" }, { notes: "Edited" });
      await store.create("ada", "mine", project("mine", "Mine"));
      // Received by another version of the app, so the record's hash differs.
      fake.records.set("ada", { hash: "other", ids: ["d1", "d2"] });

      const listed = await store.list("ada");

      expect(listed.projects.map((p) => [p.id, p.title, p.notes])).toEqual([
        ["d1", "Welcome back", ""],
        ["mine", "Mine", ""],
      ]);
    });

    it("never touch a default this version cannot read", async () => {
      const fake = createFakeDatabase();
      fake.projects.push({
        user_id: "ada",
        id: "d1",
        data: { version: 99 },
        revision: 1,
      });
      const store = createProjectStore(fake.database, {
        defaults: makeDefaults([project("d1", "Welcome")]),
        now,
      });

      const listed = await store.list("ada");

      expect(fake.projects[0].data).toEqual({ version: 99 });
      expect(listed.defaultIds).toEqual(["d1"]);
    });

    it("roll back and let the connection go when the database fails", async () => {
      const fake = createFakeDatabase();
      const store = createProjectStore(fake.database, {
        defaults: makeDefaults([project("d1", "Welcome")]),
        now,
      });
      const { query } = fake.database;
      const sent: string[] = [];
      let released = false;
      fake.database.connect = async () => ({
        query: async (text, values) => {
          sent.push(text);
          if (text.includes("for update")) throw new Error("lock timeout");
          return query(text, values);
        },
        release: () => (released = true),
      });

      await expect(store.list("ada")).rejects.toThrow("lock timeout");
      expect(sent.at(-1)).toBe("rollback");
      expect(released).toBe(true);
    });
  });
});
