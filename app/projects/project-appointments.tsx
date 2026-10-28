// An opened project's appointments (AD #70 Add Appointments To Projects):
// events in the Abodeo calendar in Google Calendar, shown earliest first
// below the images. Signed out, a project has none, and this says so.
import { useEffect, useId, useState } from "react";

import { PlusIcon } from "../ui/icons";

import {
  addOneHour,
  describeAppointmentProblem,
  maxNotesLength,
  maxTitleLength,
  validateAppointmentFields,
  type Appointment,
  type AppointmentFields,
} from "../calendar/appointments-api";
import type { CalendarResult } from "../calendar/calendar-api";
import {
  useProjectAppointments,
  type AddResult,
  type ProjectAppointmentsOptions,
} from "../calendar/use-project-appointments";

export const signInToAddAppointmentsMessage = "Sign in to add appointments.";
export const appointmentsUnavailableMessage =
  "Appointments cannot be shown right now.";
// What to say in place of the usual invitation to connect, after Google
// returned the browser without a connection.
export function describeReturnResult(
  result: CalendarResult | undefined,
): string | null {
  switch (result) {
    case "denied":
      return "Calendar access was not given, so appointments cannot be shown.";
    case "wrong-account":
      return "Choose the Google account you signed in with to see appointments.";
    case "failed":
      return "Google Calendar could not be connected. Please try again.";
    default:
      return null;
  }
}

export const tokenEndedMessage =
  "Your Google connection has ended. Reconnect and try again.";

// A date or time as "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" in the browser's own
// time zone.
function formatLocalDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function findNextLocalHour(now: Date) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${formatLocalDate(next)}T${pad(next.getHours())}:00`;
}

function readDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// When an appointment is, in the browser's locale and time zone: a date and
// "all day", or a date and start time to end time.
export function describeAppointmentTime(appointment: Appointment) {
  const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  if (appointment.allDay) {
    return `${dateOnly.format(readDate(appointment.start))}, all day`;
  }
  const start = new Date(appointment.start);
  const end = new Date(appointment.end);
  if (Number.isNaN(start.getTime())) return "";
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
  const dateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (Number.isNaN(end.getTime())) return dateTime.format(start);
  const isSameDay = formatLocalDate(start) === formatLocalDate(end);
  return `${dateTime.format(start)} to ${
    isSameDay ? time.format(end) : dateTime.format(end)
  }`;
}

export function ProjectAppointments({
  accountId,
  projectId,
  ...options
}: Omit<ProjectAppointmentsOptions, "accountId"> & {
  // Null while signed out, when appointments are unavailable.
  accountId: string | null;
  // What Google last said when it returned the browser here, if it did.
  returnNote?: string | null;
  // Told how many appointments there are once they are shown, or null when
  // they are not.
  onCountChange?: (count: number | null) => void;
}) {
  if (accountId === null) {
    return (
      <section className="project-appointments" aria-label="Appointments">
        <h3 className="task-heading">Appointments</h3>
        <p className="project-appointments-note">
          {signInToAddAppointmentsMessage}
        </p>
      </section>
    );
  }
  // Keyed, so that a change of account or project starts again.
  return (
    <SignedInAppointments
      key={`${accountId}/${projectId}`}
      accountId={accountId}
      projectId={projectId}
      {...options}
    />
  );
}

function SignedInAppointments({
  returnNote,
  onCountChange,
  ...options
}: ProjectAppointmentsOptions & {
  returnNote?: string | null;
  onCountChange?: (count: number | null) => void;
}) {
  const appointments = useProjectAppointments(options);
  const { state } = appointments;
  const count = state.status === "ready" ? state.appointments.length : null;
  useEffect(() => {
    onCountChange?.(count);
    return () => onCountChange?.(null);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="project-appointments" aria-label="Appointments">
      <div className="project-appointments-header">
        <h3 className="task-heading">Appointments</h3>
        {state.status === "ready" && !appointments.isFormOpen && (
          <button
            type="button"
            className="icon-button project-appointments-add"
            aria-label="Add appointment"
            title="Add appointment"
            onClick={() => void appointments.openForm()}
          >
            <PlusIcon />
          </button>
        )}
      </div>
      {appointments.message && (
        <p className="project-appointments-note" role="alert">
          {appointments.message}
        </p>
      )}
      {state.status === "loading" && (
        <p className="project-appointments-note" role="status">
          Loading appointments…
        </p>
      )}
      {state.status === "connecting" && (
        <p className="project-appointments-note" role="status">
          Connecting to Google Calendar…
        </p>
      )}
      {state.status === "unavailable" && (
        <p className="project-appointments-note" role="alert">
          {appointmentsUnavailableMessage}
        </p>
      )}
      {state.status === "needs-grant" && (
        <>
          <p className="project-appointments-note" role="status">
            {returnNote ??
              "Connect Google Calendar to see and add this project's appointments."}
          </p>
          <button
            type="button"
            className="button-secondary button-small"
            onClick={() => void appointments.reconnect(false)}
          >
            Connect Google Calendar
          </button>
        </>
      )}
      {appointments.isFormOpen && state.status === "ready" && (
        <AppointmentForm
          onAdd={appointments.add}
          onCancel={appointments.closeForm}
          onReconnect={() => void appointments.reconnect(true)}
        />
      )}
      {state.status === "ready" &&
        (state.appointments.length === 0 ? (
          <p className="project-appointments-note">No appointments yet.</p>
        ) : (
          <ul className="appointment-list">
            {state.appointments.map((appointment) => (
              <li key={appointment.id} className="appointment-entry">
                <span className="appointment-title">{appointment.title}</span>
                <span className="appointment-time">
                  {describeAppointmentTime(appointment)}
                </span>
                {appointment.notes && (
                  <span className="appointment-notes">{appointment.notes}</span>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function AppointmentForm({
  onAdd,
  onCancel,
  onReconnect,
}: {
  onAdd: (fields: AppointmentFields) => Promise<AddResult>;
  onCancel: () => void;
  onReconnect: () => void;
}) {
  const id = useId();
  const [initialStart] = useState(() => findNextLocalHour(new Date()));
  const [fields, setFields] = useState<AppointmentFields>({
    title: "",
    notes: "",
    allDay: false,
    start: initialStart,
    end: addOneHour(initialStart),
  });
  // Until the end is chosen, it follows the start by an hour.
  const [isEndChosen, setIsEndChosen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTokenEnded, setIsTokenEnded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const change = (changes: Partial<AppointmentFields>) =>
    setFields((current) => ({ ...current, ...changes }));

  const changeStart = (start: string) =>
    change({ start, ...(isEndChosen ? {} : { end: addOneHour(start) }) });

  // Switching to all-day keeps the day, and back keeps the first time.
  const changeAllDay = (allDay: boolean) => {
    const day = fields.start.slice(0, 10);
    const start = allDay ? day : `${day}T${initialStart.slice(11)}`;
    change({
      allDay,
      start,
      end: allDay ? "" : addOneHour(start),
    });
    setIsEndChosen(false);
  };

  const save = async () => {
    if (isSaving) return;
    const checked = validateAppointmentFields(fields);
    if (!checked.ok) {
      setError(describeAppointmentProblem(checked.problem));
      return;
    }
    setError(null);
    setIsTokenEnded(false);
    setIsSaving(true);
    const result = await onAdd(fields);
    setIsSaving(false);
    if (result.ok) return;
    if (result.reason === "token_expired") {
      setIsTokenEnded(true);
      setError(tokenEndedMessage);
    } else if (result.reason === "invalid") {
      setError("The appointment could not be saved. Check it and try again.");
    } else {
      setError("The appointment could not be saved. Please try again.");
    }
  };

  return (
    // Not a form of its own, as it sits inside the project's form.
    <div
      className="appointment-form"
      role="group"
      aria-label="New appointment"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Cancels the appointment, rather than closing the project.
          event.preventDefault();
          onCancel();
        } else if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <label htmlFor={`${id}-title`}>Appointment title</label>
      <input
        id={`${id}-title`}
        type="text"
        className="field"
        maxLength={maxTitleLength}
        value={fields.title}
        onChange={(event) => change({ title: event.target.value })}
        autoFocus
      />
      <label className="appointment-all-day">
        <input
          type="checkbox"
          className="checkbox"
          checked={fields.allDay}
          onChange={(event) => changeAllDay(event.target.checked)}
        />
        All day
      </label>
      <label htmlFor={`${id}-start`}>{fields.allDay ? "Day" : "Starts"}</label>
      <input
        id={`${id}-start`}
        className="field"
        type={fields.allDay ? "date" : "datetime-local"}
        value={fields.start}
        onChange={(event) => changeStart(event.target.value)}
      />
      {!fields.allDay && (
        <>
          <label htmlFor={`${id}-end`}>Ends</label>
          <input
            id={`${id}-end`}
            className="field"
            type="datetime-local"
            value={fields.end}
            onChange={(event) => {
              setIsEndChosen(true);
              change({ end: event.target.value });
            }}
          />
        </>
      )}
      <label htmlFor={`${id}-notes`}>Notes</label>
      <textarea
        id={`${id}-notes`}
        className="field"
        rows={3}
        maxLength={maxNotesLength}
        value={fields.notes}
        onChange={(event) => change({ notes: event.target.value })}
      />
      {error && (
        <p className="project-appointments-note appointment-error" role="alert">
          {error}
        </p>
      )}
      <div className="appointment-form-buttons">
        <button
          type="button"
          className="button-secondary button-small"
          disabled={isSaving}
          onClick={() => void save()}
        >
          Save
        </button>
        {isTokenEnded && (
          <button
            type="button"
            className="button-secondary button-small"
            onClick={onReconnect}
          >
            Reconnect
          </button>
        )}
        <button
          type="button"
          className="button-secondary button-small"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
