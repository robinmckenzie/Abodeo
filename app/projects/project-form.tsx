// The Add project form and an opened project's details. Both presentations,
// the floating window and the expanding bar, show this same form, so that
// they behave the same and either can be removed later without touching it.
import { useEffect, useId, useRef } from "react";

import { assignees, hasTitle, type ProjectFields } from "./projects";

export type FormMessage = { text: string; isError: boolean } | null;

export function ProjectForm({
  values,
  isNew,
  message,
  getFocusField,
  onChange,
  onFieldFocus,
  onFieldBlur,
  onCreate,
  onClose,
  hasCloseButton = true,
}: {
  values: ProjectFields;
  isNew: boolean;
  message: FormMessage;
  // The field to focus when the form appears: title, notes or assignee, or
  // "start" for a point just before the title, from which Tab goes into it.
  getFocusField: () => string;
  onChange: (changes: Partial<ProjectFields>) => void;
  onFieldFocus: (name: string) => void;
  onFieldBlur: () => void;
  onCreate: () => void;
  onClose: () => void;
  // False where the container closes the form its own way, as the in-place
  // bar does with its collapse arrow.
  hasCloseButton?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  // Focuses the field on appearing only, not when it changes, and without
  // scrolling, which is left to the container: an expanding bar starts too
  // small to show the field.
  useEffect(() => {
    const field = getFocusField();
    formRef.current
      ?.querySelector<HTMLElement>(
        field === "start"
          ? ".project-form-fields"
          : `[name="${field}"]:is(:checked, :not([type=radio]))`,
      )
      ?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (event.key !== "Escape") return;
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
      <div className="project-form-body">
        <fieldset className="assignee-list">
          <legend>Assigned to</legend>
          {assignees.map((assignee, index) => (
            <label
              key={assignee.id}
              className="assignee-option arrives"
              style={arriveAt(index)}
            >
              <input
                type="radio"
                name="assignee"
                value={assignee.id}
                checked={values.assignee === assignee.id}
                onChange={() => onChange({ assignee: assignee.id })}
              />
              <AssigneeIcon isSelected={values.assignee === assignee.id} />
              <span>{assignee.name}</span>
            </label>
          ))}
        </fieldset>
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
            className="arrives"
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
            className="arrives"
            style={arriveAt(2)}
          >
            Notes
          </label>
          <textarea
            id={`${id}-notes`}
            className="arrives"
            style={arriveAt(3)}
            name="notes"
            rows={8}
            value={values.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
        </div>
      </div>
      <div className="project-form-footer">
        <p
          className={message?.isError ? "project-form-error" : undefined}
          role={message?.isError ? "alert" : "status"}
        >
          {message?.text}
        </p>
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

// As the form appears, parts of it arrive one after another, timed by their
// place in the sequence: the assignees down the left, and alongside them
// the title field, the notes label and the notes box, after the title's
// label, which shows at once with the first assignee.
function arriveAt(place: number) {
  return { "--arrival": place } as React.CSSProperties;
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
