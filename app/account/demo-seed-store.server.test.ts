// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createDemoSeedStore,
  SeedPastDateError,
  SeedTooLargeError,
} from "./demo-seed-store.server";
import type { TransactionalDatabase } from "../projects/transaction.server";

// Tuesday 17 November 2026, 14:00 UTC.
const tuesday = () => Date.parse("2026-11-17T14:00:00Z");

// Stands in for Postgres, understanding only this store's statements.
function createFakeSeedDatabase() {
  const projectRows: { id: string; data: Record<string, unknown> }[] = [
    { id: "p1", data: { name: "Apples" } },
    { id: "p2", data: { name: "Bread" } },
  ];
  let insertedProjects = "";
  let seed: {
    projects: string;
    people: string;
    appointments: string;
    savedAt: string;
  } | null = null;
  let saveCount = 0;
  const imageSizes = { largest: 0, total: 0, count: 0 };
  let imageCopies = 0;
  const events: string[] = [];
  const statements: string[] = [];
  const query = async (text: string, values: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    if (/^(begin|commit|rollback|set local)/.test(sql)) return { rows: [] };
    if (sql.startsWith("select projects from demo_seed")) {
      return { rows: seed ? [{ projects: JSON.parse(seed.projects) }] : [] };
    }
    if (sql.startsWith("insert into project (user_id, id, data)")) {
      insertedProjects = values[1] as string;
    }
    if (
      /^(delete from project|insert into project|insert into account_people|select pg_advisory)/.test(
        sql,
      )
    ) {
      statements.push(sql.split(" (")[0].split(" select")[0]);
      return { rows: [] };
    }
    if (sql.startsWith("select 1 from auth_user")) {
      return { rows: values[0] === "demo-user" ? [{}] : [] };
    }
    if (sql.startsWith("select saved_at, jsonb_array_length(projects)")) {
      return {
        rows: seed
          ? [
              {
                saved_at: seed.savedAt,
                projects: JSON.parse(seed.projects).length,
                people: JSON.parse(seed.people).people.length,
                appointments: JSON.parse(seed.appointments).length,
                // Postgres gives a count as text.
                images: String(imageSizes.count),
              },
            ]
          : [],
      };
    }
    if (sql.startsWith("select id from project")) {
      expect(sql).toContain("deleted_at is null");
      return { rows: projectRows.map(({ id }) => ({ id })) };
    }
    if (sql.startsWith("select appointments from demo_seed")) {
      return {
        rows: seed ? [{ appointments: JSON.parse(seed.appointments) }] : [],
      };
    }
    if (sql.startsWith("select id, data from project")) {
      expect(sql).toContain("deleted_at is null");
      return { rows: projectRows };
    }
    if (sql.includes("max(i.original_size)")) {
      return { rows: [imageSizes] };
    }
    if (sql.startsWith("delete from demo_seed_image")) {
      events.push("delete images");
      return { rows: [] };
    }
    if (sql.startsWith("insert into demo_seed_image")) {
      expect(sql).toContain("p.deleted_at is null");
      imageCopies += 1;
      events.push("copy images");
      return { rows: [] };
    }
    if (sql.includes("account_people")) return { rows: [] };
    if (sql.startsWith("insert into demo_seed")) {
      saveCount += 1;
      seed = {
        projects: values[0] as string,
        people: values[1] as string,
        appointments: values[2] as string,
        savedAt: `2026-11-13T10:0${saveCount}:00.000Z`,
      };
      return { rows: [{ saved_at: seed.savedAt }] };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  };
  const database: TransactionalDatabase = {
    query,
    connect: async () => ({ query, release: () => {} }),
  };
  return {
    database,
    projectRows,
    imageSizes,
    events,
    statements,
    readSeed: () => seed,
    insertedProjects: () => JSON.parse(insertedProjects),
    imageCopies: () => imageCopies,
  };
}

describe("createDemoSeedStore", () => {
  it("knows the demo account by its id", async () => {
    const { database } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database);
    expect(await store.isDemoAccount("demo-user")).toBe(true);
    expect(await store.isDemoAccount("other")).toBe(false);
  });

  it("has no saved seed until one is saved", async () => {
    const { database } = createFakeSeedDatabase();
    expect(await createDemoSeedStore(database).readSaved()).toBeNull();
  });

  it("saves the projects as stored, and the people", async () => {
    const { database, readSeed } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database);
    const saved = await store.save("demo-user", []);
    expect(saved).toMatchObject({ projectCount: 2, peopleCount: 0 });
    expect(JSON.parse(readSeed()!.projects)).toEqual([
      { id: "p1", data: { name: "Apples" } },
      { id: "p2", data: { name: "Bread" } },
    ]);
    expect(JSON.parse(readSeed()!.people).people).toEqual([]);
  });

  it("saves the appointments with the seed, and reads them back", async () => {
    const { database } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database, tuesday);
    expect(await store.readAppointments()).toEqual([]);
    const appointments = [
      {
        projectId: "p1",
        event: {
          summary: "Fruit stall",
          description: "",
          start: { date: "2026-12-01" },
          end: { date: "2026-12-02" },
        },
      },
    ];
    const saved = await store.save("demo-user", appointments);
    expect(saved.appointmentCount).toBe(1);
    expect(await store.readAppointments()).toEqual([
      { ...appointments[0], rule: { weekday: 2, nth: 3 } },
    ]);
    expect(await store.readProjectIds("demo-user")).toEqual(["p1", "p2"]);
  });

  it("replaces the earlier seed on a second save", async () => {
    const { database, projectRows, readSeed } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database);
    await store.save("demo-user", []);
    projectRows.pop();
    const second = await store.save("demo-user", []);
    expect(second.projectCount).toBe(1);
    expect(JSON.parse(readSeed()!.projects)).toHaveLength(1);
    expect(await store.readSaved()).toEqual({
      savedAt: "2026-11-13T10:02:00.000Z",
      projectCount: 1,
      peopleCount: 0,
      imageCount: 0,
      appointmentCount: 0,
    });
  });

  it("replaces the seed's images with the account's, and counts them", async () => {
    const { database, imageSizes, events } = createFakeSeedDatabase();
    Object.assign(imageSizes, { largest: 500_000, total: 900_000, count: 3 });
    const saved = await createDemoSeedStore(database).save("demo-user", []);
    expect(saved.imageCount).toBe(3);
    expect(events).toEqual(["delete images", "copy images"]);
  });

  it("refuses an image over the limit, and saves nothing", async () => {
    const { database, imageSizes, readSeed, imageCopies } =
      createFakeSeedDatabase();
    Object.assign(imageSizes, { largest: 1024 * 1024 + 1, total: 2_000_000 });
    await expect(
      createDemoSeedStore(database).save("demo-user", []),
    ).rejects.toBeInstanceOf(SeedTooLargeError);
    expect(readSeed()).toBeNull();
    expect(imageCopies()).toBe(0);
  });

  it("refuses images that are too big together", async () => {
    const { database, imageSizes } = createFakeSeedDatabase();
    Object.assign(imageSizes, { largest: 900_000, total: 4 * 1024 * 1024 + 1 });
    await expect(
      createDemoSeedStore(database).save("demo-user", []),
    ).rejects.toBeInstanceOf(SeedTooLargeError);
  });

  describe("dates that move", () => {
    it("saves a due date as a weekday and a count, keeping the data", async () => {
      const { database, projectRows, readSeed } = createFakeSeedDatabase();
      projectRows[0].data = { name: "Brunch", dueDate: "2026-11-22" };
      await createDemoSeedStore(database, tuesday).save("demo-user", []);
      expect(JSON.parse(readSeed()!.projects)).toEqual([
        {
          id: "p1",
          data: { name: "Brunch", dueDate: "2026-11-22" },
          dueRule: { weekday: 0, nth: 1 },
        },
        { id: "p2", data: { name: "Bread" } },
      ]);
    });

    it("refuses a due date that has passed, saving nothing", async () => {
      const { database, projectRows, readSeed } = createFakeSeedDatabase();
      projectRows[0].data = { dueDate: "2026-11-16" };
      await expect(
        createDemoSeedStore(database, tuesday).save("demo-user", []),
      ).rejects.toBeInstanceOf(SeedPastDateError);
      expect(readSeed()).toBeNull();
    });

    it("refuses an appointment whose start has passed", async () => {
      const { database } = createFakeSeedDatabase();
      const past = {
        projectId: "p1",
        event: {
          summary: "Brunch",
          description: "",
          start: { dateTime: "2026-11-17T10:00:00Z" },
          end: { dateTime: "2026-11-17T11:00:00Z" },
        },
      };
      await expect(
        createDemoSeedStore(database, tuesday).save("demo-user", [past]),
      ).rejects.toBeInstanceOf(SeedPastDateError);
    });

    it("works the due date out again from the day of the reset", async () => {
      const { database, projectRows, insertedProjects } =
        createFakeSeedDatabase();
      projectRows[0].data = { name: "Brunch", dueDate: "2026-11-22" };
      await createDemoSeedStore(database, tuesday).save("demo-user", []);
      const thursday = () => Date.parse("2026-12-03T09:00:00Z");
      await createDemoSeedStore(database, thursday).reset("demo-user");
      expect(insertedProjects()).toEqual([
        { id: "p1", data: { name: "Brunch", dueDate: "2026-12-06" } },
        { id: "p2", data: { name: "Bread" } },
      ]);
    });
  });

  describe("reset", () => {
    it("changes nothing when no seed has been saved", async () => {
      const { database, statements } = createFakeSeedDatabase();
      expect(await createDemoSeedStore(database).reset("demo-user")).toBe(
        false,
      );
      expect(statements).toEqual([]);
    });

    it("replaces the account's projects, images and people with the seed", async () => {
      const { database, statements } = createFakeSeedDatabase();
      const store = createDemoSeedStore(database);
      await store.save("demo-user", []);
      statements.length = 0;
      expect(await store.reset("demo-user")).toBe(true);
      expect(statements[1]).toBe("delete from project where user_id = $1");
      expect(statements.slice(2)).toEqual([
        "insert into project",
        "insert into project_image",
        "insert into project_image_bytes",
        "insert into account_people",
      ]);
    });
  });
});
