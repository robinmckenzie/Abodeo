// A task's photos (AD #67 Add Photos To Tasks), in a window over the project,
// titled with the task's name. It holds the same timeline as the project's
// images: oldest first, each with the time it was added and a caption, and
// the full-size viewer opens on top, stepping only through this task's
// photos.
import { useId, useLayoutEffect, useRef, type RefObject } from "react";

import { raiseFloatingMessages } from "../ui/floating-messages";
import { CloseIcon } from "../ui/icons";
import type { ImageFailure } from "./images-client";
import {
  ImageTimeline,
  taskPhotosWording,
  type AddFiles,
} from "./project-images";
import type { StorageUsageRef } from "./use-project-images";

export function TaskPhotosDialog({
  accountId,
  projectId,
  taskId,
  taskTitle,
  filesToAdd,
  onFilesTaken,
  addFilesRef,
  usageRef,
  onSummaryChange,
  onFailure,
  onMessage,
  onClose,
}: {
  accountId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  // Files chosen or dropped on the task's row, added once open.
  filesToAdd: File[] | null;
  onFilesTaken: () => void;
  // For files dropped while it is open.
  addFilesRef: RefObject<AddFiles | null>;
  // The account's storage use, shared with the project's images.
  usageRef: StorageUsageRef;
  onSummaryChange: (count: number, latestImageId: string | null) => void;
  onFailure?: (reason: ImageFailure) => void;
  onMessage?: (text: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal?.();
    raiseFloatingMessages();
    return () => dialog?.close?.();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="task-photos-dialog"
      aria-labelledby={headingId}
      // The close event comes after the dialog's cleanup in development, when
      // an effect runs twice, so it counts only if the dialog is still shut.
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // Esc closes only this window, not the project behind it.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <div className="task-photos-dialog-body">
        <div className="task-photos-dialog-header">
          <h2 id={headingId}>{taskTitle}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close photos"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <ImageTimeline
          accountId={accountId}
          projectId={projectId}
          taskId={taskId}
          wording={taskPhotosWording}
          filesToAdd={filesToAdd}
          onFilesTaken={onFilesTaken}
          addFilesRef={addFilesRef}
          usageRef={usageRef}
          onSummaryChange={onSummaryChange}
          onFailure={onFailure}
          onMessage={onMessage}
        />
      </div>
    </dialog>
  );
}
