// A signed-in account's list of people, in the account_people table of
// db/account-tables.sql (AD #61 Manage People). One row holds the account's
// whole ordered list. Every query is limited to the account it is given, which
// only the handler decides, from the sign-in. Changes lock the row until they
// are done, so that two devices changing the list, or a project being
// assigned as someone is removed, take turns.
import type { Queryable } from "../account/account-profile.server";
import {
  addPerson,
  derivePeopleFromProjects,
  readPeople,
  removePerson,
  renamePerson,
  serialisePeople,
  startingPeople,
  type ListChange,
  type Person,
} from "./people";
import type {
  PeopleInvalidName,
  PeopleOperation,
  PeopleResponse,
} from "./people-api";
import { parseProject } from "./projects";
import {
  inTransaction,
  type TransactionalDatabase,
} from "./transaction.server";

export type PeopleOutcome =
  | { kind: "done"; people: Person[]; revision: number }
  | { kind: "preview"; count: number; unreadable: number }
  | { kind: "invalid-name"; problem: PeopleInvalidName }
  | { kind: "duplicate" }
  | { kind: "not-found" }
  | { kind: "count-changed"; count: number; unreadable: number }
  // The saved list cannot be read: damaged, or from a later version.
  | { kind: "unreadable" };

export type PeopleStore = {
  // Never writes. With no list saved yet, gives the people the account's
  // projects are assigned to.
  read(userId: string): Promise<PeopleResponse | "unreadable">;
  apply(userId: string, operation: PeopleOperation): Promise<PeopleOutcome>;
};

const startingIds = startingPeople.map(({ id }) => id);

function readStoredProject(id: string, data: unknown) {
  return parseProject(id, JSON.stringify(data ?? null));
}

// Of the people lists began with before they could be changed, those the
// account's readable projects are assigned to.
export async function deriveAccountPeople(query: Queryable, userId: string) {
  const { rows } = await query.query(
    `select id, data from project
     where user_id = $1 and data->>'assignee' = any($2::text[])`,
    [userId, startingIds],
  );
  const projects = rows
    .map((row) => readStoredProject(String(row.id), row.data))
    .filter((project) => project !== null);
  return derivePeopleFromProjects(projects);
}

// The people an assignment may name: the saved list, or with none saved yet,
// those the projects are already assigned to. A list that cannot be read has
// nobody. With lock, the row is held until the transaction ends, so that the
// list cannot be changed between this and the write that follows.
// Held until the transaction ends. It is taken before the people row, which
// may not exist yet, so that making the first list and anything that depends
// on the list being absent take their turns.
export async function lockAccountPeople(query: Queryable, userId: string) {
  await query.query("select pg_advisory_xact_lock(hashtext($1 || ':people'))", [
    userId,
  ]);
}

export async function readAccountPeople(
  query: Queryable,
  userId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<Person[]> {
  if (lock) await lockAccountPeople(query, userId);
  const { rows } = await query.query(
    `select data from account_people where user_id = $1${lock ? " for share" : ""}`,
    [userId],
  );
  if (rows.length === 0) return deriveAccountPeople(query, userId);
  return readPeople(rows[0].data) ?? [];
}

type LockedList =
  | { kind: "found"; people: Person[]; revision: number }
  | { kind: "unreadable" };

// The saved list, locked, made first from the projects if there is none.
async function lockList(
  client: Queryable,
  userId: string,
): Promise<LockedList> {
  await lockAccountPeople(client, userId);
  const select = () =>
    client.query(
      `select data, revision from account_people
       where user_id = $1 for update`,
      [userId],
    );
  let { rows } = await select();
  if (rows.length === 0) {
    await client.query(
      `insert into account_people (user_id, data) values ($1, $2::jsonb)
       on conflict (user_id) do nothing`,
      [userId, serialisePeople(await deriveAccountPeople(client, userId))],
    );
    ({ rows } = await select());
  }
  const people = readPeople(rows[0].data);
  return people
    ? { kind: "found", people, revision: Number(rows[0].revision) }
    : { kind: "unreadable" };
}

async function saveList(client: Queryable, userId: string, people: Person[]) {
  const { rows } = await client.query(
    `update account_people set data = $2::jsonb, revision = revision + 1
     where user_id = $1 returning revision`,
    [userId, serialisePeople(people)],
  );
  return Number(rows[0].revision);
}

function describeProblem(
  change: Extract<ListChange, { ok: false }>,
): PeopleOutcome {
  if (change.problem === "duplicate") return { kind: "duplicate" };
  if (change.problem === "not-found") return { kind: "not-found" };
  return { kind: "invalid-name", problem: change.problem };
}

export function createPeopleStore(
  database: TransactionalDatabase,
  {
    prepare,
  }: {
    // Runs before the list is first made from the projects, such as to bring
    // the default projects up to date, so that those are what count.
    prepare?: (userId: string) => Promise<unknown>;
  } = {},
): PeopleStore {
  // The readable and unreadable projects assigned to the person.
  const findAssigned = async (query: Queryable, userId: string, id: string) => {
    const { rows } = await query.query(
      `select id, data from project
       where user_id = $1 and data->>'assignee' = $2 for update`,
      [userId, id],
    );
    const readable: string[] = [];
    for (const row of rows) {
      if (readStoredProject(String(row.id), row.data)) {
        readable.push(String(row.id));
      }
    }
    return { readable, unreadable: rows.length - readable.length };
  };

  const preview = async (
    userId: string,
    id: string,
  ): Promise<PeopleOutcome> => {
    const people = await readAccountPeople(database, userId);
    if (!people.some((person) => person.id === id)) {
      return { kind: "preview", count: 0, unreadable: 0 };
    }
    const { rows } = await database.query(
      `select id, data from project
       where user_id = $1 and data->>'assignee' = $2`,
      [userId, id],
    );
    const count = rows.filter((row) =>
      readStoredProject(String(row.id), row.data),
    ).length;
    return { kind: "preview", count, unreadable: rows.length - count };
  };

  const removeFrom = async (
    client: Queryable,
    userId: string,
    locked: Extract<LockedList, { kind: "found" }>,
    id: string,
    expectedCount: number | undefined,
  ): Promise<PeopleOutcome> => {
    // Already removed, as by an earlier try whose answer was lost.
    if (!locked.people.some((person) => person.id === id)) {
      return { kind: "done", people: locked.people, revision: locked.revision };
    }
    const { readable, unreadable } = await findAssigned(client, userId, id);
    if (expectedCount !== undefined && expectedCount !== readable.length) {
      return { kind: "count-changed", count: readable.length, unreadable };
    }
    if (readable.length > 0) {
      await client.query(
        `update project
         set data = jsonb_set(data, '{assignee}', '"unassigned"'::jsonb),
             revision = revision + 1
         where user_id = $1
         and id in (select jsonb_array_elements_text($2::jsonb))`,
        [userId, JSON.stringify(readable)],
      );
    }
    const people = removePerson(locked.people, id);
    return {
      kind: "done",
      people,
      revision: await saveList(client, userId, people),
    };
  };

  return {
    async read(userId) {
      await prepare?.(userId);
      const { rows } = await database.query(
        "select data, revision from account_people where user_id = $1",
        [userId],
      );
      if (rows.length === 0) {
        return {
          people: await deriveAccountPeople(database, userId),
          revision: 0,
          established: false,
        };
      }
      const people = readPeople(rows[0].data);
      return people
        ? { people, revision: Number(rows[0].revision), established: true }
        : "unreadable";
    },

    async apply(userId, operation) {
      await prepare?.(userId);
      if (operation.op === "remove" && operation.dryRun) {
        return preview(userId, operation.id);
      }
      return inTransaction(database, async (client) => {
        const locked = await lockList(client, userId);
        if (locked.kind === "unreadable") return { kind: "unreadable" };
        switch (operation.op) {
          case "establish":
            return {
              kind: "done",
              people: locked.people,
              revision: locked.revision,
            };
          case "remove":
            return removeFrom(
              client,
              userId,
              locked,
              operation.id,
              operation.expectedCount,
            );
          case "add":
          case "rename": {
            const change =
              operation.op === "add"
                ? addPerson(locked.people, operation.id, operation.name)
                : renamePerson(locked.people, operation.id, operation.name);
            if (!change.ok) return describeProblem(change);
            const isChanged =
              serialisePeople(change.people) !== serialisePeople(locked.people);
            return {
              kind: "done",
              people: change.people,
              revision: isChanged
                ? await saveList(client, userId, change.people)
                : locked.revision,
            };
          }
        }
      });
    },
  };
}
