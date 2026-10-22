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
  applyProjectChanges,
  findConflictingFields,
  type ProjectField,
} from "./project-changes";
import {
  parseProject,
  serialiseProject,
  sortProjects,
  type Project,
  type ProjectFields,
} from "./projects";
import type { ImportOutcome, ProjectListResponse } from "./projects-api";

// A database that can also give one connection for a transaction, as the
// Neon pool does.
export type TransactionalDatabase = Queryable & {
  connect(): Promise<Queryable & { release(): void }>;
};

export type ReadOutcome =
  | { kind: "found"; project: Project }
  | { kind: "not-found" }
  | { kind: "unreadable" };

export type SaveOutcome =
  | { kind: "saved"; project: Project }
  | { kind: "not-found" }
  | { kind: "unreadable" }
  | { kind: "conflict"; project: Project; fields: ProjectField[] }
  // Other saves kept landing in between.
  | { kind: "busy" };

export type ProjectStore = {
  // Receives the default projects first, if they have changed.
  list(userId: string): Promise<ProjectListResponse>;
  read(userId: string, id: string): Promise<ReadOutcome>;
  // A retry with the same id gives the project already made.
  create(
    userId: string,
    id: string,
    fields: ProjectFields,
  ): Promise<ReadOutcome>;
  saveChanges(
    userId: string,
    id: string,
    base: Partial<ProjectFields>,
    changes: Partial<ProjectFields>,
  ): Promise<SaveOutcome>;
  importProjects(
    userId: string,
    projects: Project[],
  ): Promise<Record<string, ImportOutcome>>;
};

// How many times a save reads and tries again when another save lands
// between its read and its write. Provisional.
export const saveAttempts = 3;

// How long each statement of the defaults' transaction may wait, including
// for the lock that stops two devices applying the defaults at once.
const transactionTimeout = "4s";

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
        await insertMany(client, userId, receipt.write, { overwrite: true });
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

  const read = async (userId: string, id: string): Promise<ReadOutcome> => {
    const { rows } = await database.query(
      "select data from project where user_id = $1 and id = $2",
      [userId, id],
    );
    if (rows.length === 0) return { kind: "not-found" };
    const project = readStoredProject(id, rows[0].data);
    return project ? { kind: "found", project } : { kind: "unreadable" };
  };

  return {
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
        projects: sortProjects(projects),
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
      const inserted = await insertMany(database, userId, [project], {
        overwrite: false,
      });
      return inserted.has(id) ? { kind: "found", project } : read(userId, id);
    },

    async saveChanges(userId, id, base, changes) {
      for (let attempt = 0; attempt < saveAttempts; attempt++) {
        const { rows } = await database.query(
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
        const updated = await database.query(
          `update project set data = $3::jsonb, revision = revision + 1
           where user_id = $1 and id = $2 and revision = $4
           returning id`,
          [userId, id, JSON.stringify(toStoredData(project)), rows[0].revision],
        );
        if (updated.rows.length > 0) return { kind: "saved", project };
      }
      return { kind: "busy" };
    },

    // Each project goes in under its own id. Where the account already has
    // that id, an identical copy counts as moved before, as when the
    // browser's clean-up after a move failed. A different one goes in as a
    // copy, so that neither is lost.
    async importProjects(userId, projects) {
      const outcomes: Record<string, ImportOutcome> = {};
      const moved = await insertMany(database, userId, projects, {
        overwrite: false,
      });
      const rest = projects.filter(({ id }) => !moved.has(id));
      moved.forEach((id) => (outcomes[id] = "moved"));
      const stored = await readRows(
        database,
        userId,
        rest.map(({ id }) => id),
      );
      const copies: Project[] = [];
      for (const project of rest) {
        const existing = readStoredProject(project.id, stored.get(project.id));
        if (
          existing &&
          serialiseProject(existing) === serialiseProject(project)
        ) {
          outcomes[project.id] = "already-moved";
        } else {
          copies.push({ ...project, id: buildCopyId(project) });
        }
      }
      const copied = await insertMany(database, userId, copies, {
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
    },
  };
}
