// The Calendar test between the server and the browser (AD #10 Prove Calendar
// Access). Both sides import it, so it uses neither Node nor browser APIs.

export const calendarBasePath = "/api/calendar";
export const calendarTestAppointmentPath = `${calendarBasePath}/test-appointment`;
export const calendarCallbackPath = `${calendarBasePath}/callback`;

// Google returns the browser to the dashboard with ?calendar=<result>.
export const calendarResultParameter = "calendar";

export const calendarResults = [
  "created",
  // Google's permission was given for a project's appointments (AD #70 Add
  // Appointments To Projects), where nothing is created yet.
  "connected",
  "denied",
  "wrong-account",
  "failed",
] as const;

export type CalendarResult = (typeof calendarResults)[number];

// The start endpoint's answer: Google's address to go to.
export type CalendarStartResponse = { url: string };

// The result in the address, or undefined if there is none or it is not one
// of calendarResults.
export function readCalendarResult(search: string): CalendarResult | undefined {
  const value = new URLSearchParams(search).get(calendarResultParameter);
  return calendarResults.find((result) => result === value);
}

// The address without the Calendar result, keeping any other parameters.
export function removeCalendarResult(search: string) {
  const parameters = new URLSearchParams(search);
  parameters.delete(calendarResultParameter);
  const query = parameters.toString();
  return query ? `?${query}` : "";
}
