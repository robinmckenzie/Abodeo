// When the page reports activity for the visit history (AD #46 Sign-in
// History), kept apart from React so that it can be tested on its own.

// Reports from one tab are at least this far apart. A provisional default.
export const activityReportInterval = 60_000;

// Whether a click or keypress now should be reported. Only activity is
// reported, never the time after it, so an idle open tab adds nothing. A
// clock that has gone back counts as due, so reports do not stop.
export function isActivityReportDue(lastReportAt: number | null, now: number) {
  return (
    lastReportAt === null ||
    now < lastReportAt ||
    now - lastReportAt >= activityReportInterval
  );
}
