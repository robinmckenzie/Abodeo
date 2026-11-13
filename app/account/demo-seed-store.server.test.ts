// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createDemoSeedStore } from "./demo-seed-store.server";
import type { TransactionalDatabase } from "../projects/transaction.server";

// Stands in for Postgres, understanding only this store's statements.
function createFakeSeedDatabase() {
  const projectRows = [
    { id: "p1", data: { name: "Apples" } },
    { id: "p2", data: { name: "Bread" } },
  ];
  let seed: { projects: string; people: string; savedAt: string } | null = null;
  let saveCount = 0;
  const query = async (text: string, values: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    if (/^(begin|commit|rollback|set local)/.test(sql)) return { rows: [] };
    if (sql.startsWith("select 1 from auth_user")) {
      return { rows: values[0] === "demo-user" ? [{}] : [] };
    }
    if (sql.startsWith("select saved_at from demo_seed")) {
      return { rows: seed ? [{ saved_at: seed.savedAt }] : [] };
    }
    if (sql.startsWith("select id, data from project")) {
      expect(sql).toContain("deleted_at is null");
      return { rows: projectRows };
    }
    if (sql.includes("account_people")) return { rows: [] };
    if (sql.startsWith("insert into demo_seed")) {
      saveCount += 1;
      seed = {
        projects: values[0] as string,
        people: values[1] as string,
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
  return { database, projectRows, readSeed: () => seed };
}

describe("createDemoSeedStore", () => {
  it("knows the demo account by its id", async () => {
    const { database } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database);
    expect(await store.isDemoAccount("demo-user")).toBe(true);
    expect(await store.isDemoAccount("other")).toBe(false);
  });

  it("has no saved time until a seed is saved", async () => {
    const { database } = createFakeSeedDatabase();
    expect(await createDemoSeedStore(database).readSavedAt()).toBeNull();
  });

  it("saves the projects as stored, and the people", async () => {
    const { database, readSeed } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database);
    const saved = await store.save("demo-user");
    expect(saved).toMatchObject({ projectCount: 2, peopleCount: 0 });
    expect(JSON.parse(readSeed()!.projects)).toEqual([
      { id: "p1", data: { name: "Apples" } },
      { id: "p2", data: { name: "Bread" } },
    ]);
    expect(JSON.parse(readSeed()!.people).people).toEqual([]);
  });

  it("replaces the earlier seed on a second save", async () => {
    const { database, projectRows, readSeed } = createFakeSeedDatabase();
    const store = createDemoSeedStore(database);
    await store.save("demo-user");
    projectRows.pop();
    const second = await store.save("demo-user");
    expect(second.projectCount).toBe(1);
    expect(JSON.parse(readSeed()!.projects)).toHaveLength(1);
    expect((await store.readSavedAt())?.toISOString()).toBe(
      "2026-11-13T10:02:00.000Z",
    );
  });
});
