// A window in the centre of the screen that asks before something is removed
// (AD #55), in place of the browser's own confirm box at the top of the
// screen. It looks like the delete-project window: the page behind is dimmed,
// the confirm button is red with a bin, and Cancel has the focus, so that a
// stray Enter removes nothing. Esc and Cancel close only this window, not a
// project open behind it.
import { useId, useLayoutEffect, useRef } from "react";

import { raiseFloatingMessages } from "./floating-messages";
import { BinIcon } from "./icons";

export function ConfirmDialog({
  question,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  // The question, as the window's heading.
  question: string;
  // A line under the question, if there is more to say.
  detail?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

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
      className="confirm-dialog"
      aria-labelledby={headingId}
      // Esc cancels through the page, which then removes the dialog, and
      // closes only this window, not a project open behind it. React passes
      // the cancel up to the window it is opened from, even through a portal,
      // so it is stopped here.
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <h2 id={headingId}>{question}</h2>
      {detail && <p>{detail}</p>}
      <div className="confirm-dialog-buttons">
        <button
          ref={cancelRef}
          type="button"
          className="button-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="button" className="button-delete" onClick={onConfirm}>
          <BinIcon />
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
