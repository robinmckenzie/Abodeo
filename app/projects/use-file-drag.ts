// Whether files are being dragged over the page, for the dashboard to show
// where a drop would go, or why it would not (AD #54 Change UX While Dropped
// Images Are Added). Dragging text or a task is left alone.
import { useEffect, useRef, useState } from "react";

// A drag that goes quiet this long has ended, as when it is cancelled with
// Esc, which browsers report differently. A drag over the page sends
// dragover events continually.
export const staleDragDelay = 1000;

export type FileDragOptions = {
  // Why a drop would be refused, or null if it would be accepted.
  getRefusal: () => string | null;
  // Said once for a drag that would be refused, and for a drop that arrives
  // without one.
  onRefusal: (message: string) => void;
  onDrop: (files: File[]) => void;
};

export function useFileDrag(options: FileDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    let depth = 0;
    let isActive = false;
    let hasSaidRefusal = false;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") === true;

    const end = () => {
      depth = 0;
      isActive = false;
      hasSaidRefusal = false;
      clearTimeout(staleTimer);
      setIsDragging(false);
    };
    const keepAlive = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(end, staleDragDelay);
    };
    const start = () => {
      if (isActive) return;
      isActive = true;
      setIsDragging(true);
      const refusal = optionsRef.current.getRefusal();
      if (refusal !== null) {
        hasSaidRefusal = true;
        optionsRef.current.onRefusal(refusal);
      }
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      start();
      keepAlive();
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Without this the browser would open a dropped file in place of the
      // page.
      event.preventDefault();
      start();
      keepAlive();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect =
          optionsRef.current.getRefusal() === null ? "copy" : "none";
      }
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event) || !isActive) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) end();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const hadSaidRefusal = hasSaidRefusal;
      end();
      const refusal = optionsRef.current.getRefusal();
      if (refusal !== null) {
        if (!hadSaidRefusal) optionsRef.current.onRefusal(refusal);
        return;
      }
      optionsRef.current.onDrop([...(event.dataTransfer?.files ?? [])]);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", end);
    return () => {
      clearTimeout(staleTimer);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", end);
    };
  }, []);

  return { isDragging };
}
