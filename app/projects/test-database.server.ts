// A database that stands in for Postgres in the project and people stores'
// tests, understanding only their own statements, and recording each one
// with its values.
import type { TransactionalDatabase } from "./transaction.server";

type Row = {
  user_id: string;
  id: string;
  data: unknown;
  revision: number;
  // When the project was put in the Bin (AD #62 Delete Projects), if it was.
  deletedAt?: string | null;
};

// Stands in for Postgres, understanding only the store's own statements, and
// recording each one with its values.
export function createFakeDatabase() {
  const projects: Row[] = [];
  const records = new Map<string, { hash: string; ids: string[] }>();
  // Each account's list of people (AD #61 Manage People).
  const people = new Map<string, { data: unknown; revision: number }>();
  // The newest image of each project, as the database would answer.
  const latestImages: { user_id: string; project_id: string; id: string }[] =
    [];
  // Every image, for counts: the newest of each project is in latestImages.
  const images: { user_id: string; project_id: string; id: string }[] = [];
  const statements: { text: string; values: unknown[] }[] = [];
  // Runs just before a save's update, as another save landing in between.
  let beforeUpdate: (() => void) | null = null;
  let isFailing = false;
  let isImageTableMissing = false;

  const find = (userId: string, id: string) =>
    projects.find((row) => row.user_id === userId && row.id === id);

  // Whether a statement reaches a row: those that name deleted_at reach only
  // the shown or only the binned.
  const isReached = (row: Row, sql: string) =>
    sql.includes("deleted_at is not null")
      ? Boolean(row.deletedAt)
      : sql.includes("deleted_at is null")
        ? !row.deletedAt
        : true;
  const findReached = (userId: string, id: string, sql: string) => {
    const row = find(userId, id);
    return row && isReached(row, sql) ? row : undefined;
  };

  const query = async (text: string, values: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    statements.push({ text: sql, values });
    if (isFailing) throw Object.assign(new Error("down"), { code: "57P01" });
    const [userId] = values as string[];
    if (/^(begin|commit|rollback|set local)/.test(sql)) return { rows: [] };
    if (sql.startsWith("select hash, ids from project_defaults_received")) {
      const record = records.get(userId);
      return { rows: record ? [{ ...record }] : [] };
    }
    if (sql.startsWith("insert into project_defaults_received")) {
      if (!records.has(userId)) records.set(userId, { hash: "", ids: [] });
      return { rows: [] };
    }
    if (sql.startsWith("update project_defaults_received")) {
      records.set(userId, {
        hash: values[1] as string,
        ids: JSON.parse(values[2] as string),
      });
      return { rows: [] };
    }
    if (sql.startsWith("insert into project ")) {
      const entries = JSON.parse(values[1] as string) as {
        id: string;
        data: unknown;
      }[];
      const overwrite = sql.includes("do update");
      const rows = [];
      for (const { id, data } of entries) {
        const existing = find(userId, id);
        if (!existing) {
          projects.push({ user_id: userId, id, data, revision: 1 });
          rows.push({ id });
        } else if (overwrite && isReached(existing, sql)) {
          existing.data = data;
          existing.revision++;
          rows.push({ id });
        }
      }
      return { rows };
    }
    if (
      sql.startsWith("select id, data from project where user_id = $1") &&
      sql.includes(" and id in ")
    ) {
      const ids = JSON.parse(values[1] as string) as string[];
      return {
        rows: projects
          .filter(
            (row) =>
              row.user_id === userId &&
              isReached(row, sql) &&
              ids.includes(row.id),
          )
          .map(({ id, data }) => ({ id, data })),
      };
    }
    if (sql.startsWith("update project set deleted_at = $3")) {
      const row = findReached(userId, values[1] as string, sql);
      if (!row) return { rows: [] };
      row.deletedAt = values[2] as string;
      row.revision++;
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith("update project set deleted_at = null")) {
      const row = find(userId, values[1] as string);
      if (row) {
        row.deletedAt = null;
        row.data = JSON.parse(values[2] as string);
        row.revision++;
      }
      return { rows: [] };
    }
    if (sql.includes("deleted_at <= $2")) {
      const cutoff = values[1] as string;
      for (const row of [...projects]) {
        if (
          row.user_id === userId &&
          row.deletedAt &&
          row.deletedAt <= cutoff
        ) {
          projects.splice(projects.indexOf(row), 1);
        }
      }
      return { rows: [] };
    }
    if (sql.includes("deleted_at is not null returning id")) {
      const row = findReached(userId, values[1] as string, sql);
      if (!row) return { rows: [] };
      projects.splice(projects.indexOf(row), 1);
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith("select id, data, to_char(deleted_at")) {
      return {
        rows: projects
          .filter((row) => row.user_id === userId && isReached(row, sql))
          .map(({ id, data, deletedAt }) => ({
            id,
            data,
            deleted_at: deletedAt,
          })),
      };
    }
    if (sql.startsWith("select i.project_id, count(*)")) {
      if (isImageTableMissing) {
        throw Object.assign(new Error("no table"), { code: "42P01" });
      }
      const counts = new Map<string, number>();
      for (const image of images) {
        const project = find(userId, image.project_id);
        if (
          image.user_id !== userId ||
          !project ||
          Boolean(project.deletedAt) !== values[1]
        ) {
          continue;
        }
        counts.set(image.project_id, (counts.get(image.project_id) ?? 0) + 1);
      }
      return {
        rows: [...counts].map(([project_id, count]) => ({
          project_id,
          count: String(count),
        })),
      };
    }
    if (sql.startsWith("delete from project")) {
      const ids = JSON.parse(values[1] as string) as string[];
      for (const id of ids) {
        const index = projects.indexOf(find(userId, id)!);
        if (index >= 0) projects.splice(index, 1);
      }
      return { rows: [] };
    }
    if (
      sql.startsWith("select id, data from project where user_id = $1") &&
      !sql.includes("data->>")
    ) {
      return {
        rows: projects
          .filter((row) => row.user_id === userId && isReached(row, sql))
          .map(({ id, data }) => ({ id, data })),
      };
    }
    if (sql.startsWith("select distinct on (project_id) project_id, id")) {
      if (isImageTableMissing) {
        throw Object.assign(new Error("no table"), { code: "42P01" });
      }
      return {
        rows: latestImages.filter(
          (row) =>
            row.user_id === userId && !find(userId, row.project_id)?.deletedAt,
        ),
      };
    }
    if (sql.startsWith("select data from project")) {
      const row = findReached(userId, values[1] as string, sql);
      return { rows: row ? [{ data: row.data }] : [] };
    }
    if (sql.startsWith("select data, revision from project")) {
      const row = findReached(userId, values[1] as string, sql);
      return {
        rows: row ? [{ data: row.data, revision: String(row.revision) }] : [],
      };
    }
    if (sql.startsWith("select data, revision from account_people")) {
      const row = people.get(userId);
      return {
        rows: row ? [{ data: row.data, revision: String(row.revision) }] : [],
      };
    }
    if (sql.startsWith("select data from account_people")) {
      const row = people.get(userId);
      return { rows: row ? [{ data: row.data }] : [] };
    }
    if (sql.startsWith("insert into account_people")) {
      if (people.has(userId)) return { rows: [] };
      people.set(userId, {
        data: JSON.parse(values[1] as string),
        revision: 1,
      });
      return { rows: sql.includes("returning") ? [{ user_id: userId }] : [] };
    }
    if (sql.startsWith("update account_people set data")) {
      const row = people.get(userId);
      if (!row) return { rows: [] };
      row.data = JSON.parse(values[1] as string);
      row.revision++;
      return { rows: [{ revision: String(row.revision) }] };
    }
    if (sql.includes("data->>'assignee' = any($2::text[])")) {
      const ids = values[1] as string[];
      return {
        rows: projects
          .filter(
            (row) =>
              row.user_id === userId &&
              isReached(row, sql) &&
              ids.includes((row.data as { assignee?: string })?.assignee ?? ""),
          )
          .map(({ id, data }) => ({ id, data })),
      };
    }
    if (sql.startsWith("select pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("to_jsonb($3::text)")) {
      const row = find(userId, values[1] as string);
      if (row) {
        row.data = { ...(row.data as object), assignee: values[2] };
        row.revision++;
      }
      return { rows: [] };
    }
    if (sql.includes("data->>'assignee' = $2")) {
      return {
        rows: projects
          .filter(
            (row) =>
              row.user_id === userId &&
              isReached(row, sql) &&
              (row.data as { assignee?: string })?.assignee === values[1],
          )
          .map(({ id, data }) => ({ id, data })),
      };
    }
    if (sql.startsWith("update project set data = jsonb_set(")) {
      const ids = JSON.parse(values[1] as string) as string[];
      for (const id of ids) {
        const row = find(userId, id);
        if (!row) continue;
        row.data = { ...(row.data as object), assignee: "unassigned" };
        row.revision++;
      }
      return { rows: [] };
    }
    if (sql.startsWith("update project set data")) {
      beforeUpdate?.();
      beforeUpdate = null;
      const row = findReached(userId, values[1] as string, sql);
      if (!row || String(row.revision) !== values[3]) return { rows: [] };
      row.data = JSON.parse(values[2] as string);
      row.revision++;
      return { rows: [{ id: row.id }] };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  };

  let released = 0;
  const database: TransactionalDatabase = {
    query,
    connect: async () => ({ query, release: () => void released++ }),
  };
  return {
    database,
    projects,
    people,
    records,
    latestImages,
    images,
    statements,
    released: () => released,
    setBeforeUpdate: (work: () => void) => (beforeUpdate = work),
    fail: () => (isFailing = true),
    removeImageTable: () => (isImageTableMissing = true),
  };
}
