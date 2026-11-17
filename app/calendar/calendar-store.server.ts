// What the Calendar test reads and keeps in the database: the ID of each
// account's Abodeo calendar, in the calendar_link table of
// db/account-tables.sql, and the Google account ID that sign-in saved.
// Nothing from Google's tokens is ever passed here.
export type CalendarStore = {
  // The Google account ID saved at sign-in, or undefined if there is none.
  readGoogleAccountId(userId: string): Promise<string | undefined>;
  readCalendarId(userId: string): Promise<string | undefined>;
  // Saves the account's first calendar, unless another test saved one first.
  // True if this one was saved.
  saveFirstCalendarId(userId: string, calendarId: string): Promise<boolean>;
  // Replaces a calendar that no longer exists, unless another test replaced
  // it first. True if this one was saved.
  replaceCalendarId(
    userId: string,
    deletedId: string,
    calendarId: string,
  ): Promise<boolean>;
};

// The part of a Postgres pool that the store uses.
type Queryable = {
  query(
    text: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

export function createCalendarStore(database: Queryable): CalendarStore {
  const readText = async (text: string, userId: string, column: string) => {
    const { rows } = await database.query(text, [userId]);
    const value = rows[0]?.[column];
    return typeof value === "string" ? value : undefined;
  };
  return {
    readGoogleAccountId: (userId) =>
      readText(
        `select account_id from auth_account
         where user_id = $1 and provider_id = 'google'`,
        userId,
        "account_id",
      ),
    readCalendarId: (userId) =>
      readText(
        "select calendar_id from calendar_link where user_id = $1",
        userId,
        "calendar_id",
      ),
    async saveFirstCalendarId(userId, calendarId) {
      const { rowCount } = await database.query(
        `insert into calendar_link (user_id, calendar_id) values ($1, $2)
         on conflict (user_id) do nothing`,
        [userId, calendarId],
      );
      return rowCount === 1;
    },
    async replaceCalendarId(userId, deletedId, calendarId) {
      const { rowCount } = await database.query(
        `update calendar_link set calendar_id = $3, updated_at = now()
         where user_id = $1 and calendar_id = $2`,
        [userId, deletedId, calendarId],
      );
      return rowCount === 1;
    },
  };
}
