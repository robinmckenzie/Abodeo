// The Add project form and an opened project's details. Both presentations,
// the floating window and the expanding bar, show this same form, so that
// they behave the same and either can be removed later without touching it.
import { useEffect, useId, useRef, useState } from "react";

import { DueDatePicker } from "./due-date-picker";
import {
  isKnownAssignee,
  personNameMaxLength,
  unassignedName,
  type Person,
} from "./people";
import { describePersonFailure, type PersonFailure } from "./people-messages";
import { hasTitle, unassignedId, type ProjectFields } from "./projects";
import { createTasks, readTaskEntries, type Task } from "./tasks";

export type FormMessage = { text: string; isError: boolean } | null;

// How many places the parts of the form arrive in turn. A long list of people
// does not delay the rest.
const maxArrivalPlace = 4;

// Adds a new person and chooses them for the project.
export type AddPerson = (
  name: string,
) => Promise<
  { ok: true; person: Person } | { ok: false; reason: PersonFailure }
>;

export function ProjectForm({
  values,
  isNew,
  isReadOnly = false,
  people,
  onAddPerson,
  projectKey,
  message,
  messageActions,
  getFocusField,
  onChange,
  onFieldFocus,
  onFieldBlur,
  onCreate,
  onClose,
  getCalendarDate,
  onCalendarDateChange,
  hasCloseButton = true,
  tasks,
  images,
  appointments,
}: {
  values: ProjectFields;
  isNew: boolean;
  // While an account's project loads its latest copy, it can be read and
  // closed but not changed.
  isReadOnly?: boolean;
  // Who the project can be assigned to, besides Unassigned (AD #61 Manage
  // People). Without onAddPerson, there is no box to add someone.
  people: readonly Person[];
  onAddPerson?: AddPerson;
  // Tells which project is open, so that a person added while another project
  // is opened is not assigned to it.
  projectKey?: string;
  message: FormMessage;
  // Buttons beside the message, such as for choosing which version to keep.
  messageActions?: React.ReactNode;
  // The field to focus when the form appears: title, notes or assignee, or
  // "start" for a point just before the title, from which Tab goes into it.
  getFocusField: () => string;
  onChange: (changes: Partial<ProjectFields>) => void;
  onFieldFocus: (name: string) => void;
  onFieldBlur: () => void;
  onCreate: () => void;
  onClose: () => void;
  // The calendar's day, kept outside the form, as the field to focus is, so
  // that switching presentation shows the same month and day.
  getCalendarDate?: () => string | null;
  onCalendarDateChange?: (date: string) => void;
  // False where the container closes the form its own way, as the in-place
  // bar does with its collapse arrow.
  hasCloseButton?: boolean;
  // An opened project's tasks, shown below its notes.
  tasks?: React.ReactNode;
  // An opened project's images, shown below its tasks.
  images?: React.ReactNode;
  // An opened project's appointments, shown below its images.
  appointments?: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const onChangeRef = useRef(onChange);
  const projectKeyRef = useRef(projectKey);
  const isMountedRef = useRef(true);
  useEffect(() => {
    onChangeRef.current = onChange;
    projectKeyRef.current = projectKey;
  });
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [calendarDate] = useState(() => getCalendarDate?.() ?? null);
  const options = [{ id: unassignedId, name: unassignedName }, ...people];
  // Someone no longer in the list shows as Unassigned.
  const assigned = isKnownAssignee(people, values.assignee)
    ? values.assignee
    : unassignedId;

  // Focuses the field on appearing only, not when it changes. A new project
  // focuses it without scrolling, as in place its bar scrolls the page to
  // show it, and the browser would otherwise jump to it on the first frame.
  // Of a group sharing a name, such as the assignees or the calendar's days,
  // it focuses the one that Tab would reach.
  useEffect(() => {
    const field = getFocusField();
    formRef.current
      ?.querySelector<HTMLElement>(
        field === "start"
          ? ".project-form-fields"
          : `[name="${field}"]:is(:checked, :not([type=radio])):not([tabindex="-1"])`,
      )
      ?.focus({ preventScroll: isNew });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A field cannot take focus while the form is read-only, so the starting
  // point is focused once it can be changed, unless focus has moved since.
  const wasReadOnlyRef = useRef(isReadOnly);
  useEffect(() => {
    const wasReadOnly = wasReadOnlyRef.current;
    wasReadOnlyRef.current = isReadOnly;
    if (!wasReadOnly || isReadOnly) return;
    const form = formRef.current;
    if (form?.contains(document.activeElement)) return;
    if (document.activeElement && document.activeElement !== document.body) {
      return;
    }
    form
      ?.querySelector<HTMLElement>(".project-form-fields")
      ?.focus({ preventScroll: true });
  }, [isReadOnly]);

  // Only for an opened project, as a new one is saved by Create, and not
  // while a save has failed, which the form reports. It sits under the
  // close button, so goes with it.
  const showsAutosaveNote = hasCloseButton && !isNew && !message?.isError;

  return (
    <form
      ref={formRef}
      className="project-form"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (isNew) onCreate();
      }}
      onKeyDown={(event) => {
        // Not when a field has used Esc itself, as a task's title does to
        // cancel its edit.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
      onFocus={(event) => {
        const name = event.target.getAttribute("name");
        if (name) onFieldFocus(name);
      }}
      onBlur={onFieldBlur}
    >
      <div
        className={
          showsAutosaveNote
            ? "project-form-header has-autosave-note"
            : "project-form-header"
        }
      >
        <h2 id={`${id}-heading`}>{isNew ? "Add project" : "Project"}</h2>
        {hasCloseButton && (
          <div className="project-form-close-area">
            <button
              type="button"
              className="project-form-close"
              aria-label="Close"
              onClick={onClose}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
            {showsAutosaveNote && (
              <p className="project-form-autosave">
                Changes saved <span>automatically.</span>
              </p>
            )}
          </div>
        )}
      </div>
      <div
        className={
          isReadOnly ? "project-form-body is-read-only" : "project-form-body"
        }
        inert={isReadOnly}
      >
        <div className="project-form-side">
          <fieldset className="assignee-list">
            <legend>Assigned to</legend>
            <div className="assignee-options">
              {options.map((assignee, index) => (
                <label
                  key={assignee.id}
                  className="assignee-option arrives-in-turn"
                  style={arriveAt(index)}
                >
                  <input
                    type="radio"
                    name="assignee"
                    value={assignee.id}
                    checked={assigned === assignee.id}
                    onChange={() => onChange({ assignee: assignee.id })}
                    // Unassigned shows as chosen for someone no longer in the
                    // list, so choosing it again changes nothing by itself.
                    onClick={() => {
                      if (
                        assigned === assignee.id &&
                        values.assignee !== assignee.id
                      ) {
                        onChange({ assignee: assignee.id });
                      }
                    }}
                  />
                  <AssigneeIcon isSelected={assigned === assignee.id} />
                  <span>{assignee.name}</span>
                </label>
              ))}
            </div>
            {onAddPerson && (
              <AddPersonBox
                place={options.length}
                onAdd={async (name) => {
                  const startedFor = projectKeyRef.current;
                  const result = await onAddPerson(name);
                  // The latest onChange, as the form may have changed while
                  // the person was being added.
                  if (
                    result.ok &&
                    isMountedRef.current &&
                    projectKeyRef.current === startedFor
                  ) {
                    onChangeRef.current({ assignee: result.person.id });
                  }
                  return result;
                }}
              />
            )}
          </fieldset>
          <DueDatePicker
            value={values.dueDate}
            onChange={(dueDate) => onChange({ dueDate })}
            startDate={calendarDate}
            onActiveDateChange={onCalendarDateChange}
            className="arrives-in-turn"
            style={arriveAt(options.length + (onAddPerson ? 1 : 0))}
          />
        </div>
        {/* Focusable only from code, as the starting point for an opened
            project: Tab goes from it into the title, and screen readers
            announce the project. */}
        <div
          className="project-form-fields"
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
        >
          <label htmlFor={`${id}-title`}>Title</label>
          <input
            id={`${id}-title`}
            className="arrives-in-turn"
            style={arriveAt(1)}
            name="title"
            value={values.title}
            autoComplete="off"
            onChange={(event) => onChange({ title: event.target.value })}
          />
          {!isNew && !hasTitle(values.title) && (
            <p className="project-form-hint">
              A project needs a title, so its last title is kept.
            </p>
          )}
          <label
            htmlFor={`${id}-notes`}
            className="arrives-in-turn"
            style={arriveAt(2)}
          >
            Notes
          </label>
          <textarea
            id={`${id}-notes`}
            className="arrives-in-turn"
            style={arriveAt(3)}
            name="notes"
            rows={8}
            value={values.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
          {isNew && (
            <NewProjectTasks
              tasks={values.tasks}
              onChange={(tasks) => onChange({ tasks })}
            />
          )}
          {tasks}
          {images}
          {appointments}
        </div>
      </div>
      <div className="project-form-footer">
        <p
          className={message?.isError ? "project-form-error" : undefined}
          role={message?.isError ? "alert" : "status"}
        >
          {message?.text}
        </p>
        {messageActions && (
          <div className="project-form-message-actions">{messageActions}</div>
        )}
        {isNew && (
          <>
            <button
              type="button"
              className="project-form-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit">Create</button>
          </>
        )}
      </div>
    </form>
  );
}

// The Add project form's box for tasks, one per line. The project has no
// saved form yet, so the lines only become its tasks when Create saves it.
// The text is kept here, as a line cannot be read back from a task without
// losing what was typed, and starts from the form's tasks so that switching
// presentation keeps it.
function NewProjectTasks({
  tasks,
  onChange,
}: {
  tasks: Task[];
  onChange: (tasks: Task[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() =>
    tasks.map((task) => task.title).join("\n"),
  );
  return (
    <section className="task-section" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="task-heading">
        Tasks
      </h3>
      <textarea
        className="task-entry"
        name="tasks"
        rows={3}
        value={text}
        placeholder="Add tasks, one per line"
        aria-label="Add tasks, one per line"
        onChange={(event) => {
          setText(event.target.value);
          // A new project's tasks all start not done, even if a line is
          // written as a checked box.
          onChange(
            createTasks(
              readTaskEntries(event.target.value).map(({ title }) => ({
                title,
                isDone: false,
              })),
            ),
          );
        }}
      />
    </section>
  );
}

// As the form appears, parts of it arrive one after another, timed by their
// place in the sequence: the assignees down the left, then the calendar
// below them, and alongside them the title field, the notes label and the
// notes box, after the title's label, which shows at once with the first
// assignee.
function arriveAt(place: number) {
  return {
    "--arrival": Math.min(place, maxArrivalPlace),
  } as React.CSSProperties;
}

// A text box below the people, to add someone and choose them at once. Enter
// adds them, and does not create or save the project.
function AddPersonBox({
  place,
  onAdd,
}: {
  place: number;
  onAdd: (
    name: string,
  ) => Promise<{ ok: true } | { ok: false; reason: PersonFailure }>;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<PersonFailure | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const add = async () => {
    if (isAdding) return;
    setIsAdding(true);
    const result = await onAdd(name);
    setIsAdding(false);
    if (result.ok) {
      setName("");
      setProblem(null);
    } else {
      setProblem(result.reason);
    }
  };

  return (
    <div className="assignee-add arrives-in-turn" style={arriveAt(place)}>
      <label htmlFor={id} className="assignee-add-label">
        Add a person
      </label>
      <div className="assignee-add-row">
        <input
          id={id}
          name="new-person"
          value={name}
          maxLength={personNameMaxLength + 10}
          autoComplete="off"
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void add();
          }}
        />
        <button type="button" disabled={isAdding} onClick={() => void add()}>
          Add
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} className="assignee-add-error" role="alert">
          {describePersonFailure(problem)}
        </p>
      )}
    </div>
  );
}

// A thin circle, with a three-line arrow pointing right when selected. The
// radio button it stands for is hidden but still takes focus and keys.
export function AssigneeIcon({ isSelected }: { isSelected: boolean }) {
  return (
    <svg className="assignee-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" />
      {isSelected && (
        <path
          className="assignee-arrow"
          d="M5.5 10h9M11 6.5l3.5 3.5M11 13.5l3.5-3.5"
        />
      )}
    </svg>
  );
}
