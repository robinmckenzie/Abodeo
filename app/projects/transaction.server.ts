// One database transaction, for the stores whose changes must apply together.
import type { Queryable } from "../account/account-profile.server";

// A database that can also give one connection for a transaction, as the
// Neon pool does.
export type TransactionalDatabase = Queryable & {
  connect(): Promise<Queryable & { release(): void }>;
};

// How long each statement of a transaction may wait, including for the lock
// that stops two devices changing the same thing at once.
export const transactionTimeout = "4s";

// Runs the work in a transaction, which commits when the work returns and is
// rolled back if it throws.
export async function inTransaction<Result>(
  database: TransactionalDatabase,
  work: (client: Queryable) => Promise<Result>,
): Promise<Result> {
  const client = await database.connect();
  try {
    await client.query("begin", []);
    await client.query(
      `set local statement_timeout = '${transactionTimeout}'`,
      [],
    );
    await client.query(`set local lock_timeout = '${transactionTimeout}'`, []);
    const result = await work(client);
    await client.query("commit", []);
    return result;
  } catch (error) {
    await client.query("rollback", []).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
