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
  ruleForDate,
  ruleForEvent,
  dateFromRule,
  type DateRule,
} from "./demo-seed-dates";
import {
  demoAccountEmail,
  maxSeedImageBytes,
  maxSeedTotalBytes,
  type SeedSaveResponse,
} from "./account-api";

// Re-exported, so that callers need one import for the seed's errors.
export { SeedPastDateError } from "./demo-seed-dates";

// The images are too big to keep in the seed. Nothing was saved.
export class SeedTooLargeError extends Error {
  readonly code = "seed_too_large";
}

export type DemoSeedStore = {
  // Whether the account is the demo account.
  isDemoAccount(userId: string): Promise<boolean>;
  // What the saved seed holds and when it was saved, or null if none has
  // been.
  readSaved(): Promise<SeedSaveResponse | null>;
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

type SavedProject = { id: string; data: unknown; dueRule?: DateRule };

function readDueDate(data: unknown) {
  const { dueDate } = (data ?? {}) as { dueDate?: unknown };
  return typeof dueDate === "string" ? dueDate : undefined;
}

// The seed's projects with each due date worked out again from now, or as
// saved if the project has no rule (a seed saved before dates moved).
function moveDueDates(projects: SavedProject[], now: number) {
  return projects.map(({ id, data, dueRule }) => ({
    id,
    data: dueRule
      ? { ...(data as object), dueDate: dateFromRule(dueRule, now) }
      : data,
  }));
}

export function createDemoSeedStore(
  database: TransactionalDatabase,
  now: () => number = Date.now,
): DemoSeedStore {
  return {
    async isDemoAccount(userId) {
      const { rows } = await database.query(
        "select 1 from auth_user where id = $1 and email = $2",
        [userId, demoAccountEmail],
      );
      return rows.length > 0;
    },

    async readSaved() {
      const { rows } = await database.query(
        `select saved_at, jsonb_array_length(projects) as projects,
           jsonb_array_length(people->'people') as people,
           jsonb_array_length(appointments) as appointments,
           (select count(*) from demo_seed_image) as images
         from demo_seed`,
        [],
      );
      if (rows.length === 0) return null;
      const [seed] = rows;
      return {
        savedAt: new Date(String(seed.saved_at)).toISOString(),
        projectCount: Number(seed.projects),
        peopleCount: Number(seed.people),
        imageCount: Number(seed.images),
        appointmentCount: Number(seed.appointments),
      };
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
        // A due date or start that has passed throws SeedPastDateError.
        const saveTime = now();
        const projects = rows.map(({ id: rawId, data }): SavedProject => {
          const id = String(rawId);
          const dueDate = readDueDate(data);
          return dueDate === undefined
            ? { id, data }
            : { id, data, dueRule: ruleForDate(dueDate, saveTime) };
        });
        const movingAppointments = appointments.map((appointment) => ({
          ...appointment,
          rule: ruleForEvent(appointment.event, saveTime),
        }));
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
            JSON.stringify(movingAppointments),
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
        const found = await client.query("select projects from demo_seed", []);
        if (found.rows.length === 0) return false;
        const projects = moveDueDates(
          found.rows[0].projects as SavedProject[],
          now(),
        );
        await lockAccountPeople(client, userId);
        // Removing a project removes its images and their files.
        await client.query("delete from project where user_id = $1", [userId]);
        await client.query(
          `insert into project (user_id, id, data)
           select $1, e->>'id', e->'data'
           from jsonb_array_elements($2::jsonb) e`,
          [userId, JSON.stringify(projects)],
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
