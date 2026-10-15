// A project's horizontal bar on the dashboard. In the in-place presentation,
// an opened project's bar expands to show the form instead.
import { useImperativeHandle, useLayoutEffect, useRef } from "react";

import { findAssigneeName, type Project } from "./projects";

// How long the expanded bar takes to expand or squash back up.
const resizeDuration = 300;

export function ProjectBar({
  project,
  hasUnsavedChanges,
  onOpen,
}: {
  project: Project;
  hasUnsavedChanges: boolean;
  // Given the bar's height, so that an expanded bar can grow from it.
  onOpen: (barHeight: number) => void;
}) {
  const assigneeName = findAssigneeName(project.assignee);
  // Screen readers hear the title first, and not the notes preview, whose
  // notes they read once the project is opened.
  const label = [
    project.title,
    assigneeName,
    hasUnsavedChanges && "last changes not saved",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="project-bar">
      <button
        type="button"
        data-project-id={project.id}
        aria-label={label}
        onClick={(event) => onOpen(event.currentTarget.offsetHeight)}
      >
        <span className="project-bar-assignee">{assigneeName}</span>
        <span className="project-bar-text">
          <span className="project-bar-title">{project.title}</span>
          {project.notes.trim() && (
            <span className="project-bar-notes">{project.notes}</span>
          )}
        </span>
        {hasUnsavedChanges && (
          <span className="project-bar-unsaved">Last changes not saved</span>
        )}
      </button>
    </li>
  );
}

// Expands from the collapsed bar's height to show the form, and is closed
// by squashing back to that height, with an upward arrow at the bottom
// centre or Esc, rather than the form's close button. The arrow is the
// assignee icon's, turned to point up, without its circle. The squash is
// also offered through ref, for the form's own closing, such as by Esc.
// With reduce motion, neither is animated.
export type ExpandedProjectBarHandle = { squash: () => void };

export function ExpandedProjectBar({
  ref,
  barHeight,
  onCollapse,
  children,
}: {
  ref?: React.Ref<ExpandedProjectBarHandle>;
  // The collapsed bar's height, or 0 for a new project, which has none.
  barHeight: number;
  onCollapse: () => void;
  children: React.ReactNode;
}) {
  const barRef = useRef<HTMLLIElement>(null);
  const isSquashingRef = useRef(false);
  const isMountedRef = useRef(false);

  useLayoutEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !canAnimate(bar)) return;
    const height = bar.offsetHeight;
    bar.animate(
      [
        { height: `${barHeight}px`, overflow: "hidden" },
        { height: `${height}px`, overflow: "hidden" },
      ],
      { duration: resizeDuration, easing: "ease-out" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const squash = () => {
    const bar = barRef.current;
    if (isSquashingRef.current) return;
    if (!bar || !canAnimate(bar)) {
      onCollapse();
      return;
    }
    isSquashingRef.current = true;
    bar
      .animate(
        [
          { height: `${bar.offsetHeight}px`, overflow: "hidden" },
          { height: `${barHeight}px`, overflow: "hidden" },
        ],
        { duration: resizeDuration, easing: "ease-in", fill: "forwards" },
      )
      // Closes only if this bar is still open: another project opened
      // during the squash has already closed it, and must stay open.
      .finished.then(
        () => {
          if (isMountedRef.current) onCollapse();
        },
        () => {},
      );
  };

  useImperativeHandle(ref, () => ({ squash }));

  return (
    <li
      ref={barRef}
      className="project-bar is-expanded"
      // Esc from the arrow; the form handles Esc inside it.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        squash();
      }}
    >
      {children}
      <button
        type="button"
        className="project-bar-collapse"
        aria-label="Close"
        onClick={squash}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 14.5v-9M6.5 9l3.5-3.5M13.5 9l-3.5-3.5" />
        </svg>
      </button>
    </li>
  );
}

function canAnimate(element: HTMLElement) {
  return (
    typeof element.animate === "function" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
