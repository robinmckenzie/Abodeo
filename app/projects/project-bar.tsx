// A project's horizontal bar on the dashboard. In the in-place presentation,
// an opened project's bar expands to show the form instead.
import { useImperativeHandle, useLayoutEffect, useRef } from "react";

import { findAssigneeName, type Project } from "./projects";

// Expanding starts at about the speed of a plain 0.3-second ease-out, then
// slows gradually to a gentle stop, on a stronger ease-out curve. Squashing
// back up speeds up as it goes.
const expandTiming = {
  duration: 500,
  easing: "cubic-bezier(0.33, 1, 0.68, 1)",
};
const squashTiming = { duration: 300, easing: "ease-in" };

// The expanding curve, for scrolling alongside it.
function easeExpanding(t: number) {
  return 1 - (1 - t) ** 3;
}

export function ProjectBar({
  project,
  hasUnsavedChanges,
  isInert = false,
  onOpen,
}: {
  project: Project;
  hasUnsavedChanges: boolean;
  // While a new project is being added in place, so that a click cannot
  // open another project and lose what was typed.
  isInert?: boolean;
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
    <li className="project-bar" inert={isInert}>
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
// With reduce motion, neither is animated. While animating, the bar clips
// its content with overflow: clip rather than hidden, which cannot scroll,
// so focusing the title as the bar opens does not scroll the heading out
// of sight. A bar marked as closing, because another project was opened,
// squashes straight away, and cannot be used while it does. A new project's
// bar has no arrow, as Cancel closes it. It is added at the end of the
// list, so the page scrolls to its end as the bar expands, to show it.
export type ExpandedProjectBarHandle = { squash: () => void };

export function ExpandedProjectBar({
  ref,
  barHeight,
  isClosing = false,
  hasCollapseButton = true,
  scrollsToPageEnd = false,
  onCollapse,
  children,
}: {
  ref?: React.Ref<ExpandedProjectBarHandle>;
  // The collapsed bar's height, or 0 for a new project, which has none.
  barHeight: number;
  isClosing?: boolean;
  hasCollapseButton?: boolean;
  scrollsToPageEnd?: boolean;
  onCollapse: () => void;
  children: React.ReactNode;
}) {
  const barRef = useRef<HTMLLIElement>(null);
  const isSquashingRef = useRef(false);
  const isMountedRef = useRef(false);
  // The latest, as a bar squashing when another project opens changes from
  // closing its project to finishing its own closing.
  const onCollapseRef = useRef(onCollapse);

  useLayoutEffect(() => {
    onCollapseRef.current = onCollapse;
  });

  useLayoutEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!scrollsToPageEnd) return;
    const page = document.scrollingElement;
    const bar = barRef.current;
    if (!page || !bar) return;
    if (!canAnimate(bar)) {
      page.scrollTop = page.scrollHeight;
      return;
    }
    // Follows the end of the page as the bar grows, arriving with it.
    const start = page.scrollTop;
    const startTime = performance.now();
    let frame = 0;
    const follow = () => {
      const t = Math.min(
        (performance.now() - startTime) / expandTiming.duration,
        1,
      );
      const end = page.scrollHeight - page.clientHeight;
      page.scrollTop = start + (end - start) * easeExpanding(t);
      if (t < 1) frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !canAnimate(bar)) return;
    const height = bar.offsetHeight;
    const expanding = bar.animate(
      [
        { height: `${barHeight}px`, overflow: "clip" },
        { height: `${height}px`, overflow: "clip" },
      ],
      expandTiming,
    );
    // Cancelled if the effect is undone, as React does once in development,
    // so that running again measures the full height rather than the
    // animation's starting one.
    return () => expanding.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const squash = () => {
    const bar = barRef.current;
    if (isSquashingRef.current) return;
    if (!bar || !canAnimate(bar)) {
      onCollapseRef.current();
      return;
    }
    isSquashingRef.current = true;
    bar
      .animate(
        [
          { height: `${bar.offsetHeight}px`, overflow: "clip" },
          { height: `${barHeight}px`, overflow: "clip" },
        ],
        { ...squashTiming, fill: "forwards" },
      )
      // Closes only if this bar is still shown.
      .finished.then(
        () => {
          if (isMountedRef.current) onCollapseRef.current();
        },
        () => {},
      );
  };

  useImperativeHandle(ref, () => ({ squash }));

  useLayoutEffect(() => {
    if (isClosing) squash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosing]);

  return (
    <li
      ref={barRef}
      className="project-bar is-expanded"
      inert={isClosing}
      // Esc from the arrow; the form handles Esc inside it.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        squash();
      }}
    >
      {children}
      {hasCollapseButton && (
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
      )}
    </li>
  );
}

function canAnimate(element: HTMLElement) {
  return (
    typeof element.animate === "function" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
