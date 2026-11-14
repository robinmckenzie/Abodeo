// The demo seed endpoint (AD #138 Demo Entry And Seed): GET says whether the
// seed control shows and when the seed was saved, PUT saves it. Only the demo
// account under one of Robin's own labels may save. The label is a cookie the
// browser sets itself, so this is a convenience for Robin, not a lock.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithError,
  respondWithJson,
  withTimeout,
  type ReadSessionUserId,
} from "./account-profile.server";
import type { SeedAppointment } from "../calendar/demo-seed-appointments.server";
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
      const savedAt = canSave
        ? await withTimeout(store.readSavedAt(), timeout)
        : null;
      return respondWithJson(200, {
        canSave,
        savedAt: savedAt?.toISOString() ?? null,
      });
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
