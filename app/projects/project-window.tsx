// The floating-window presentation: the form in a dialog centred over the
// dashboard, which keeps focus inside it while it is open.
import { useLayoutEffect, useRef } from "react";

export function ProjectWindow({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Opens before the form focuses its first field, which it could not do in
  // a closed dialog.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="project-window"
      // Esc closes the project through the dashboard, which then removes
      // the dialog, rather than the browser closing it directly.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
