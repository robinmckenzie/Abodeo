// Stand-ins for Google and the database in the Calendar tests.
import {
  calendarScope,
  type CalendarGoogle,
  type CalendarTokens,
} from "./calendar-grant.server";
import type { CalendarDependencies } from "./calendar-handler.server";
import type { CalendarStore } from "./calendar-store.server";
import type { DemoCalendarAccessStore } from "./demo-calendar-access.server";
import type {
  CalendarEventRecord,
  GoogleCalendar,
} from "./google-calendar.server";
import { GoogleCalendarError } from "./google-calendar.server";

export const testAccessToken = "access-token-never-kept";
export const testIdToken = "id-token-never-kept";
export const testRefreshToken = "refresh-token-kept-only-encrypted";
// The access token Google gives for the stored refresh token.
export const testRefreshedToken = "access-token-from-stored-access";
export const testSecret = "test-secret-that-is-long-enough-for-better-auth";

// Google's Calendar, holding calendars and their events in memory.
export function createMemoryGoogleCalendar() {
  const calendars = new Map<
    string,
    { summary: string; events: CalendarEventRecord[] }
  >();
  const tokensUsed: string[] = [];
  let made = 0;
  let madeEvents = 0;
  const failures: {
    insertCalendar?: string;
    insertEvent?: string;
    listEvents?: string;
    deleteCalendar?: string;
  } = {};
  const fail = (method: keyof typeof failures) => {
    const code = failures[method];
    if (code) throw new GoogleCalendarError(code);
  };
  const calendar: GoogleCalendar = {
    async insertCalendar(accessToken, { summary }) {
      tokensUsed.push(accessToken);
      fail("insertCalendar");
      const id = `calendar-${++made}`;
      calendars.set(id, { summary, events: [] });
      return id;
    },
    async insertEvent(accessToken, calendarId, event) {
      tokensUsed.push(accessToken);
      fail("insertEvent");
      const found = calendars.get(calendarId);
      if (!found) return "not-found";
      const record = { ...event, id: `event-${++madeEvents}` };
      found.events.push(record);
      return record;
    },
    async listEvents(accessToken, calendarId, { name, value }) {
      tokensUsed.push(accessToken);
      fail("listEvents");
      const found = calendars.get(calendarId);
      if (!found) return [];
      const sortKey = (event: CalendarEventRecord) =>
        "date" in event.start ? event.start.date : event.start.dateTime;
      return found.events
        .filter((event) => event.extendedProperties?.private[name] === value)
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    },
    async deleteCalendar(accessToken, calendarId) {
      tokensUsed.push(accessToken);
      fail("deleteCalendar");
      calendars.delete(calendarId);
    },
  };
  return { calendar, calendars, tokensUsed, failures };
}

// The database, in memory. beforeSave runs just before a calendar ID is
// saved, so a test can let another test win the race.
export function createMemoryCalendarStore() {
  const googleAccounts = new Map<string, string>();
  const links = new Map<string, string>();
  const written: string[] = [];
  const hooks: { beforeSave?: () => void; fail?: Error } = {};
  const check = () => {
    if (hooks.fail) throw hooks.fail;
  };
  const store: CalendarStore = {
    async readGoogleAccountId(userId) {
      check();
      return googleAccounts.get(userId);
    },
    async readCalendarId(userId) {
      check();
      return links.get(userId);
    },
    async saveFirstCalendarId(userId, calendarId) {
      check();
      hooks.beforeSave?.();
      written.push(userId, calendarId);
      if (links.has(userId)) return false;
      links.set(userId, calendarId);
      return true;
    },
    async replaceCalendarId(userId, deletedId, calendarId) {
      check();
      hooks.beforeSave?.();
      written.push(userId, deletedId, calendarId);
      if (links.get(userId) !== deletedId) return false;
      links.set(userId, calendarId);
      return true;
    },
  };
  return { store, googleAccounts, links, written, hooks };
}

// The demo account's stored access, in memory.
export function createMemoryDemoAccessStore() {
  const saved: { userId?: string; token?: string; at?: Date } = {};
  const hooks: { fail?: Error } = {};
  const store: DemoCalendarAccessStore = {
    async readRefreshToken(userId) {
      if (hooks.fail) throw hooks.fail;
      return saved.userId === userId ? saved.token : undefined;
    },
    async save(userId, encryptedRefreshToken) {
      saved.userId = userId;
      saved.token = encryptedRefreshToken;
      saved.at = new Date("2026-11-13T10:00:00.000Z");
    },
    readSavedAt: async () => saved.at ?? null,
  };
  return { store, saved, hooks };
}

// Google's grant, answering as a successful consent would.
export function createFakeCalendarGoogle() {
  const answer: { tokens: CalendarTokens; subject: string | undefined } = {
    tokens: {
      accessToken: testAccessToken,
      idToken: testIdToken,
      scopes: ["openid", calendarScope],
      accessTokenExpiresAt: undefined,
    },
    subject: "google-sub-1",
  };
  const exchanges: { code: string; codeVerifier: string }[] = [];
  // The refresh tokens Google was given, and whether it refuses them.
  const refreshes: string[] = [];
  const refresh: { fail?: boolean } = {};
  const google: CalendarGoogle = {
    createAuthorizationURL: async ({
      state,
      codeVerifier,
      loginHint,
      storeAccess,
    }) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", state);
      url.searchParams.set("test_verifier", codeVerifier);
      url.searchParams.set("login_hint", loginHint);
      if (storeAccess) url.searchParams.set("access_type", "offline");
      return url;
    },
    refreshAccessToken: async (refreshToken) => {
      refreshes.push(refreshToken);
      if (refresh.fail) throw new Error("invalid_grant");
      return {
        accessToken: testRefreshedToken,
        accessTokenExpiresAt: undefined,
      };
    },
    exchangeCode: async (input) => {
      exchanges.push(input);
      return answer.tokens;
    },
    readIdTokenSubject: async (idToken) =>
      idToken === testIdToken ? answer.subject : undefined,
  };
  return { google, answer, exchanges, refreshes, refresh };
}

export function createFakeCalendarDependencies() {
  const google = createFakeCalendarGoogle();
  const calendar = createMemoryGoogleCalendar();
  const store = createMemoryCalendarStore();
  const demoAccess = createMemoryDemoAccessStore();
  // Who may store the demo account's access: nobody, until a test says.
  const demoManagers = new Set<string>();
  // The accounts' projects, as "userId/projectId".
  const projects = new Set<string>();
  const dependencies: CalendarDependencies = {
    secret: testSecret,
    isSecure: false,
    google: google.google,
    calendar: calendar.calendar,
    store: store.store,
    demoAccess: {
      store: demoAccess.store,
      canManage: async (_headers, userId) => demoManagers.has(userId),
    },
    hasProject: async (userId, projectId) =>
      projects.has(`${userId}/${projectId}`),
  };
  return {
    dependencies,
    google,
    calendar,
    store,
    demoAccess,
    demoManagers,
    projects,
  };
}
