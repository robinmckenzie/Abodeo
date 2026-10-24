// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readDefaultProjects, type DefaultProjects } from "./default-projects";
import { buildCopyId, createProjectStore } from "./project-store.server";
import { createFakeDatabase } from "./test-database.server";
import { serialiseProject, type Project } from "./projects";

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

  describe("latest images", () => {
    it("are listed by project, for the account only", async () => {
      const fake = createFakeDatabase();
      fake.latestImages.push(
        { user_id: "ada", project_id: "p1", id: "i2" },
        { user_id: "bob", project_id: "p9", id: "i7" },
      );
      const store = createProjectStore(fake.database, { now });

      expect((await store.list("ada")).latestImageIds).toEqual({ p1: "i2" });
      expect((await store.list("cy")).latestImageIds).toEqual({});
    });

    it("are left out, not fatal, when the image tables are not installed", async () => {
      const fake = createFakeDatabase();
      fake.removeImageTable();
      const store = createProjectStore(fake.database, { now });

      expect((await store.list("ada")).latestImageIds).toEqual({});
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
        "select distinct on (project_id) project_id, id from project_image where user_id = $1 order by project_id, created_at desc, id desc",
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

  describe("who a project is assigned to (AD #61 Manage People)", () => {
    const saveList = (
      fake: ReturnType<typeof createFakeDatabase>,
      list: { id: string; name: string }[],
    ) =>
      fake.people.set("ada", {
        data: { version: 1, people: list },
        revision: 1,
      });
    const andy = { id: "andy", name: "Andy" };

    it("creates a project for someone in the account's list, holding the list", async () => {
      const fake = createFakeDatabase();
      saveList(fake, [andy]);
      const store = createProjectStore(fake.database, { defaults: null, now });
      expect(
        await store.create(
          "ada",
          "p1",
          project("p1", "Shed", { assignee: "andy" }),
        ),
      ).toMatchObject({ kind: "found", project: { assignee: "andy" } });
      expect(
        fake.statements.some(({ text }) =>
          text.includes("from account_people where user_id = $1 for share"),
        ),
      ).toBe(true);
      // Taken first, as the row may not exist yet.
      expect(
        fake.statements.some(({ text }) =>
          text.includes("pg_advisory_xact_lock"),
        ),
      ).toBe(true);
      expect(fake.released()).toBe(1);
    });

    it("refuses a create naming someone not in the list", async () => {
      const fake = createFakeDatabase();
      saveList(fake, [andy]);
      const store = createProjectStore(fake.database, { defaults: null, now });
      expect(
        await store.create(
          "ada",
          "p1",
          project("p1", "Shed", { assignee: "boris" }),
        ),
      ).toEqual({ kind: "unknown-assignee" });
      expect(fake.projects).toHaveLength(0);
    });

    it("counts the people an account's projects are assigned to while it has no list", async () => {
      const fake = createFakeDatabase();
      const store = createProjectStore(fake.database, { defaults: null, now });
      fake.projects.push({
        user_id: "ada",
        id: "old",
        data: savedForm(project("old", "Old", { assignee: "andy" })),
        revision: 1,
      });
      expect(
        await store.create(
          "ada",
          "p1",
          project("p1", "Shed", { assignee: "andy" }),
        ),
      ).toMatchObject({ kind: "found" });
      expect(
        await store.create(
          "ada",
          "p2",
          project("p2", "Fence", { assignee: "boris" }),
        ),
      ).toEqual({ kind: "unknown-assignee" });
    });

    it("refuses a save choosing someone removed, but not other saves", async () => {
      const fake = createFakeDatabase();
      saveList(fake, [andy]);
      const store = createProjectStore(fake.database, { defaults: null, now });
      await store.create("ada", "p1", project("p1", "Shed"));
      expect(
        await store.saveChanges(
          "ada",
          "p1",
          { assignee: "unassigned" },
          { assignee: "boris" },
        ),
      ).toEqual({ kind: "unknown-assignee" });
      expect(
        await store.saveChanges(
          "ada",
          "p1",
          { assignee: "unassigned" },
          { assignee: "andy" },
        ),
      ).toMatchObject({ kind: "saved", project: { assignee: "andy" } });
      // Someone removed since: the project is kept as it is until edited.
      fake.people.get("ada")!.data = { version: 1, people: [] };
      expect(
        await store.saveChanges("ada", "p1", { notes: "" }, { notes: "x" }),
      ).toMatchObject({ kind: "saved", project: { assignee: "andy" } });
    });

    it("drops a default project's person who is not in the list to Unassigned", async () => {
      const fake = createFakeDatabase();
      const defaults = makeDefaults([
        project("d1", "Default", { assignee: "andy" }),
      ]);
      const store = createProjectStore(fake.database, { defaults, now });
      const { projects } = await store.list("ada");
      expect(projects.map((p) => p.assignee)).toEqual(["unassigned"]);
    });

    describe("moving a browser's people in", () => {
      const sent = [
        project("p1", "Shed", { assignee: "x1" }),
        project("p2", "Fence", { assignee: "x2" }),
      ];
      const browser = [
        { id: "x1", name: "Anders" },
        { id: "x2", name: "Boris" },
      ];

      it("makes the browser's list the account's, carrying people by id", async () => {
        const fake = createFakeDatabase();
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        await store.importProjects("ada", sent, browser);
        expect(fake.people.get("ada")?.data).toEqual({
          version: 1,
          people: browser,
        });
        expect(
          fake.projects.map((row) => (row.data as Project).assignee),
        ).toEqual(["x1", "x2"]);
      });

      it("keeps the people the account's projects already use", async () => {
        const fake = createFakeDatabase();
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        fake.projects.push({
          user_id: "ada",
          id: "old",
          data: savedForm(project("old", "Old", { assignee: "andy" })),
          revision: 1,
        });
        await store.importProjects("ada", sent, browser);
        expect(
          (fake.people.get("ada")?.data as { people: unknown[] }).people,
        ).toEqual([...browser, andy]);
      });

      it("keeps an account project's person who has the browser person's name", async () => {
        const fake = createFakeDatabase();
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        fake.projects.push({
          user_id: "ada",
          id: "old",
          data: savedForm(project("old", "Old", { assignee: "andy" })),
          revision: 1,
        });
        await store.importProjects("ada", sent, [
          { id: "u1", name: "Andy" },
          { id: "x2", name: "Boris" },
        ]);
        expect(
          (fake.people.get("ada")?.data as { people: unknown[] }).people,
        ).toEqual([
          { id: "u1", name: "Andy" },
          { id: "x2", name: "Boris" },
        ]);
        expect(
          (fake.projects.find((row) => row.id === "old")?.data as Project)
            .assignee,
        ).toBe("u1");
      });

      it("follows swapped names once and leaves unreadable projects alone", async () => {
        const fake = createFakeDatabase();
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        for (const [id, assignee] of [
          ["a", "andy"],
          ["c", "clement"],
        ]) {
          fake.projects.push({
            user_id: "ada",
            id,
            data: savedForm(project(id, id, { assignee })),
            revision: 1,
          });
        }
        fake.projects.push({
          user_id: "ada",
          id: "future",
          data: { version: 999, assignee: "andy" },
          revision: 1,
        });
        await store.importProjects("ada", sent, [
          { id: "clement", name: "Andy" },
          { id: "boris", name: "Clement" },
        ]);
        const assignee = (id: string) =>
          (fake.projects.find((row) => row.id === id)?.data as Project)
            .assignee;
        expect(assignee("a")).toBe("clement");
        expect(assignee("c")).toBe("boris");
        expect(assignee("future")).toBe("andy");
      });

      it("matches people by name where the account has a list", async () => {
        const fake = createFakeDatabase();
        saveList(fake, [
          { id: "b9", name: "boris" },
          { id: "c9", name: "Cora" },
        ]);
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        await store.importProjects("ada", sent, browser);
        expect(
          fake.projects.map((row) => [row.id, (row.data as Project).assignee]),
        ).toEqual([
          ["p1", "unassigned"],
          ["p2", "b9"],
        ]);
        // People without a match are not added.
        expect(
          (fake.people.get("ada")?.data as { people: unknown[] }).people,
        ).toHaveLength(2);
      });

      it("finds what it made before when sent again after someone was renamed", async () => {
        const fake = createFakeDatabase();
        saveList(fake, [{ id: "b9", name: "Boris" }]);
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        await store.importProjects("ada", sent, browser);
        saveList(fake, [{ id: "b9", name: "Boris the Second" }]);
        expect(await store.importProjects("ada", sent, browser)).toEqual({
          p1: "already-moved",
          p2: "already-moved",
        });
        expect(fake.projects).toHaveLength(2);
      });

      it("assigns no one where no list was sent and the account has none", async () => {
        const fake = createFakeDatabase();
        const store = createProjectStore(fake.database, {
          defaults: null,
          now,
        });
        await store.importProjects("ada", sent);
        expect(fake.people.size).toBe(0);
        expect(
          fake.projects.map((row) => (row.data as Project).assignee),
        ).toEqual(["unassigned", "unassigned"]);
      });
    });
  });
});
