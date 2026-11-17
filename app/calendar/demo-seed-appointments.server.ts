// The demo seed's appointments (AD #138 Demo Entry And Seed). They are events
// in the demo account's Abodeo calendar in Google, which Abodeo keeps no copy
// of, so saving the seed copies them out and a new visitor's reset puts them
// back, using the demo account's stored access (no browser, no Google page).
import { accountStoreTimeout } from "../account/account-profile.server";
import { appointmentProjectProperty } from "./appointments-api";
import {
  insertAbodeoEvent,
  type CalendarDependencies,
} from "./calendar-handler.server";
import { moveEvent, type DateRule } from "../account/demo-seed-dates";
import { readCalendarAccess } from "./demo-calendar-access.server";
import {
  GoogleCalendarError,
  type CalendarEvent,
} from "./google-calendar.server";

// An appointment of the seed: the event, which names its project. The rule
// (set when the seed is saved) moves its date to the coming one on each reset;
// without one, the event keeps its date.
export type SeedAppointment = {
  projectId: string;
  event: CalendarEvent;
  rule?: DateRule;
};

export type SeedAppointmentDependencies = Pick<
  CalendarDependencies,
  "secret" | "isSecure" | "google" | "calendar" | "store" | "demoAccess"
> & {
  now?: () => number;
  timeout?: number;
  reportFailure?: (stage: string, code: string | undefined) => void;
};

function reportSeedAppointmentFailure(stage: string, code: string | undefined) {
  console.error(
    JSON.stringify({ type: "seed_appointments_failed", stage, code }),
  );
}

function readFailureCode(error: unknown) {
  return error instanceof GoogleCalendarError ? error.code : "unknown";
}

// Google's token from the account's stored access, or undefined if none is
// stored. Throws if access is stored but Google gives no token.
async function readStoredToken(
  dependencies: SeedAppointmentDependencies,
  userId: string,
) {
  const {
    secret,
    isSecure,
    google,
    demoAccess,
    now = Date.now,
    timeout = accountStoreTimeout,
    reportFailure = reportSeedAppointmentFailure,
  } = dependencies;
  const access = await readCalendarAccess({
    cookieHeader: null,
    userId,
    secret,
    isSecure,
    google,
    store: demoAccess.store,
    now: now(),
    timeout,
    reportFailure,
  });
  if (!access.hasStoredAccess) return undefined;
  if (!access.token) throw new GoogleCalendarError("no_stored_token");
  return access.token.accessToken;
}

// The events of the projects, as seed appointments. Empty when no access is
// stored (nothing to copy). Throws if Google will not give them, so that a
// seed is never saved with appointments silently missing.
export async function collectSeedAppointments(
  dependencies: SeedAppointmentDependencies,
  userId: string,
  projectIds: string[],
): Promise<SeedAppointment[]> {
  const accessToken = await readStoredToken(dependencies, userId);
  if (accessToken === undefined) return [];
  const calendarId = await dependencies.store.readCalendarId(userId);
  if (calendarId === undefined) return [];
  const appointments: SeedAppointment[] = [];
  for (const projectId of projectIds) {
    const events = await dependencies.calendar.listEvents(
      accessToken,
      calendarId,
      { name: appointmentProjectProperty, value: projectId },
    );
    for (const { summary, description, start, end } of events) {
      appointments.push({
        projectId,
        event: {
          summary,
          description,
          start,
          end,
          extendedProperties: {
            private: { [appointmentProjectProperty]: projectId },
          },
        },
      });
    }
  }
  return appointments;
}

// Puts the account's calendar back to the seed: every event in it, the
// earlier visitors' among them, is deleted, and the seed's events are added.
// The calendar itself is kept, as Google takes about 7 seconds to make one.
// Does nothing without stored access. A failure is reported and not thrown:
// the visitor still gets in, and the database is already reset.
export async function restoreSeedAppointments(
  dependencies: SeedAppointmentDependencies,
  userId: string,
  appointments: SeedAppointment[],
) {
  const {
    calendar,
    store,
    timeout = accountStoreTimeout,
    now = Date.now,
    reportFailure = reportSeedAppointmentFailure,
  } = dependencies;
  try {
    const accessToken = await readStoredToken(dependencies, userId);
    if (accessToken === undefined) return;
    const restoredAt = now();
    const calendarId = await store.readCalendarId(userId);
    if (calendarId !== undefined) {
      const events = await calendar.listEvents(accessToken, calendarId);
      await Promise.all(
        events.map(({ id }) =>
          calendar.deleteEvent(accessToken, calendarId, id),
        ),
      );
    }
    // One after another: with no calendar yet, the first makes it.
    for (const { event, rule } of appointments) {
      await insertAbodeoEvent({
        accessToken,
        userId,
        timeZone: null,
        event: rule ? moveEvent(event, rule, restoredAt) : event,
        store,
        calendar,
        timeout,
        reportFailure,
      });
    }
  } catch (error) {
    reportFailure("restore", readFailureCode(error));
  }
}
