// The demo tour (AD #139 Demo Tour), run with driver.js: each step dims the
// page, highlights one area and shows a bubble with Next, Back and "Skip
// tour". The page is locked while it runs: a click on the dimmed page or the
// highlighted area does nothing. Nothing about the tour is kept in the
// browser.
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useEffect, useRef } from "react";

import { tourSteps, type TourStep } from "./tour-steps";

// Starts the tour from its first step. onEnd is called once it ends, by
// finishing, skipping or Esc, but not by a call of the result's destroy.
export function startTour(
  onEnd: () => void,
  steps: readonly TourStep[] = tourSteps,
): Driver {
  // driver.js's own onDestroyed is not called if the tour ends before its
  // first highlight has finished moving into place, so the tour ends here.
  const end = () => {
    tour.destroy();
    onEnd();
  };
  const tour: Driver = driver({
    steps: steps.map((step) => ({
      element: step.element,
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
    },
    // Done on the last step, and Esc.
    onDestroyStarted: end,
  });
  tour.drive();
  return tour;
}

// Runs the tour while isRunning is true, and calls onEnd when the visitor
// ends it. Leaving the screen ends it without calling onEnd.
export function useTour(isRunning: boolean, onEnd: () => void) {
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  useEffect(() => {
    if (!isRunning) return;
    const tour = startTour(() => onEndRef.current());
    return () => tour.destroy();
  }, [isRunning]);
}
