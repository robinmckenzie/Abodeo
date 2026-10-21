// Stand-ins for Google and the database in the Calendar tests.
import {
  calendarScope,
  type CalendarGoogle,
  type CalendarTokens,
} from "./calendar-grant.server";
import type { CalendarDependencies } from "./calendar-handler.server";
import type { CalendarStore } from "./calendar-store.server";
import type { CalendarEvent, GoogleCalendar } from "./google-calendar.server";
import { GoogleCalendarError } from "./google-calendar.server";

export const testAccessToken = "access-token-never-kept";
export const testIdToken = "id-token-never-kept";
export const testSecret = "test-secret-that-is-long-enough-for-better-auth";

// Google's Calendar, holding calendars and their events in memory.
export function createMemoryGoogleCalendar() {
  const calendars = new Map<
    string,
    { summary: string; events: CalendarEvent[] }
  >();
  const tokensUsed: string[] = [];
  let made = 0;
  const failures: {
    insertCalendar?: string;
    insertEvent?: string;
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
      found.events.push(event);
      return "created";
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

// Google's grant, answering as a successful consent would.
export function createFakeCalendarGoogle() {
  const answer: { tokens: CalendarTokens; subject: string | undefined } = {
    tokens: {
      accessToken: testAccessToken,
      idToken: testIdToken,
      scopes: ["openid", calendarScope],
    },
    subject: "google-sub-1",
  };
  const exchanges: { code: string; codeVerifier: string }[] = [];
  const google: CalendarGoogle = {
    createAuthorizationURL: async ({ state, codeVerifier, loginHint }) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", state);
      url.searchParams.set("test_verifier", codeVerifier);
      url.searchParams.set("login_hint", loginHint);
      return url;
    },
    exchangeCode: async (input) => {
      exchanges.push(input);
      return answer.tokens;
    },
    readIdTokenSubject: async (idToken) =>
      idToken === testIdToken ? answer.subject : undefined,
  };
  return { google, answer, exchanges };
}

export function createFakeCalendarDependencies() {
  const google = createFakeCalendarGoogle();
  const calendar = createMemoryGoogleCalendar();
  const store = createMemoryCalendarStore();
  const dependencies: CalendarDependencies = {
    secret: testSecret,
    isSecure: false,
    google: google.google,
    calendar: calendar.calendar,
    store: store.store,
  };
  return { dependencies, google, calendar, store };
}
