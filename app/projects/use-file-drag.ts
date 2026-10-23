// Whether files are being dragged over the page, for the dashboard to show
// where a drop would go, or why it would not (AD #54 Change UX While Dropped
// Images Are Added). Dragging text or a task is left alone.
import { useEffect, useRef, useState } from "react";

// A drag that goes quiet this long has ended, as when it is cancelled with
// Esc, which browsers report differently. A drag over the page sends
// dragover events continually.
export const staleDragDelay = 1000;

export type FileDragOptions = {
  // Why a drop would be refused, or null if it would be accepted. Given the
  // media type of each file, where the browser says (an empty one where not).
  getRefusal: (fileTypes: string[]) => string | null;
  // Said once for a drag that would be refused, and for a drop that arrives
  // without one.
  onRefusal: (message: string) => void;
  onDrop: (files: File[]) => void;
};

export function useFileDrag(options: FileDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [isRefused, setIsRefused] = useState(false);
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

    // While dragging, the browser tells the types of the files but not their
    // names.
    const getFileTypes = (event: DragEvent) =>
      [...(event.dataTransfer?.items ?? [])]
        .filter((item) => item.kind === "file")
        .map((item) => item.type);

    const end = () => {
      depth = 0;
      isActive = false;
      hasSaidRefusal = false;
      clearTimeout(staleTimer);
      setIsDragging(false);
      setIsRefused(false);
    };
    const keepAlive = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(end, staleDragDelay);
    };
    const start = (event: DragEvent) => {
      if (isActive) return;
      isActive = true;
      setIsDragging(true);
      const refusal = optionsRef.current.getRefusal(getFileTypes(event));
      setIsRefused(refusal !== null);
      if (refusal !== null) {
        hasSaidRefusal = true;
        optionsRef.current.onRefusal(refusal);
      }
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      start(event);
      keepAlive();
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Without this the browser would open a dropped file in place of the
      // page.
      event.preventDefault();
      start(event);
      keepAlive();
      // Asked again, as what the drop needs can change during a long drag.
      const isNowRefused =
        optionsRef.current.getRefusal(getFileTypes(event)) !== null;
      setIsRefused(isNowRefused);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = isNowRefused ? "none" : "copy";
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
      const files = [...(event.dataTransfer?.files ?? [])];
      const refusal = optionsRef.current.getRefusal(
        files.map((file) => file.type),
      );
      if (refusal !== null) {
        if (!hadSaidRefusal) optionsRef.current.onRefusal(refusal);
        return;
      }
      optionsRef.current.onDrop(files);
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

  return { isDragging, isRefused };
}
