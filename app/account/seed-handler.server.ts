// The demo seed endpoints (AD #138 Demo Entry And Seed).
// - accountSeedPath: GET says whether the seed control shows and what the
//   saved seed holds, PUT saves it. Only the demo account under one of Robin's
//   own labels may save. The label is a cookie the browser sets itself, so
//   this is a convenience for Robin, not a lock.
// - accountSeedCalendarPath: POST puts the seed's appointments back in the
//   calendar, once after a new visitor's /demo, which leaves a cookie to say
//   that it is due.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithError,
  respondWithJson,
  withTimeout,
  type ReadSessionUserId,
} from "./account-profile.server";
import type { SeedAppointment } from "../calendar/demo-seed-appointments.server";
import type { SeedCalendarResponse, SeedStatusResponse } from "./account-api";
import { clearCalendarDueCookie, isCalendarDue } from "./demo-sign-in.server";
import {
  SeedTooLargeError,
  type DemoSeedStore,
} from "./demo-seed-store.server";
import { readLabel } from "./usage-label.server";

// Whether this is Robin in the demo account: the session is the demo account
// and the label cookie is one of Robin's own labels.
export async function canManageDemo(
  headers: Headers,
  userId: string,
  {
    store,
    ignoredLabels,
  }: { store: Pick<DemoSeedStore, "isDemoAccount">; ignoredLabels: string[] },
) {
  return (
    ignoredLabels.includes(readLabel(headers).toLowerCase()) &&
    (await store.isDemoAccount(userId))
  );
}

export type SeedRequestDependencies = {
  readSessionUserId: ReadSessionUserId;
  store: DemoSeedStore;
  // Robin's own labels, lower case.
  ignoredLabels: string[];
  // The appointments of the projects, copied out of Google Calendar (AD #138).
  collectAppointments: (
    userId: string,
    projectIds: string[],
  ) => Promise<SeedAppointment[]>;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

function reportSeedFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_seed_failed", code }));
}

export async function handleSeedRequest(
  request: Request,
  {
    readSessionUserId,
    store,
    ignoredLabels,
    collectAppointments,
    timeout = accountStoreTimeout,
    reportFailure = reportSeedFailure,
  }: SeedRequestDependencies,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "PUT") {
    return respondWithError(405, "method_not_allowed");
  }
  try {
    const userId = await withTimeout(
      readSessionUserId(request.headers),
      timeout,
    );
    if (userId === undefined) return respondWithError(401, "not_signed_in");
    const canSave = await withTimeout(
      canManageDemo(request.headers, userId, { store, ignoredLabels }),
      timeout,
    );
    if (request.method === "GET") {
      const seed = canSave
        ? await withTimeout(store.readSaved(), timeout)
        : null;
      return respondWithJson(200, {
        canSave,
        seed,
      } satisfies SeedStatusResponse);
    }
    if (!canSave) return respondWithError(403, "not_allowed");
    const projectIds = await withTimeout(store.readProjectIds(userId), timeout);
    // Google can be slow, so it has its own limits rather than this one.
    const appointments = await collectAppointments(userId, projectIds);
    return respondWithJson(
      200,
      await withTimeout(store.save(userId, appointments), timeout),
    );
  } catch (error) {
    if (error instanceof SeedTooLargeError) {
      return respondWithError(413, "seed_too_large");
    }
    reportFailure(readErrorCode(error));
    return respondWithError(503, "unavailable");
  }
}

export type SeedCalendarDependencies = {
  readSessionUserId: ReadSessionUserId;
  store: Pick<DemoSeedStore, "isDemoAccount" | "readAppointments">;
  // Puts the calendar back to the appointments. Reports its own failures.
  restoreAppointments: (
    userId: string,
    appointments: SeedAppointment[],
  ) => Promise<void>;
  timeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

// Puts the demo account's calendar back to the seed, if a new visitor's /demo
// left it due, and marks it done so that a later request (such as Back to the
// welcome screen) leaves the visitor's own appointments alone.
export async function handleSeedCalendarRequest(
  request: Request,
  {
    readSessionUserId,
    store,
    restoreAppointments,
    timeout = accountStoreTimeout,
    reportFailure = reportSeedFailure,
  }: SeedCalendarDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return respondWithError(405, "method_not_allowed");
  }
  try {
    const userId = await withTimeout(
      readSessionUserId(request.headers),
      timeout,
    );
    if (userId === undefined) return respondWithError(401, "not_signed_in");
    const restored =
      isCalendarDue(request.headers) &&
      (await withTimeout(store.isDemoAccount(userId), timeout));
    if (restored) {
      // Google can be slow, so it has its own limits rather than this one.
      await restoreAppointments(
        userId,
        await withTimeout(store.readAppointments(), timeout),
      );
    }
    const response = respondWithJson(200, {
      restored,
    } satisfies SeedCalendarResponse);
    if (restored) {
      response.headers.append(
        "Set-Cookie",
        clearCalendarDueCookie(new URL(request.url).protocol === "https:"),
      );
    }
    return response;
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithError(503, "unavailable");
  }
}
