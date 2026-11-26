import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Driver } from "driver.js";

import { startTour } from "./tour";
import { pause } from "./tour-page";
import type { TourActionContext } from "./tour-project";
import type { TourStep } from "./tour-steps";

const steps: TourStep[] = [
  { id: "a", name: "A", element: "#area-a", title: "Area A", description: "First." },
  { id: "b", name: "B", element: "#area-b", title: "Area B", description: "Second." },
  { id: "c", name: "C", title: "Closing", description: "Last." },
];

function readTitle() {
  return document.querySelector(".driver-popover-title")?.textContent;
}

async function pressAndSee(name: string, title: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(readTitle()).toBe(title));
}

describe("startTour", () => {
  let tour: Driver | undefined;
  const onEnd = vi.fn();

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="area-a">A</div><div id="area-b">B</div>';
  });

  afterEach(() => {
    tour?.destroy();
    tour = undefined;
    onEnd.mockReset();
    document.body.innerHTML = "";
  });

  it("shows the first step with Next, Back and Skip tour, and no close button", () => {
    tour = startTour(onEnd, steps);
    expect(readTitle()).toBe("Area A");
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeTruthy();
    expect(
      document.querySelector<HTMLElement>(".driver-popover-close-btn")?.style
        .display,
    ).toBe("none");
  });

  it("moves forward and back, and finishes with Done", async () => {
    tour = startTour(onEnd, steps);
    await pressAndSee("Next", "Area B");
    await pressAndSee("Back", "Area A");
    await pressAndSee("Next", "Area B");
    await pressAndSee("Next", "Closing");
    expect(onEnd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tour.isActive()).toBe(false);
  });

  it("keeps going after a click on the dimmed page or the highlighted area", async () => {
    tour = startTour(onEnd, steps);
    const dimmed = await waitFor(() => {
      const path = document.querySelector(".driver-overlay path");
      expect(path).toBeTruthy();
      return path!;
    });
    fireEvent.click(dimmed);
    fireEvent.click(document.getElementById("area-a")!);
    expect(tour.isActive()).toBe(true);
    expect(readTitle()).toBe("Area A");
    expect(
      document.getElementById("area-a")!.classList.contains(
        "driver-no-interaction",
      ),
    ).toBe(true);
  });

  it("ends on Esc", () => {
    tour = startTour(onEnd, steps);
    fireEvent.keyUp(window, { key: "Escape" });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tour.isActive()).toBe(false);
  });

  it("ends on Skip tour straight away", () => {
    tour = startTour(onEnd, steps);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tour.isActive()).toBe(false);
  });

  it("ends on Skip tour at a later step", async () => {
    tour = startTour(onEnd, steps);
    await pressAndSee("Next", "Area B");
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tour.isActive()).toBe(false);
    expect(document.querySelector(".driver-popover")).toBeNull();
  });

  describe("a step that acts in the project's window", () => {
    let finishAction: () => void;
    const action = vi.fn(async ({ show }: TourActionContext) => {
      const window = document.createElement("div");
      window.className = "project-window";
      window.innerHTML =
        '<button type="button" class="project-form-close">Close</button>';
      window.querySelector("button")!.addEventListener("click", () =>
        window.remove(),
      );
      document.body.append(window);
      show();
      await new Promise<void>((resolve) => (finishAction = resolve));
    });
    const actingSteps: TourStep[] = [
      steps[0],
      {
        id: "w",
        name: "W",
        element: ".project-window",
        isInWindow: true,
        title: "In the window",
        description: "Acting.",
        action,
      },
      steps[2],
    ];
    const isAvailable = (name: string) =>
      !screen.getByRole<HTMLButtonElement>("button", { name }).disabled;
    const projectWindow = () => document.querySelector(".project-window");

    afterEach(() => {
      action.mockClear();
    });

    async function reachActingStep() {
      tour = startTour(onEnd, actingSteps);
      await pressAndSee("Next", "In the window");
      expect(projectWindow()?.classList.contains("driver-active-element")).toBe(
        true,
      );
    }

    async function finish() {
      finishAction();
      await waitFor(() => expect(isAvailable("Next")).toBe(true));
    }

    it("makes Next, Back, Skip tour and the keys unavailable while it acts, and gives them back after", async () => {
      await reachActingStep();
      expect(isAvailable("Next")).toBe(false);
      expect(isAvailable("Back")).toBe(false);
      expect(isAvailable("Skip tour")).toBe(false);
      fireEvent.keyUp(window, { key: "Escape" });
      fireEvent.keyUp(window, { key: "ArrowLeft" });
      expect(tour!.isActive()).toBe(true);
      expect(readTitle()).toBe("In the window");
      await finish();
      expect(isAvailable("Back")).toBe(true);
      expect(isAvailable("Skip tour")).toBe(true);
    });

    it("on Back to the start, closes the window and removes the project, and acts again on Next", async () => {
      const removeProject = vi.fn(async () => {});
      tour = startTour(onEnd, actingSteps, removeProject);
      await pressAndSee("Next", "In the window");
      await finish();
      await pressAndSee("Back", "Area A");
      expect(projectWindow()).toBeNull();
      expect(removeProject).toHaveBeenCalledTimes(1);
      expect(isAvailable("Back")).toBe(false);
      await pressAndSee("Next", "In the window");
      expect(action).toHaveBeenCalledTimes(2);
      expect(projectWindow()).toBeTruthy();
    });

    it("does not act again or reopen the window on Back to an acting step from a later one", async () => {
      const removeProject = vi.fn(async () => {});
      tour = startTour(onEnd, actingSteps, removeProject);
      await pressAndSee("Next", "In the window");
      await finish();
      await pressAndSee("Next", "Closing");
      await pressAndSee("Back", "In the window");
      expect(action).toHaveBeenCalledTimes(1);
      expect(projectWindow()).toBeNull();
      expect(removeProject).not.toHaveBeenCalled();
      expect(isAvailable("Next")).toBe(true);
    });

    it("closes the window going on to a step outside it, and stops an action under way when the tour ends", async () => {
      await reachActingStep();
      await finish();
      await pressAndSee("Next", "Closing");
      expect(projectWindow()).toBeNull();
      tour!.destroy();
      tour = startTour(onEnd, actingSteps);
      await pressAndSee("Next", "In the window");
      const { signal } = action.mock.calls[1][0];
      tour.destroy();
      expect(signal.aborted).toBe(true);
    });
  });

  describe("hurrying and the visitor's own press", () => {
    const hurriedAction = vi.fn(
      async ({ show, signal, hurried }: TourActionContext) => {
        show();
        await pause(60_000, signal, hurried);
      },
    );
    const nextAction = vi.fn(async ({ show }: TourActionContext) => show());
    const clickSteps: TourStep[] = [
      steps[0],
      {
        id: "p",
        name: "P",
        element: "#area-b",
        title: "Press it",
        description: "Acting.",
        action: hurriedAction,
        clickable: "#press-me",
      },
      {
        id: "q",
        name: "Q",
        title: "Pressed",
        description: "After.",
        action: nextAction,
      },
    ];
    const pressMe = () => document.getElementById("press-me")!;
    const isNextAvailable = () =>
      !screen.getByRole<HTMLButtonElement>("button", { name: "Next" })
        .disabled;

    beforeEach(() => {
      document.getElementById("area-b")!.innerHTML =
        '<button type="button" id="press-me">Create</button>';
    });

    afterEach(() => {
      hurriedAction.mockClear();
      nextAction.mockClear();
    });

    async function reachAndHurry() {
      tour = startTour(onEnd, clickSteps);
      await pressAndSee("Next", "Press it");
      expect(isNextAvailable()).toBe(false);
      expect(pressMe().classList.contains("tour-clickable")).toBe(false);
      fireEvent.keyUp(window, { key: "ArrowRight" });
      await waitFor(() => expect(isNextAvailable()).toBe(true));
    }

    it("ends the action's pauses on the right arrow key, without moving on", async () => {
      await reachAndHurry();
      expect(readTitle()).toBe("Press it");
      expect(nextAction).not.toHaveBeenCalled();
    });

    it("once the action has finished, lets the visitor's press of the control count as Next", async () => {
      const ownClick = vi.fn();
      pressMe().addEventListener("click", ownClick);
      await reachAndHurry();
      expect(pressMe().classList.contains("tour-clickable")).toBe(true);
      fireEvent.click(pressMe());
      await waitFor(() => expect(readTitle()).toBe("Pressed"));
      expect(ownClick).toHaveBeenCalledTimes(1);
      expect(nextAction.mock.calls[0][0].visitorActed).toBe(true);
      expect(pressMe().classList.contains("tour-clickable")).toBe(false);
    });

    const description = () =>
      document.querySelector(".driver-popover-description")?.textContent;

    it("shows a step's own wording when it is shown again, and offers its control again if it says so", async () => {
      tour = startTour(
        onEnd,
        clickSteps.map((step) =>
          step.id === "p"
            ? { ...step, againDescription: "As left.", clickableAgain: true }
            : step,
        ),
      );
      await pressAndSee("Next", "Press it");
      expect(description()).toBe("Acting.");
      fireEvent.keyUp(window, { key: "ArrowRight" });
      await waitFor(() => expect(isNextAvailable()).toBe(true));
      await pressAndSee("Next", "Pressed");
      await pressAndSee("Back", "Press it");
      expect(description()).toBe("As left.");
      expect(hurriedAction).toHaveBeenCalledTimes(1);
      expect(pressMe().classList.contains("tour-clickable")).toBe(true);
      fireEvent.click(pressMe());
      await waitFor(() => expect(readTitle()).toBe("Pressed"));
      expect(nextAction).toHaveBeenCalledTimes(1);
    });

    it("acts again on a step shown again only while the next step has not acted", async () => {
      const lastAction = vi.fn(async ({ show }: TourActionContext) => show());
      tour = startTour(onEnd, [
        ...clickSteps,
        { id: "r", name: "R", title: "Last", description: "End.", action: lastAction },
      ]);
      await pressAndSee("Next", "Press it");
      fireEvent.keyUp(window, { key: "ArrowRight" });
      await waitFor(() => expect(isNextAvailable()).toBe(true));
      await pressAndSee("Next", "Pressed");
      await pressAndSee("Back", "Press it");
      expect(hurriedAction).toHaveBeenCalledTimes(1);
      await pressAndSee("Next", "Pressed");
      expect(nextAction).toHaveBeenCalledTimes(2);
      await pressAndSee("Next", "Last");
      await pressAndSee("Back", "Pressed");
      expect(nextAction).toHaveBeenCalledTimes(2);
    });

    it("stops a press anywhere but the control while it is offered, if the step says so", async () => {
      const heard = vi.fn();
      document.addEventListener("pointerdown", heard, true);
      tour = startTour(
        onEnd,
        clickSteps.map((step) =>
          step.id === "p" ? { ...step, clickableOnly: true } : step,
        ),
      );
      await pressAndSee("Next", "Press it");
      fireEvent.pointerDown(document.body);
      expect(heard).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(window, { key: "ArrowRight" });
      await waitFor(() => expect(isNextAvailable()).toBe(true));
      fireEvent.pointerDown(document.body);
      fireEvent.pointerDown(screen.getByRole("button", { name: "Next" }));
      expect(heard).toHaveBeenCalledTimes(1);
      fireEvent.pointerDown(pressMe());
      expect(heard).toHaveBeenCalledTimes(2);
      await pressAndSee("Next", "Pressed");
      fireEvent.pointerDown(document.body);
      expect(heard).toHaveBeenCalledTimes(3);
      document.removeEventListener("pointerdown", heard, true);
    });

    it("takes the control back on Next, and does not offer it on a Back visit", async () => {
      await reachAndHurry();
      await pressAndSee("Next", "Pressed");
      expect(nextAction.mock.calls[0][0].visitorActed).toBe(false);
      expect(pressMe().classList.contains("tour-clickable")).toBe(false);
      await pressAndSee("Back", "Press it");
      expect(pressMe().classList.contains("tour-clickable")).toBe(false);
      fireEvent.click(pressMe());
      expect(readTitle()).toBe("Press it");
    });
  });
});
