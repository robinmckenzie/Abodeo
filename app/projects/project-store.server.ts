// A signed-in account's projects, in the project and
// project_defaults_received tables of db/account-tables.sql (AD #41 Access
// Projects Across Devices). Every query is limited to the account it is
// given, which only the handler decides, from the sign-in. Each row holds a
// project's saved form, as the browser keeps it, so the same rules apply: a
// project this version cannot read is never overwritten or removed.
import type { Queryable } from "../account/account-profile.server";
import {
  bundledDefaultProjects,
  hashText,
  planDefaultsReceipt,
  type DefaultProjects,
  type DefaultsRecord,
} from "./default-projects";
import {
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
import type { ImportOutcome, ProjectListResponse } from "./projects-api";
import {
  inTransaction,
  transactionTimeout,
  type TransactionalDatabase,
} from "./transaction.server";

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

export type ProjectStore = {
  // Brings the account's default projects up to date, if they have changed.
  receiveDefaults(userId: string): Promise<unknown>;
  // Receives the default projects first, if they have changed.
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

function readRecord(row: Record<string, unknown> | undefined) {
  if (!row || typeof row.hash !== "string" || !Array.isArray(row.ids)) {
    return null;
  }
  const ids = row.ids.filter((id): id is string => typeof id === "string");
  return { hash: row.hash, ids } satisfies DefaultsRecord;
}

// A copy's id comes from the original's and the copy sent, so that sending
// the same copy again finds the copy already made.
export function buildCopyId(project: Project) {
  return `${project.id.slice(0, 60)}-copy-${hashText(serialiseProject(project))}`;
}

// Whether two copies of a project differ only in who is assigned, as a
// project does after a move whose answer was lost and a person was renamed.
function isSameIgnoringAssignee(a: Project, b: Project) {
  return (
    serialiseProject({ ...a, assignee: "" }) ===
    serialiseProject({ ...b, assignee: "" })
  );
}

export function createProjectStore(
  database: TransactionalDatabase,
  {
    defaults = bundledDefaultProjects,
    now = () => new Date().toISOString(),
  }: {
    defaults?: DefaultProjects | null;
    now?: () => string;
  } = {},
): ProjectStore {
  const insertMany = async (
    query: Queryable,
    userId: string,
    projects: Project[],
    { overwrite }: { overwrite: boolean },
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
       on conflict (user_id, id) do ${
         overwrite
           ? "update set data = excluded.data, revision = project.revision + 1"
           : "nothing"
       }
       returning id`,
      [userId, JSON.stringify(entries)],
    );
    return new Set(rows.map((row) => String(row.id)));
  };

  // A project already saved with someone who is not in the list is kept as
  // it is, but a write never newly names them: that is dropped to Unassigned.
  const dropUnknownAssignees = async (
    query: Queryable,
    userId: string,
    projects: Project[],
  ) => {
    if (projects.every(({ assignee }) => assignee === unassignedId)) {
      return projects;
    }
    const people = await readAccountPeople(query, userId);
    return projects.map((project) =>
      isKnownAssignee(people, project.assignee)
        ? project
        : { ...project, assignee: unassignedId },
    );
  };

  const readRows = async (query: Queryable, userId: string, ids: string[]) => {
    const { rows } = await query.query(
      `select id, data from project
       where user_id = $1
       and id in (select jsonb_array_elements_text($2::jsonb))`,
      [userId, JSON.stringify(ids)],
    );
    return new Map(rows.map((row) => [String(row.id), row.data]));
  };

  // Brings the account's default projects up to date, as each browser does
  // for itself. Two devices loading at once cannot both apply them, as the
  // record's row is locked until the transaction ends.
  const receiveDefaults = async (userId: string) => {
    const { rows } = await database.query(
      "select hash, ids from project_defaults_received where user_id = $1",
      [userId],
    );
    if (!planDefaultsReceipt(readRecord(rows[0]), defaults, () => false)) {
      return readRecord(rows[0]);
    }
    const client = await database.connect();
    try {
      await client.query("begin", []);
      await client.query(
        `set local statement_timeout = '${transactionTimeout}'`,
        [],
      );
      await client.query(
        `set local lock_timeout = '${transactionTimeout}'`,
        [],
      );
      await client.query(
        `insert into project_defaults_received (user_id, hash, ids)
         values ($1, '', '[]'::jsonb) on conflict (user_id) do nothing`,
        [userId],
      );
      const locked = await client.query(
        `select hash, ids from project_defaults_received
         where user_id = $1 for update`,
        [userId],
      );
      const lockedRecord = readRecord(locked.rows[0]);
      // An empty hash is the row just made, standing for none received.
      const record = lockedRecord?.hash === "" ? null : lockedRecord;
      const candidates = [
        ...(defaults?.projects.map(({ id }) => id) ?? []),
        ...(record?.ids ?? []),
      ];
      const stored = await readRows(client, userId, candidates);
      const receipt = planDefaultsReceipt(
        record,
        defaults,
        (id) => stored.has(id) && !readStoredProject(id, stored.get(id)),
      );
      if (receipt) {
        await insertMany(
          client,
          userId,
          await dropUnknownAssignees(client, userId, receipt.write),
          { overwrite: true },
        );
        if (receipt.remove.length > 0) {
          await client.query(
            `delete from project where user_id = $1
             and id in (select jsonb_array_elements_text($2::jsonb))`,
            [userId, JSON.stringify(receipt.remove)],
          );
        }
        await client.query(
          `update project_defaults_received set hash = $2, ids = $3::jsonb
           where user_id = $1`,
          [userId, receipt.record.hash, JSON.stringify(receipt.record.ids)],
        );
      }
      await client.query("commit", []);
      return receipt?.record ?? record;
    } catch (error) {
      await client.query("rollback", []).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const read = async (
    userId: string,
    id: string,
    query: Queryable = database,
  ): Promise<ReadOutcome> => {
    const { rows } = await query.query(
      "select data from project where user_id = $1 and id = $2",
      [userId, id],
    );
    if (rows.length === 0) return { kind: "not-found" };
    const project = readStoredProject(id, rows[0].data);
    return project ? { kind: "found", project } : { kind: "unreadable" };
  };

  return {
    receiveDefaults,

    async list(userId) {
      const record = await receiveDefaults(userId);
      const { rows } = await database.query(
        "select id, data from project where user_id = $1",
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
      const latestRows = await database
        .query(
          `select distinct on (project_id) project_id, id from project_image
           where user_id = $1
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
        defaultIds: record?.ids ?? [],
        latestImageIds,
      };
    },

    read,

    async create(userId, id, fields) {
      const time = now();
      const project: Project = {
        ...fields,
        id,
        createdAt: time,
        updatedAt: time,
      };
      const insert = async (query: Queryable): Promise<ReadOutcome> => {
        const inserted = await insertMany(query, userId, [project], {
          overwrite: false,
        });
        return inserted.has(id)
          ? { kind: "found", project }
          : read(userId, id, query);
      };
      if (fields.assignee === unassignedId) return insert(database);
      return inTransaction(database, async (client) => {
        const people = await readAccountPeople(client, userId, { lock: true });
        if (!isKnownAssignee(people, fields.assignee)) {
          return { kind: "unknown-assignee" };
        }
        return insert(client);
      });
    },

    async saveChanges(userId, id, base, changes) {
      const trySave = async (query: Queryable): Promise<SaveOutcome> => {
        for (let attempt = 0; attempt < saveAttempts; attempt++) {
          const { rows } = await query.query(
            "select data, revision from project where user_id = $1 and id = $2",
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
      const assignee = changes.assignee;
      if (assignee === undefined || assignee === unassignedId) {
        return trySave(database);
      }
      // Choosing someone is checked against the list, held until the save is
      // done, so that a removal cannot come between.
      return inTransaction(database, async (client) => {
        const people = await readAccountPeople(client, userId, { lock: true });
        if (!isKnownAssignee(people, assignee)) {
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
        });
        const outcomes: Record<string, ImportOutcome> = {};
        const moved = await insertMany(
          client,
          userId,
          projects.map(withAssignee),
          { overwrite: false },
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
        const copied = await insertMany(client, userId, copies, {
          overwrite: false,
        });
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
  };

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
