// The demo tour (AD #139 Demo Tour), run with driver.js: each step dims the
// page, highlights one area and shows a bubble with Next, Back and "Skip
// tour". The page is locked while it runs: a click on the dimmed page or the
// highlighted area does nothing. Nothing about the tour is kept in the
// browser.
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useEffect, useRef } from "react";

import { TourEnded } from "./tour-page";
import { closeProjectWindow, reopenTourProject } from "./tour-project";
import { tourSteps, type TourStep } from "./tour-steps";

// An arrow key as a small key cap. The arrow is drawn, as the text arrows
// have heads too small to see at this size.
const keyCap = (direction: "left" | "right") =>
  `<kbd class="tour-key" aria-hidden="true"><svg viewBox="0 0 16 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${direction === "left" ? ' transform="scale(-1 1)"' : ""}><path d="M2 7h12M8.5 1.5 14 7l-5.5 5.5"/></svg></kbd>`;

// Starts the tour from its first step. onEnd is called once it ends, by
// finishing, skipping or Esc, but not by a call of the result's destroy.
//
// The tour makes its own moves between steps, so that it can act on the way:
// running a step's action the first time the step is reached, and closing
// the project's window on the way to a step outside it. A step reached
// again, by Back or by Next after going back, shows things as they were
// left, in its own wording if it has one, and opens the tour's project
// again if the step is in its window. It does not undo its action, and acts
// again only if the next step's action has not run, since what it showed,
// such as an open list, is not used up yet. Back to
// a step before the first that acts closes the window and calls
// removeProject, which deletes the tour's project, so that going on does it
// all again (AD #160 Tour Creates A Project). While the tour acts, Next,
// Back, "Skip tour" and the keys are unavailable (decision 28 on AD #139),
// except that the right arrow key hurries it: typing and pauses end at once.
// Once a step's action has finished, its clickable control, if any, can be
// pressed instead of Next.
export function startTour(
  onEnd: () => void,
  steps: readonly TourStep[] = tourSteps,
  removeProject: () => Promise<void> = async () => {},
): Driver {
  const running = new AbortController();
  const ranActions = new Set<string>();
  const firstActing = steps.findIndex((step) => step.action);
  let isActing = false;
  // While a step's action runs for the first time, as when More tasks adds
  // its tasks; not when the step acts again after Back and Next.
  let isActingFirst = false;
  // The bubble's buttons, and those driver.js itself made unavailable, such
  // as Back on the first step. driver.js builds a new bubble at every step.
  let buttons: HTMLButtonElement[] = [];
  let unavailable = new Set<HTMLButtonElement>();
  // Ends the running action's typing and pauses at once.
  let hurry = new AbortController();
  // Takes back the control offered instead of Next, if any.
  let withdrawClickable = () => {};
  // The step being shown again without acting, for its own wording.
  let shownAgain: number | undefined;
  // Wording an action gave its step once it knew how things went, kept for
  // when driver.js draws the bubble again.
  let described: { at: number; html: string } | undefined;

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
    // So that app.css can place a step's bubble differently while it acts
    // for the first time.
    buttons[0]
      ?.closest(".driver-popover")
      ?.classList.toggle("tour-acting", isActingFirst);
  };

  const setActing = (acting: boolean) => {
    isActing = acting;
    tour.setConfig({ ...tour.getConfig(), allowKeyboardControl: !acting });
    showButtons();
  };

  // Lets the visitor press the step's control instead of Next. The press
  // does its own job first, such as Create saving the project, and the next
  // step's action is told so, to leave that out.
  const offerClickable = (at: number) => {
    const { clickable, clickableOnly } = steps[at];
    const control =
      typeof clickable === "function"
        ? clickable()
        : clickable && document.querySelector(clickable);
    if (!control || at + 1 >= steps.length) return;
    // Heard on the control itself, before React's own handler.
    const pressed = () => {
      withdrawClickable();
      if (tour.getActiveIndex() === at) void move(at + 1, true);
    };
    // Heard at the window before the page's own handlers, such as the list
    // of people closing on a press outside it. The bubble's buttons act on
    // the click, which goes on as usual.
    const keepPage = (event: PointerEvent) => {
      if (!control.contains(event.target as Node)) {
        event.stopImmediatePropagation();
      }
    };
    control.classList.add("tour-clickable");
    control.addEventListener("click", pressed);
    if (clickableOnly) window.addEventListener("pointerdown", keepPage, true);
    withdrawClickable = () => {
      control.classList.remove("tour-clickable");
      control.removeEventListener("click", pressed);
      window.removeEventListener("pointerdown", keepPage, true);
      withdrawClickable = () => {};
    };
  };

  const move = async (to: number, visitorActed = false) => {
    const step = steps[to];
    withdrawClickable();
    hurry = new AbortController();
    setActing(true);
    shownAgain = undefined;
    described = undefined;
    let acted = false;
    let isShownAgain = false;
    const next = steps[to + 1];
    const actsAgain = next?.action !== undefined && !ranActions.has(next.id);
    try {
      if (step.action && (!ranActions.has(step.id) || actsAgain)) {
        // The action closes or opens the window as it needs.
        isActingFirst = !ranActions.has(step.id);
        ranActions.add(step.id);
        await step.action({
          show: () => tour.moveTo(to),
          refresh: () => tour.refresh(),
          describe: (html) => {
            if (running.signal.aborted || tour.getActiveIndex() !== to) return;
            described = { at: to, html };
            const shown = document.querySelector(".driver-popover-description");
            if (shown) shown.innerHTML = html;
            tour.refresh();
          },
          signal: running.signal,
          hurried: hurry.signal,
          visitorActed,
        });
        acted = true;
      } else {
        if (!step.isInWindow) await closeProjectWindow(running.signal);
        else await reopenTourProject(running.signal, visitorActed);
        if (to < firstActing && ranActions.size > 0) {
          await removeProject();
          ranActions.clear();
        }
        isShownAgain = step.action !== undefined;
        if (isShownAgain) shownAgain = to;
        if (!running.signal.aborted) tour.moveTo(to);
      }
    } catch (error) {
      if (!(error instanceof TourEnded)) throw error;
    } finally {
      isActingFirst = false;
      if (!running.signal.aborted) {
        setActing(false);
        if (acted || (isShownAgain && step.clickableAgain)) {
          offerClickable(to);
        }
      }
    }
  };

  // driver.js reads the arrow keys on keyup. The press is kept from it, as
  // in a browser the hurried action can finish before driver.js hears the
  // key, which it would then take as Next.
  const hurryOnArrow = (event: KeyboardEvent) => {
    if (!isActing || event.key !== "ArrowRight") return;
    event.stopImmediatePropagation();
    hurry.abort();
  };
  window.addEventListener("keyup", hurryOnArrow, true);

  const tour: Driver = driver({
    steps: steps.map((step) => ({
      // driver.js's own type wants a function to find something, but it
      // centres the bubble when the function finds nothing.
      element: step.element as DriveStep["element"],
      popover: {
        title: step.title,
        description: step.description,
        side: step.side,
        // Named after the step, so that app.css can nudge one step's bubble.
        popoverClass: `tour-popover tour-step-${step.id}`,
      },
    })),
    overlayClickBehavior: "none",
    disableActiveInteraction: true,
    // No close (×) button (decision 31 on AD #139): "Skip tour" ends it.
    showButtons: ["next", "previous"],
    // Each shows its arrow key as a small key cap, hidden from screen readers
    // so that the buttons are still called Back, Next and Done.
    prevBtnText: `${keyCap("left")} <span class="tour-word">Back</span>`,
    nextBtnText: `<span class="tour-word">Next</span> ${keyCap("right")}`,
    doneBtnText: `<span class="tour-word">Done</span> ${keyCap("right")}`,
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
      const again = shownAgain === undefined ? undefined : steps[shownAgain];
      if (again?.againDescription && tour.getActiveIndex() === shownAgain) {
        popover.description.innerHTML = again.againDescription;
      }
      if (described && tour.getActiveIndex() === described.at) {
        popover.description.innerHTML = described.html;
      }
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
    withdrawClickable();
    window.removeEventListener("keyup", hurryOnArrow, true);
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
