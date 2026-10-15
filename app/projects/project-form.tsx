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
}: {
  values: ProjectFields;
  isNew: boolean;
  message: FormMessage;
  // The field to focus when the form appears: title, notes or assignee.
  getFocusField: () => string;
  onChange: (changes: Partial<ProjectFields>) => void;
  onFieldFocus: (name: string) => void;
  onFieldBlur: () => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  // Focuses the field on appearing only, not when it changes.
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLElement>(
        `[name="${getFocusField()}"]:is(:checked, :not([type=radio]))`,
      )
      ?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        className={isNew ? "project-form-header is-new" : "project-form-header"}
      >
        <h2 id={`${id}-heading`}>{isNew ? "Add project" : "Project"}</h2>
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
          {/* Only for an opened project, as a new one is saved by Create,
              and not while a save has failed, which the form reports. */}
          {!isNew && !message?.isError && (
            <p className="project-form-autosave">
              Changes saved <span>automatically.</span>
            </p>
          )}
        </div>
      </div>
      <div className="project-form-body">
        <fieldset className="assignee-list">
          <legend>Assigned to</legend>
          {assignees.map((assignee) => (
            <label key={assignee.id} className="assignee-option">
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
        <div className="project-form-fields">
          <label htmlFor={`${id}-title`}>Title</label>
          <input
            id={`${id}-title`}
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
          <label htmlFor={`${id}-notes`}>Notes</label>
          <textarea
            id={`${id}-notes`}
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
        {isNew && <button type="submit">Create</button>}
      </div>
    </form>
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
