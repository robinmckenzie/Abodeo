// The demo tour (AD #139 Demo Tour), run with driver.js: each step dims the
// page, highlights one area and shows a bubble with Next, Back and "Skip
// tour". The page is locked while it runs: a click on the dimmed page or the
// highlighted area does nothing. Nothing about the tour is kept in the
// browser.
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useEffect, useRef } from "react";

import { TourEnded } from "./tour-page";
import { closeProjectWindow } from "./tour-project";
import { tourSteps, type TourStep } from "./tour-steps";

// Starts the tour from its first step. onEnd is called once it ends, by
// finishing, skipping or Esc, but not by a call of the result's destroy.
//
// The tour makes its own moves between steps, so that it can act on the way:
// running a step's action the first time the step is reached, and closing
// the project's window on the way to a step outside it. Back to a step in
// the middle shows it again but does not undo or repeat its action. Back to
// a step before the first that acts closes the window and calls
// removeProject, which deletes the tour's project, so that going on does it
// all again (AD #160 Tour Creates A Project). While the tour acts, Next,
// Back, "Skip tour" and the keys are unavailable (decision 28 on AD #139).
export function startTour(
  onEnd: () => void,
  steps: readonly TourStep[] = tourSteps,
  removeProject: () => Promise<void> = async () => {},
): Driver {
  const running = new AbortController();
  const ranActions = new Set<string>();
  const firstActing = steps.findIndex((step) => step.action);
  let isActing = false;
  // The bubble's buttons, and those driver.js itself made unavailable, such
  // as Back on the first step. driver.js builds a new bubble at every step.
  let buttons: HTMLButtonElement[] = [];
  let unavailable = new Set<HTMLButtonElement>();

  // driver.js's own onDestroyed is not called if the tour ends before its
  // first highlight has finished moving into place, so the tour ends here.
  const end = () => {
    tour.destroy();
    onEnd();
  };

  const showButtons = () => {
    for (const button of buttons) {
      const isUnavailable = isActing || unavailable.has(button);
      button.disabled = isUnavailable;
      button.classList.toggle("driver-popover-btn-disabled", isUnavailable);
    }
  };

  const setActing = (acting: boolean) => {
    isActing = acting;
    tour.setConfig({ ...tour.getConfig(), allowKeyboardControl: !acting });
    showButtons();
  };

  const move = async (to: number) => {
    const step = steps[to];
    setActing(true);
    try {
      if (step.action && !ranActions.has(step.id)) {
        // The action closes or opens the window as it needs.
        ranActions.add(step.id);
        await step.action({
          show: () => tour.moveTo(to),
          signal: running.signal,
        });
      } else {
        if (!step.isInWindow) await closeProjectWindow(running.signal);
        if (to < firstActing && ranActions.size > 0) {
          await removeProject();
          ranActions.clear();
        }
        if (!running.signal.aborted) tour.moveTo(to);
      }
    } catch (error) {
      if (!(error instanceof TourEnded)) throw error;
    } finally {
      if (!running.signal.aborted) setActing(false);
    }
  };

  const tour: Driver = driver({
    steps: steps.map((step) => ({
      // driver.js's own type wants a function to find something, but it
      // centres the bubble when the function finds nothing.
      element: step.element as DriveStep["element"],
      popover: {
        title: step.title,
        description: step.description,
        side: step.side,
      },
    })),
    overlayClickBehavior: "none",
    disableActiveInteraction: true,
    // No close (×) button (decision 31 on AD #139): "Skip tour" ends it.
    showButtons: ["next", "previous"],
    prevBtnText: "Back",
    doneBtnText: "Done",
    showProgress: true,
    popoverClass: "tour-popover",
    onPopoverRender: (popover) => {
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "driver-popover-footer-btn tour-skip";
      skip.textContent = "Skip tour";
      skip.addEventListener("click", end);
      popover.footer.prepend(skip);
      buttons = [popover.previousButton, popover.nextButton, skip];
      unavailable = new Set(buttons.filter((button) => button.disabled));
      showButtons();
    },
    // Next and Done, and the right arrow key.
    onNextClick: () => {
      const index = tour.getActiveIndex();
      if (index === undefined) return;
      if (index === steps.length - 1) end();
      else void move(index + 1);
    },
    // Back, and the left arrow key.
    onPrevClick: () => {
      const index = tour.getActiveIndex();
      if (index) void move(index - 1);
    },
    // Esc.
    onDestroyStarted: end,
  });
  // However the tour ends, an action under way stops at its next step.
  const destroy = tour.destroy;
  tour.destroy = () => {
    running.abort();
    destroy();
  };
  tour.drive();
  return tour;
}

// Runs the tour while isRunning is true, and calls onEnd when the visitor
// ends it. Leaving the screen ends it without calling onEnd. removeProject
// deletes the tour's project, for Back to the start.
export function useTour(
  isRunning: boolean,
  onEnd: () => void,
  removeProject: () => Promise<void>,
) {
  const onEndRef = useRef(onEnd);
  const removeProjectRef = useRef(removeProject);
  useEffect(() => {
    onEndRef.current = onEnd;
    removeProjectRef.current = removeProject;
  });
  useEffect(() => {
    if (!isRunning) return;
    const tour = startTour(
      () => onEndRef.current(),
      tourSteps,
      () => removeProjectRef.current(),
    );
    return () => tour.destroy();
  }, [isRunning]);
}
