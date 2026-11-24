import { describe, expect, it } from "vitest";

import {
  findCreateButton,
  findFirstTaskPerson,
  findTourProjectBar,
} from "./tour-project";
import { describeTourStep, tourSteps } from "./tour-steps";

const findStep = (id: string) => tourSteps.find((step) => step.id === id)!;

describe("tourSteps", () => {
  it("lists the steps built so far in order, each with its own id", () => {
    expect(tourSteps.map((step) => step.name)).toEqual([
      "Projects",
      "Adding a project",
      "Project created",
      "Assigning a task",
      "Task assigned",
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
      ".project-window",
      '.app-menu a[href="/people"]',
      '.app-menu a[href="/bin"]',
      undefined,
    ]);
  });

  it("puts the steps that fill in, assign and add tasks in the window, and gives each project step an action", () => {
    expect(
      tourSteps.filter((step) => step.isInWindow).map((step) => step.id),
    ).toEqual(["add-project", "assign-task", "task-assigned", "more-tasks"]);
    expect(
      tourSteps.filter((step) => step.action).map((step) => step.id),
    ).toEqual([
      "add-project",
      "project-created",
      "assign-task",
      "task-assigned",
      "more-tasks",
    ]);
  });

  it("lets the visitor press Create, the new bar or Priya instead of Next", () => {
    expect(
      tourSteps
        .filter((step) => step.clickable)
        .map((step) => [step.id, step.clickable]),
    ).toEqual([
      ["add-project", findCreateButton],
      ["project-created", findTourProjectBar],
      ["assign-task", findFirstTaskPerson],
    ]);
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
    expect(describeTourStep(6)).toBe("step 7 of 9 (People)");
  });
});
