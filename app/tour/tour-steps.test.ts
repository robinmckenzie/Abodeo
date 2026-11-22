import { describe, expect, it } from "vitest";

import { describeTourStep, tourSteps } from "./tour-steps";

describe("tourSteps", () => {
  it("lists this ticket's four steps in order, each with its own id", () => {
    expect(tourSteps.map((step) => step.name)).toEqual([
      "Projects",
      "People",
      "Bin",
      "Explore",
    ]);
    expect(new Set(tourSteps.map((step) => step.id)).size).toBe(
      tourSteps.length,
    );
  });

  it("highlights the projects list and the People and Bin menu entries, and centres the closing step", () => {
    expect(tourSteps.map((step) => step.element)).toEqual([
      'ul[aria-label="Projects"]',
      '.app-menu a[href="/people"]',
      '.app-menu a[href="/bin"]',
      undefined,
    ]);
  });

  it("gives the Bin's grace period", () => {
    expect(tourSteps[2].description).toContain("2 days");
  });

  it("closes with the E shortcut, the repository, its tickets and the demo warning", () => {
    const closing = tourSteps[3].description;
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
    expect(describeTourStep(1)).toBe("step 2 of 4 (People)");
  });
});
