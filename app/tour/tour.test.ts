import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Driver } from "driver.js";

import { startTour } from "./tour";
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
});
