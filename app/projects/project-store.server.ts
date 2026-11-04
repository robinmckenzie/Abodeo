// A signed-in account's projects, in the project table of
// db/account-tables.sql (AD #41 Access Projects Across Devices). Every query
// is limited to the account it is given, which only the handler decides, from
// the sign-in. Each row holds a project's saved form, as the browser keeps
// it, so the same rules apply: a project this version cannot read is never
// overwritten or removed.
import type { Queryable } from "../account/account-profile.server";
import {
  findUnassignChanges,
  isKnownAssignee,
  mapAssigneesByName,
  readPeople,
  serialisePeople,
  type Person,
} from "./people";
import {
  deriveAccountPeople,
  lockAccountPeople,
  readAccountPeople,
} from "./people-store.server";
import {
  applyProjectChanges,
  findConflictingFields,
  type ProjectField,
} from "./project-changes";
import {
  parseProject,
  serialiseProject,
  sortProjectsByDueDate,
  unassignedId,
  type Project,
  type ProjectFields,
} from "./projects";
import {
  binPeriodMs,
  type BinListResponse,
  type ImportOutcome,
  type ProjectListResponse,
} from "./projects-api";
import { inTransaction, type TransactionalDatabase } from "./transaction.server";

export type { TransactionalDatabase };

export type ReadOutcome =
  | { kind: "found"; project: Project }
  | { kind: "not-found" }
  | { kind: "unreadable" };

// A create or save naming someone who is not in the account's list, such as
// removed on another device.
export type UnknownAssignee = { kind: "unknown-assignee" };

export type SaveOutcome =
  | UnknownAssignee
  | { kind: "saved"; project: Project }
  | { kind: "not-found" }
  | { kind: "unreadable" }
  | { kind: "conflict"; project: Project; fields: ProjectField[] }
  // Other saves kept landing in between.
  | { kind: "busy" };

export type RemoveOutcome = { kind: "done" } | { kind: "not-found" };

export type ProjectStore = {
  list(userId: string): Promise<ProjectListResponse>;
  read(userId: string, id: string): Promise<ReadOutcome>;
  // A retry with the same id gives the project already made.
  create(
    userId: string,
    id: string,
    fields: ProjectFields,
  ): Promise<ReadOutcome | UnknownAssignee>;
  saveChanges(
    userId: string,
    id: string,
    base: Partial<ProjectFields>,
    changes: Partial<ProjectFields>,
  ): Promise<SaveOutcome>;
  // people is the browser's list, which goes with its projects (AD #61
  // Manage People): it becomes the account's if the account has none, and
  // otherwise each project's person is matched to the account's by name.
  importProjects(
    userId: string,
    projects: Project[],
    people?: Person[],
  ): Promise<Record<string, ImportOutcome>>;
  // Puts a project in the Bin (AD #62 Delete Projects), where it can be
  // restored until it is cleared for good.
  remove(userId: string, id: string): Promise<RemoveOutcome>;
  // The account's binned projects. It never clears any, so that looking at
  // the Bin cannot remove what is on it.
  listBin(userId: string): Promise<BinListResponse>;
  // Returns a binned project to the list as it was, as Unassigned if its
  // person has been removed since.
  restore(userId: string, id: string): Promise<RemoveOutcome>;
  // Removes a binned project and its images at once.
  deletePermanently(userId: string, id: string): Promise<RemoveOutcome>;
};

// How many times a save reads and tries again when another save lands
// between its read and its write. Provisional.
export const saveAttempts = 3;

function readStoredProject(id: string, data: unknown) {
  return parseProject(id, JSON.stringify(data ?? null));
}

// The saved form as kept in a row: the browser's, as JSON.
function toStoredData(project: Project) {
  return JSON.parse(serialiseProject(project));
}

// A copy's id comes from the original's and the copy sent, so that sending
// the same copy again finds the copy already made.
export function buildCopyId(project: Project) {
  return `${project.id.slice(0, 60)}-copy-${hashText(serialiseProject(project))}`;
}

// cyrb53, a fast 53-bit string hash. It only needs to tell one copy of a
// project from another, not to be secure. Copies already made carry it in
// their ids, so it must not change.
function hashText(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Whether two copies of a project differ only in who the project and its
// tasks are assigned to, as a project does after a move whose answer was lost
// and a person was renamed.
function isSameIgnoringAssignee(a: Project, b: Project) {
  return (
    serialiseProject(withoutAssignees(a)) ===
    serialiseProject(withoutAssignees(b))
  );
}

function withoutAssignees(project: Project): Project {
  return {
    ...project,
    assignee: unassignedId,
    tasks: project.tasks.map((task) => ({ ...task, assignee: unassignedId })),
  };
}

// The people a create or save chooses, for the project or any of its tasks
// (AD #66 Assign Tasks To People), to check against the account's list.
function listChosenPeople(fields: Partial<ProjectFields>) {
  const ids = new Set<string>();
  if (fields.assignee !== undefined) ids.add(fields.assignee);
  fields.tasks?.forEach((task) => ids.add(task.assignee));
  ids.delete(unassignedId);
  return [...ids];
}

export function createProjectStore(
  database: TransactionalDatabase,
  { now = () => new Date().toISOString() }: { now?: () => string } = {},
): ProjectStore {
  // Leaves any project already under the same id as it is, and gives the ids
  // of those inserted.
  const insertMany = async (
    query: Queryable,
    userId: string,
    projects: Project[],
  ) => {
    if (projects.length === 0) return new Set<string>();
    const entries = projects.map((project) => ({
      id: project.id,
      data: toStoredData(project),
    }));
    const { rows } = await query.query(
      `insert into project (user_id, id, data)
       select $1, entry->>'id', entry->'data'
       from jsonb_array_elements($2::jsonb) as entry
       on conflict (user_id, id) do nothing
       returning id`,
      [userId, JSON.stringify(entries)],
    );
    return new Set(rows.map((row) => String(row.id)));
  };

  const readRows = async (query: Queryable, userId: string, ids: string[]) => {
    const { rows } = await query.query(
      `select id, data from project
       where user_id = $1 and deleted_at is null
       and id in (select jsonb_array_elements_text($2::jsonb))`,
      [userId, JSON.stringify(ids)],
    );
    return new Map(rows.map((row) => [String(row.id), row.data]));
  };

  const read = async (
    userId: string,
    id: string,
    query: Queryable = database,
  ): Promise<ReadOutcome> => {
    const { rows } = await query.query(
      "select data from project where user_id = $1 and id = $2 and deleted_at is null",
      [userId, id],
    );
    if (rows.length === 0) return { kind: "not-found" };
    const project = readStoredProject(id, rows[0].data);
    return project ? { kind: "found", project } : { kind: "unreadable" };
  };

  return {
    async list(userId) {
      await purgeExpired(userId);
      const { rows } = await database.query(
        "select id, data from project where user_id = $1 and deleted_at is null",
        [userId],
      );
      const projects: Project[] = [];
      let unreadableCount = 0;
      for (const row of rows) {
        const project = readStoredProject(String(row.id), row.data);
        if (project) projects.push(project);
        else unreadableCount++;
      }
      // Thumbnails are optional: without the image tables, the projects load.
      // A task's photos (AD #67) are not shown on the project's bar.
      const latestRows = await database
        .query(
          `select distinct on (project_id) project_id, id from project_image
           where user_id = $1 and task_id is null
           and project_id in (
             select id from project where user_id = $1 and deleted_at is null)
           order by project_id, created_at desc, id desc`,
          [userId],
        )
        .then(({ rows }) => rows)
        .catch((error: unknown) => {
          if ((error as { code?: string })?.code === "42P01") return [];
          throw error;
        });
      // Object.fromEntries defines each key, even one named like a prototype's.
      const latestImageIds = Object.fromEntries(
        latestRows.map((row) => [String(row.project_id), String(row.id)]),
      );
      return {
        projects: sortProjectsByDueDate(projects),
        unreadableCount,
        latestImageIds,
        imageCounts: await readImageCounts(userId, false),
      };
    },

    read,

    async create(userId, id, fields) {
      await purgeExpired(userId);
      const time = now();
      const project: Project = {
        ...fields,
        id,
        createdAt: time,
        updatedAt: time,
      };
      const insert = async (query: Queryable): Promise<ReadOutcome> => {
        const inserted = await insertMany(query, userId, [project]);
        return inserted.has(id)
          ? { kind: "found", project }
          : read(userId, id, query);
      };
      const chosen = listChosenPeople(fields);
      if (chosen.length === 0) return insert(database);
      return inTransaction(database, async (client) => {
        const people = await readAccountPeople(client, userId, { lock: true });
        if (!chosen.every((other) => isKnownAssignee(people, other))) {
          return { kind: "unknown-assignee" };
        }
        return insert(client);
      });
    },

    async saveChanges(userId, id, base, changes) {
      await purgeExpired(userId);
      const trySave = async (query: Queryable): Promise<SaveOutcome> => {
        for (let attempt = 0; attempt < saveAttempts; attempt++) {
          const { rows } = await query.query(
            "select data, revision from project where user_id = $1 and id = $2 and deleted_at is null",
            [userId, id],
          );
          if (rows.length === 0) return { kind: "not-found" };
          const saved = readStoredProject(id, rows[0].data);
          if (!saved) return { kind: "unreadable" };
          const fields = findConflictingFields(saved, base, changes);
          if (fields.length > 0)
            return { kind: "conflict", project: saved, fields };
          const project = applyProjectChanges(saved, changes, now());
          const updated = await query.query(
            `update project set data = $3::jsonb, revision = revision + 1
             where user_id = $1 and id = $2 and revision = $4
             and deleted_at is null
             returning id`,
            [
              userId,
              id,
              JSON.stringify(toStoredData(project)),
              rows[0].revision,
            ],
          );
          if (updated.rows.length > 0) return { kind: "saved", project };
        }
        return { kind: "busy" };
      };
      const chosen = listChosenPeople(changes);
      if (chosen.length === 0) return trySave(database);
      // Choosing someone is checked against the list, held until the save is
      // done, so that a removal cannot come between.
      return inTransaction(database, async (client) => {
        const people = await readAccountPeople(client, userId, { lock: true });
        if (!chosen.every((other) => isKnownAssignee(people, other))) {
          return { kind: "unknown-assignee" };
        }
        return trySave(client);
      });
    },

    // Each project goes in under its own id. Where the account already has
    // that id, a copy that is the same but for who is assigned counts as
    // moved before, as when the browser's clean-up after a move failed. A
    // different one goes in as a copy, so that neither is lost. Who is
    // assigned is applied only as each is written, so that sending the same
    // move again after someone was renamed finds what it made before.
    async importProjects(userId, projects, browserPeople) {
      return inTransaction(database, async (client) => {
        const remap = await settleImportPeople(client, userId, browserPeople);
        const withAssignee = (project: Project): Project => ({
          ...project,
          assignee: remap(project.assignee),
          tasks: project.tasks.map((task) => ({
            ...task,
            assignee: remap(task.assignee),
          })),
        });
        const outcomes: Record<string, ImportOutcome> = {};
        const moved = await insertMany(
          client,
          userId,
          projects.map(withAssignee),
        );
        const rest = projects.filter(({ id }) => !moved.has(id));
        moved.forEach((id) => (outcomes[id] = "moved"));
        const stored = await readRows(
          client,
          userId,
          rest.map(({ id }) => id),
        );
        const copies: Project[] = [];
        for (const project of rest) {
          const existing = readStoredProject(
            project.id,
            stored.get(project.id),
          );
          if (existing && isSameIgnoringAssignee(existing, project)) {
            outcomes[project.id] = "already-moved";
          } else {
            copies.push({
              ...withAssignee(project),
              id: buildCopyId(project),
            });
          }
        }
        const copied = await insertMany(client, userId, copies);
        for (const copy of copies) {
          const originalId = rest.find(
            (project) => buildCopyId(project) === copy.id,
          )!.id;
          outcomes[originalId] = copied.has(copy.id)
            ? "moved-as-copy"
            : "already-moved";
        }
        return outcomes;
      });
    },

    async remove(userId, id) {
      const { rows } = await database.query(
        `update project set deleted_at = $3::timestamptz, revision = revision + 1
         where user_id = $1 and id = $2 and deleted_at is null
         returning id`,
        [userId, id, now()],
      );
      return { kind: rows.length > 0 ? "done" : "not-found" };
    },

    async listBin(userId) {
      const { rows } = await database.query(
        `select id, data,
           to_char(deleted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           as deleted_at
         from project where user_id = $1 and deleted_at is not null`,
        [userId],
      );
      const projects: BinListResponse["projects"] = [];
      let unreadableCount = 0;
      for (const row of rows) {
        const project = readStoredProject(String(row.id), row.data);
        if (project) {
          projects.push({ project, deletedAt: String(row.deleted_at) });
        } else {
          unreadableCount++;
        }
      }
      projects.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return {
        projects,
        unreadableCount,
        imageCounts: await readImageCounts(userId, true),
      };
    },

    async restore(userId, id) {
      return inTransaction(database, async (client) => {
        const people = await readAccountPeople(client, userId, { lock: true });
        const { rows } = await client.query(
          `select data from project
           where user_id = $1 and id = $2 and deleted_at is not null
           for update`,
          [userId, id],
        );
        if (rows.length === 0) return { kind: "not-found" };
        const project = readStoredProject(id, rows[0].data);
        // Removing a person only changes the projects that are shown, so a
        // binned project, or its tasks, may still name someone who has gone.
        const changes =
          project &&
          findUnassignChanges(
            project,
            (other) => !isKnownAssignee(people, other),
          );
        const data =
          project && changes
            ? toStoredData({ ...project, ...changes })
            : rows[0].data;
        await client.query(
          `update project set deleted_at = null, data = $3::jsonb,
           revision = revision + 1
           where user_id = $1 and id = $2`,
          [userId, id, JSON.stringify(data)],
        );
        return { kind: "done" };
      });
    },

    async deletePermanently(userId, id) {
      const { rows } = await database.query(
        `delete from project
         where user_id = $1 and id = $2 and deleted_at is not null
         returning id`,
        [userId, id],
      );
      return { kind: rows.length > 0 ? "done" : "not-found" };
    },
  };

  // Clears the projects binned for longer than the cooling-off period, and
  // with them their images. Only the dashboard's load and saves do this
  // (AD #62 Delete Projects).
  async function purgeExpired(userId: string) {
    const cutoff = new Date(Date.parse(now()) - binPeriodMs).toISOString();
    await database.query(
      `delete from project
       where user_id = $1 and deleted_at <= $2::timestamptz`,
      [userId, cutoff],
    );
  }

  // How many images each of the account's shown (or binned) projects has.
  // Without the image tables, there are none.
  async function readImageCounts(userId: string, isBinned: boolean) {
    const rows = await database
      .query(
        `select i.project_id, count(*) as count
         from project_image i
         join project p on p.user_id = i.user_id and p.id = i.project_id
         where i.user_id = $1 and (p.deleted_at is not null) = $2
         group by i.project_id`,
        [userId, isBinned],
      )
      .then(({ rows }) => rows)
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === "42P01") return [];
        throw error;
      });
    return Object.fromEntries(
      rows.map((row) => [String(row.project_id), Number(row.count)]),
    );
  }

  // The account's projects named a person by another id than the browser's
  // person of the same name, so they follow the browser's person rather than
  // becoming Unassigned. Each is changed once, from what it was, and only if
  // it can be read.
  async function followRenamedPeople(
    client: Queryable,
    userId: string,
    renamed: Map<string, string>,
  ) {
    if (renamed.size === 0) return;
    const { rows } = await client.query(
      `select id, data from project
       where user_id = $1 and data->>'assignee' = any($2::text[]) for update`,
      [userId, [...renamed.keys()]],
    );
    for (const row of rows) {
      const saved = readStoredProject(String(row.id), row.data);
      if (!saved) continue;
      await client.query(
        `update project set data = jsonb_set(data, '{assignee}', to_jsonb($3::text)),
         revision = revision + 1
         where user_id = $1 and id = $2`,
        [userId, String(row.id), renamed.get(saved.assignee)],
      );
    }
  }

  // Gives who each moved project is assigned to: where the account has no
  // list, the browser's becomes the account's and people carry by id; where
  // it has, people are matched by name, and those without a match are
  // Unassigned. The row is locked until the move is done.
  async function settleImportPeople(
    client: Queryable,
    userId: string,
    browserPeople: Person[] | undefined,
  ): Promise<(assignee: string) => string> {
    await lockAccountPeople(client, userId);
    const select = () =>
      client.query(
        "select data from account_people where user_id = $1 for update",
        [userId],
      );
    let { rows } = await select();
    if (rows.length === 0 && browserPeople !== undefined) {
      const derived: Person[] = [];
      const renamed = new Map<string, string>();
      for (const person of await deriveAccountPeople(client, userId)) {
        // The name decides first, so that browser people whose ids and names
        // are crossed over do not all match the one with the same id.
        const same =
          browserPeople.find(
            (other) =>
              person.name !== "" &&
              other.name.toLocaleLowerCase() ===
                person.name.toLocaleLowerCase(),
          ) ?? browserPeople.find((other) => other.id === person.id);
        if (!same) derived.push(person);
        else if (same.id !== person.id) renamed.set(person.id, same.id);
      }
      await followRenamedPeople(client, userId, renamed);
      const list = [...browserPeople, ...derived];
      const inserted = await client.query(
        `insert into account_people (user_id, data) values ($1, $2::jsonb)
         on conflict (user_id) do nothing returning user_id`,
        [userId, serialisePeople(list)],
      );
      if (inserted.rows.length > 0) {
        return (assignee) =>
          browserPeople.some(({ id }) => id === assignee)
            ? assignee
            : unassignedId;
      }
      // Another device saved a list first, which wins.
      ({ rows } = await select());
    }
    if (rows.length === 0) return () => unassignedId;
    // A damaged list stops the move, so that no one loses who they were
    // assigned to.
    const accountPeople = readPeople(rows[0].data);
    if (!accountPeople) throw new Error("account-people-unreadable");
    const matches = mapAssigneesByName(browserPeople ?? [], accountPeople);
    return (assignee) => matches.get(assignee) ?? unassignedId;
  }
}
