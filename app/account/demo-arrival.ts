// A new demo visitor's arrival at the welcome screen from /demo (AD #138 Demo
// Entry And Seed): asks the server, in the background, to put the calendar
// back to the seed, so that /demo itself never waits for Google.
import { isDemoArrival } from "./account-api";
import { requestSeedCalendar } from "./account-client";

// Once for each load of the app: in development the welcome screen's effect
// runs twice, and going back to the welcome screen must not ask again. The
// server also does it only once for each /demo.
let isRequested = false;

export function requestSeedCalendarOnArrival(
  search: string,
  request: () => Promise<void> = requestSeedCalendar,
) {
  if (isRequested || !isDemoArrival(search)) return;
  isRequested = true;
  // A failure is left: the server logs it, and the projects still show.
  request().catch(() => undefined);
}
