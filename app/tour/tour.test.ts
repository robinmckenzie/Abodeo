import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Driver } from "driver.js";

import { startTour } from "./tour";
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

    it("closes the window on Back, and does not act again or reopen it on Next", async () => {
      await reachActingStep();
      await finish();
      await pressAndSee("Back", "Area A");
      expect(projectWindow()).toBeNull();
      expect(isAvailable("Back")).toBe(false);
      await pressAndSee("Next", "In the window");
      expect(action).toHaveBeenCalledTimes(1);
      expect(projectWindow()).toBeNull();
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
});
