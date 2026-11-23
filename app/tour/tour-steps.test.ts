import { describe, expect, it } from "vitest";

import { describeTourStep, tourSteps } from "./tour-steps";

describe("tourSteps", () => {
  it("lists the steps built so far in order, each with its own id", () => {
    expect(tourSteps.map((step) => step.name)).toEqual([
      "Projects",
      "Your project",
      "People",
      "Bin",
      "Explore",
    ]);
    expect(new Set(tourSteps.map((step) => step.id)).size).toBe(
      tourSteps.length,
    );
  });

  it("highlights the projects list, the project's window and the People and Bin menu entries, and centres the closing step", () => {
    expect(tourSteps.map((step) => step.element)).toEqual([
      'ul[aria-label="Projects"]',
      ".project-window",
      '.app-menu a[href="/people"]',
      '.app-menu a[href="/bin"]',
      undefined,
    ]);
  });

  it("puts only the project step in the window, and gives only it an action", () => {
    expect(
      tourSteps.filter((step) => step.isInWindow).map((step) => step.id),
    ).toEqual(["project"]);
    expect(
      tourSteps.filter((step) => step.action).map((step) => step.id),
    ).toEqual(["project"]);
  });

  it("gives the Bin's grace period", () => {
    expect(tourSteps[3].description).toContain("2 days");
  });

  it("closes with the E shortcut, the repository, its tickets and the demo warning", () => {
    const closing = tourSteps[4].description;
    expect(closing).toContain("<kbd>E</kbd>");
    expect(closing).toContain('href="https://github.com/robinmckenzie/Abodeo"');
    expect(closing).toContain(
      'href="https://github.com/robinmckenzie/Abodeo/issues"',
    );
    expect(closing).toContain("not guaranteed to be kept");
  });
});

describe("describeTourStep", () => {
  it("names a step by its place and name", () => {
    expect(describeTourStep(2)).toBe("step 3 of 5 (People)");
  });
});
