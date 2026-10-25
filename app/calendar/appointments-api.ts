// Appointments between the server and the browser (AD #70 Add Appointments
// To Projects). Both sides import it, so it uses neither Node nor browser
// APIs. An appointment is a Google Calendar event: Abodeo keeps no copy.
import { isProjectId } from "../projects/projects-api";
import {
  calendarBasePath,
  calendarResultParameter,
  readCalendarResult,
  type CalendarResult,
} from "./calendar-api";

export const calendarConnectionPath = `${calendarBasePath}/connection`;
export const calendarAppointmentsPath = `${calendarBasePath}/appointments`;

// The private property on each event that links it to its project.
export const appointmentProjectProperty = "abodeoProject";

export const maxTitleLength = 200;
export const maxNotesLength = 5000;

// The dashboard's address when Google returns the browser to a project:
// ?project=<id>, and &appointment=new to open the new appointment form.
export const returnProjectParameter = "project";
export const returnAppointmentParameter = "appointment";
export const returnAppointmentValue = "new";

// What the browser sends to start the grant, apart from the time zone.
export type AppointmentReturnTarget = {
  projectId: string;
  // Whether to open the new appointment form on return.
  openForm: boolean;
};

export type ConnectionResponse = { ready: boolean };

// A project's appointment as the browser shows it. A timed appointment's
// start and end are date-times that name an instant. An all-day
// appointment's are dates, and its end is the day after its last day.
export type Appointment = {
  id: string;
  title: string;
  notes: string;
  allDay: boolean;
  start: string;
  end: string;
};

export type AppointmentsResponse =
  | { status: "ok"; appointments: Appointment[] }
  // No usable token. connectedBefore says whether the account has given
  // Calendar access before, which decides whether to go through Google by
  // itself.
  | { status: "needs-grant"; connectedBefore: boolean }
  | { status: "unavailable" };

// What the form fills in. A timed appointment's start and end are local
// wall times, "YYYY-MM-DDTHH:mm". An all-day appointment's start is a date,
// "YYYY-MM-DD", and its end is not used.
export type AppointmentFields = {
  title: string;
  notes: string;
  allDay: boolean;
  start: string;
  end: string;
};

export type CreateAppointmentRequest = AppointmentFields & {
  projectId: string;
  timeZone: string | null;
};

export type CreateAppointmentError =
  "token_expired" | "invalid" | "unavailable";

export type AppointmentProblem =
  | "title-missing"
  | "title-too-long"
  | "notes-too-long"
  | "start-invalid"
  | "end-invalid"
  | "end-before-start";

const dateShape = /^(\d{4})-(\d{2})-(\d{2})$/;
const wallTimeShape = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isRealDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isDate(value: string) {
  const match = dateShape.exec(value);
  return match !== null && isRealDate(+match[1], +match[2], +match[3]);
}

export function isWallTime(value: string) {
  const match = wallTimeShape.exec(value);
  return (
    match !== null &&
    isRealDate(+match[1], +match[2], +match[3]) &&
    +match[4] < 24 &&
    +match[5] < 60
  );
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

// The day after a date, "YYYY-MM-DD".
export function addOneDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

// An hour after a wall time, "YYYY-MM-DDTHH:mm", or "" if it is not one.
// Plain clock arithmetic: Google places the result in the time zone.
export function addOneHour(wallTime: string) {
  const match = wallTimeShape.exec(wallTime);
  if (!match || !isWallTime(wallTime)) return "";
  const next = new Date(
    Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4] + 1, +match[5]),
  );
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())}`;
}

function countCharacters(text: string) {
  return Array.from(text).length;
}

// The fields cleaned for Google, or the first problem. An all-day
// appointment is one day, so its end becomes the day after (Google's end is
// exclusive).
export function validateAppointmentFields(
  fields: AppointmentFields,
):
  | { ok: true; value: AppointmentFields }
  | { ok: false; problem: AppointmentProblem } {
  const title = fields.title.trim();
  if (!title) return { ok: false, problem: "title-missing" };
  if (countCharacters(title) > maxTitleLength) {
    return { ok: false, problem: "title-too-long" };
  }
  if (countCharacters(fields.notes) > maxNotesLength) {
    return { ok: false, problem: "notes-too-long" };
  }
  const { notes, allDay, start, end } = fields;
  if (allDay) {
    if (!isDate(start)) return { ok: false, problem: "start-invalid" };
    return {
      ok: true,
      value: { title, notes, allDay, start, end: addOneDay(start) },
    };
  }
  if (!isWallTime(start)) return { ok: false, problem: "start-invalid" };
  if (!isWallTime(end)) return { ok: false, problem: "end-invalid" };
  // Both have the same shape, so text order is time order.
  if (end <= start) return { ok: false, problem: "end-before-start" };
  return { ok: true, value: { title, notes, allDay, start, end } };
}

export function describeAppointmentProblem(problem: AppointmentProblem) {
  switch (problem) {
    case "title-missing":
      return "Give the appointment a title.";
    case "title-too-long":
      return `The title can be at most ${maxTitleLength} characters.`;
    case "notes-too-long":
      return `The notes can be at most ${maxNotesLength} characters.`;
    case "start-invalid":
      return "Choose when the appointment starts.";
    case "end-invalid":
      return "Choose when the appointment ends.";
    case "end-before-start":
      return "The appointment must end after it starts.";
  }
}

// Where Google returns the browser: the dashboard, at the project.
export function buildProjectReturnSearch(target: AppointmentReturnTarget) {
  const parameters = new URLSearchParams({
    [returnProjectParameter]: target.projectId,
  });
  if (target.openForm) {
    parameters.set(returnAppointmentParameter, returnAppointmentValue);
  }
  return parameters;
}

export type ProjectReturn = {
  projectId: string;
  openForm: boolean;
  // What Google last said, if the address says.
  result: CalendarResult | undefined;
};

// Where Google returned the browser to, from the dashboard's address, or
// undefined if it did not return to a project.
export function readProjectReturn(search: string): ProjectReturn | undefined {
  const parameters = new URLSearchParams(search);
  const projectId = parameters.get(returnProjectParameter);
  if (!isProjectId(projectId)) return undefined;
  return {
    projectId,
    openForm:
      parameters.get(returnAppointmentParameter) === returnAppointmentValue,
    result: readCalendarResult(search),
  };
}

// The address without the project return, keeping any other parameters.
export function removeProjectReturn(search: string) {
  const parameters = new URLSearchParams(search);
  parameters.delete(returnProjectParameter);
  parameters.delete(returnAppointmentParameter);
  parameters.delete(calendarResultParameter);
  const query = parameters.toString();
  return query ? `?${query}` : "";
}
