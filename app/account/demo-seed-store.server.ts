// The demo seed (AD #138 Demo Entry And Seed), in the demo_seed table of
// db/demo-seed.sql: one row holding the demo account's projects and people as
// Robin last saved them. Saving replaces the row.
import { readAccountPeople } from "../projects/people-store.server";
import { serialisePeople } from "../projects/people";
import {
  inTransaction,
  type TransactionalDatabase,
} from "../projects/transaction.server";
import type { SeedSaveResponse } from "./account-api";
import { demoAccountEmail } from "./demo-sign-in.server";

export type DemoSeedStore = {
  // Whether the account is the demo account.
  isDemoAccount(userId: string): Promise<boolean>;
  // When the seed was saved, or null if none has been.
  readSavedAt(): Promise<Date | null>;
  // Saves the account's projects (not in the Bin) and people as the seed,
  // replacing any earlier seed.
  save(userId: string): Promise<SeedSaveResponse>;
};

export function createDemoSeedStore(
  database: TransactionalDatabase,
): DemoSeedStore {
  return {
    async isDemoAccount(userId) {
      const { rows } = await database.query(
        "select 1 from auth_user where id = $1 and email = $2",
        [userId, demoAccountEmail],
      );
      return rows.length > 0;
    },

    async readSavedAt() {
      const { rows } = await database.query(
        "select saved_at from demo_seed",
        [],
      );
      return rows.length > 0 ? new Date(String(rows[0].saved_at)) : null;
    },

    save: (userId) =>
      inTransaction(database, async (client) => {
        const { rows } = await client.query(
          `select id, data from project
           where user_id = $1 and deleted_at is null order by id`,
          [userId],
        );
        const projects = rows.map(({ id, data }) => ({ id, data }));
        const people = JSON.parse(
          serialisePeople(await readAccountPeople(client, userId)),
        );
        const saved = await client.query(
          `insert into demo_seed (id, projects, people)
           values (true, $1::jsonb, $2::jsonb)
           on conflict (id) do update
           set projects = excluded.projects, people = excluded.people,
               saved_at = now()
           returning saved_at`,
          [JSON.stringify(projects), JSON.stringify(people)],
        );
        return {
          savedAt: new Date(String(saved.rows[0].saved_at)).toISOString(),
          projectCount: projects.length,
          peopleCount: people.people.length,
        };
      }),
  };
}
