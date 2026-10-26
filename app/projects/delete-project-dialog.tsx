// The "Are you sure?" window for deleting a project (AD #62 Delete Projects),
// over the dashboard or the Bin page. It names the project and lists what
// will be lost, and Cancel has the focus, so that a stray Enter does not
// delete anything.
import { useId, useLayoutEffect, useRef } from "react";

import { describeBinPeriod, listLosses } from "./delete-project";
import { raiseFloatingMessages } from "./floating-messages";
import type { Project } from "./projects";

// "bin" puts a signed-in account's project in the Bin; "permanent" removes a
// binned one at once; "browser" removes a signed-out project, which has no
// Bin to go to.
export type DeleteMode = "bin" | "permanent" | "browser";

export function DeleteProjectDialog({
  project,
  imageCount,
  mode,
  isBusy,
  message,
  onConfirm,
  onCancel,
}: {
  project: Pick<Project, "title" | "tasks">;
  imageCount: number;
  mode: DeleteMode;
  isBusy: boolean;
  // Why the last try failed, if it did.
  message: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const isPermanent = mode === "permanent";

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal?.();
    cancelRef.current?.focus();
    raiseFloatingMessages();
    return () => dialog?.close?.();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="delete-dialog"
      aria-labelledby={headingId}
      // Esc cancels through the page, which then removes the dialog, and
      // closes only this window, not a project open behind it.
      onCancel={(event) => {
        event.preventDefault();
        if (!isBusy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <h2 id={headingId}>
        {isPermanent
          ? `Delete “${project.title}” permanently?`
          : `Delete “${project.title}”?`}
      </h2>
      <p>You will lose:</p>
      <ul>
        {listLosses(project, imageCount).map((loss) => (
          <li key={loss}>{loss}</li>
        ))}
      </ul>
      {mode !== "browser" && (
        <p>
          Its appointments stay in Google Calendar and are no longer shown in
          Abodeo.
        </p>
      )}
      {mode === "bin" && (
        <p>
          You can restore it from the Bin for {describeBinPeriod()}. After that
          it may be removed for good.
        </p>
      )}
      {mode === "browser" && (
        <p>
          You are not signed in, so there is no Bin: the project is removed for
          good.
        </p>
      )}
      {isPermanent && <p>This cannot be undone.</p>}
      {message && (
        <p className="delete-dialog-error" role="alert">
          {message}
        </p>
      )}
      <div className="delete-dialog-buttons">
        <button
          ref={cancelRef}
          type="button"
          className="delete-dialog-cancel"
          disabled={isBusy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="delete-dialog-confirm"
          disabled={isBusy}
          onClick={onConfirm}
        >
          {isPermanent ? "Delete permanently" : "Delete"}
        </button>
      </div>
    </dialog>
  );
}
