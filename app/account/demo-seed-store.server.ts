// The demo seed (AD #138 Demo Entry And Seed), in the demo_seed table of
// db/demo-seed.sql: one row holding the demo account's projects and people as
// Robin last saved them. Saving replaces the row.
import {
  lockAccountPeople,
  readAccountPeople,
} from "../projects/people-store.server";
import { serialisePeople } from "../projects/people";
import {
  inTransaction,
  type TransactionalDatabase,
} from "../projects/transaction.server";
import type { SeedAppointment } from "../calendar/demo-seed-appointments.server";
import {
  demoAccountEmail,
  maxSeedImageBytes,
  maxSeedTotalBytes,
  type SeedSaveResponse,
} from "./account-api";

// The images are too big to keep in the seed. Nothing was saved.
export class SeedTooLargeError extends Error {
  readonly code = "seed_too_large";
}

export type DemoSeedStore = {
  // Whether the account is the demo account.
  isDemoAccount(userId: string): Promise<boolean>;
  // When the seed was saved, or null if none has been.
  readSavedAt(): Promise<Date | null>;
  // The ids of the account's projects not in the Bin.
  readProjectIds(userId: string): Promise<string[]>;
  // The seed's appointments, or none if no seed has been saved.
  readAppointments(): Promise<SeedAppointment[]>;
  // Saves the account's projects (not in the Bin), people and the projects'
  // images, with the appointments given, as the seed, replacing any earlier
  // seed. Throws SeedTooLargeError if an image or all together are over the
  // limits.
  save(
    userId: string,
    appointments: SeedAppointment[],
  ): Promise<SeedSaveResponse>;
  // Puts the account back to the saved seed: its projects (with the Bin),
  // images and people are replaced by the seed's. Gives false, changing
  // nothing, if no seed has been saved.
  reset(userId: string): Promise<boolean>;
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

    async readProjectIds(userId) {
      const { rows } = await database.query(
        `select id from project
         where user_id = $1 and deleted_at is null order by id`,
        [userId],
      );
      return rows.map(({ id }) => String(id));
    },

    async readAppointments() {
      const { rows } = await database.query(
        "select appointments from demo_seed",
        [],
      );
      return (rows[0]?.appointments ?? []) as SeedAppointment[];
    },

    save: (userId, appointments) =>
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
          `insert into demo_seed (id, projects, people, appointments)
           values (true, $1::jsonb, $2::jsonb, $3::jsonb)
           on conflict (id) do update
           set projects = excluded.projects, people = excluded.people,
               appointments = excluded.appointments, saved_at = now()
           returning saved_at`,
          [
            JSON.stringify(projects),
            JSON.stringify(people),
            JSON.stringify(appointments),
          ],
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
          appointmentCount: appointments.length,
        };
      }),

    reset: (userId) =>
      inTransaction(database, async (client) => {
        const found = await client.query("select 1 from demo_seed", []);
        if (found.rows.length === 0) return false;
        await lockAccountPeople(client, userId);
        // Removing a project removes its images and their files.
        await client.query("delete from project where user_id = $1", [userId]);
        await client.query(
          `insert into project (user_id, id, data)
           select $1, e->>'id', e->'data'
           from demo_seed, jsonb_array_elements(projects) e`,
          [userId],
        );
        await client.query(
          `insert into project_image
             (user_id, project_id, id, content_type, original_size,
              thumbnail_size, content_hash, caption, created_at, task_id)
           select $1, project_id, id, content_type, octet_length(original),
             octet_length(thumbnail), content_hash, caption, created_at,
             task_id
           from demo_seed_image`,
          [userId],
        );
        await client.query(
          `insert into project_image_bytes
             (user_id, project_id, image_id, kind, data)
           select $1, project_id, id, 'original', original
           from demo_seed_image
           union all
           select $1, project_id, id, 'thumbnail', thumbnail
           from demo_seed_image`,
          [userId],
        );
        await client.query(
          `insert into account_people (user_id, data)
           select $1, people from demo_seed
           on conflict (user_id) do update
           set data = excluded.data, revision = account_people.revision + 1`,
          [userId],
        );
        return true;
      }),
  };
}
