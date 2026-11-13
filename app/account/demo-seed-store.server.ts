// The demo seed (AD #138 Demo Entry And Seed), in the demo_seed table of
// db/demo-seed.sql: one row holding the demo account's projects and people as
// Robin last saved them. Saving replaces the row.
import { readAccountPeople } from "../projects/people-store.server";
import { serialisePeople } from "../projects/people";
import {
  inTransaction,
  type TransactionalDatabase,
} from "../projects/transaction.server";
import {
  maxSeedImageBytes,
  maxSeedTotalBytes,
  type SeedSaveResponse,
} from "./account-api";
import { demoAccountEmail } from "./demo-sign-in.server";

// The images are too big to keep in the seed. Nothing was saved.
export class SeedTooLargeError extends Error {
  readonly code = "seed_too_large";
}

export type DemoSeedStore = {
  // Whether the account is the demo account.
  isDemoAccount(userId: string): Promise<boolean>;
  // When the seed was saved, or null if none has been.
  readSavedAt(): Promise<Date | null>;
  // Saves the account's projects (not in the Bin), people and the projects'
  // images as the seed, replacing any earlier seed. Throws SeedTooLargeError
  // if an image or all together are over the limits.
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
        const sizes = await client.query(
          `select coalesce(max(i.original_size), 0) as largest,
             coalesce(sum(i.original_size + i.thumbnail_size), 0) as total,
             count(*) as count
           from project_image i join project p
             on p.user_id = i.user_id and p.id = i.project_id
           where i.user_id = $1 and p.deleted_at is null`,
          [userId],
        );
        const { largest, total, count } = sizes.rows[0];
        if (
          Number(largest) > maxSeedImageBytes ||
          Number(total) > maxSeedTotalBytes
        ) {
          throw new SeedTooLargeError();
        }
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
        await client.query("delete from demo_seed_image", []);
        await client.query(
          `insert into demo_seed_image
             (project_id, id, content_type, caption, created_at, task_id,
              content_hash, original, thumbnail)
           select i.project_id, i.id, i.content_type, i.caption, i.created_at,
             i.task_id, i.content_hash, o.data, t.data
           from project_image i
           join project p
             on p.user_id = i.user_id and p.id = i.project_id
             and p.deleted_at is null
           join project_image_bytes o
             on o.user_id = i.user_id and o.project_id = i.project_id
             and o.image_id = i.id and o.kind = 'original'
           join project_image_bytes t
             on t.user_id = i.user_id and t.project_id = i.project_id
             and t.image_id = i.id and t.kind = 'thumbnail'
           where i.user_id = $1`,
          [userId],
        );
        return {
          savedAt: new Date(String(saved.rows[0].saved_at)).toISOString(),
          projectCount: projects.length,
          peopleCount: people.people.length,
          imageCount: Number(count),
        };
      }),
  };
}
