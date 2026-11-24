import { describe, expect, it } from "vitest";

import { findTourProjectBar } from "./tour-project";
import { describeTourStep, tourSteps } from "./tour-steps";

const findStep = (id: string) => tourSteps.find((step) => step.id === id)!;

describe("tourSteps", () => {
  it("lists the steps built so far in order, each with its own id", () => {
    expect(tourSteps.map((step) => step.name)).toEqual([
      "Projects",
      "Adding a project",
      "Project created",
      "Assigning a task",
      "More tasks",
      "People",
      "Bin",
      "Explore",
    ]);
    expect(new Set(tourSteps.map((step) => step.id)).size).toBe(
      tourSteps.length,
    );
  });

  it("highlights the projects list, the project's window, the new project's bar and the People and Bin menu entries, and centres the closing step", () => {
    expect(tourSteps.map((step) => step.element)).toEqual([
      'ul[aria-label="Projects"]',
      ".project-window",
      findTourProjectBar,
      ".project-window",
      ".project-window",
      '.app-menu a[href="/people"]',
      '.app-menu a[href="/bin"]',
      undefined,
    ]);
  });

  it("puts the steps that fill in, assign and add tasks in the window, and gives each project step an action", () => {
    expect(
      tourSteps.filter((step) => step.isInWindow).map((step) => step.id),
    ).toEqual(["add-project", "assign-task", "more-tasks"]);
    expect(
      tourSteps.filter((step) => step.action).map((step) => step.id),
    ).toEqual(["add-project", "project-created", "assign-task", "more-tasks"]);
  });

  it("gives the Bin's grace period", () => {
    expect(findStep("bin").description).toContain("2 days");
  });

  it("closes with the E shortcut, the repository, its tickets and the demo warning", () => {
    const closing = findStep("explore").description;
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
    expect(describeTourStep(5)).toBe("step 6 of 8 (People)");
  });
});
