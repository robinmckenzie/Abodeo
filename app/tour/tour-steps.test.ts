import { describe, expect, it } from "vitest";

import {
  describeTourBakingDay,
  describeTourDance,
  findCreateButton,
  findAppointmentsSection,
  findFirstTaskPerson,
  findSaveButton,
  findTourProjectBar,
} from "./tour-project";
import { describeTourStep, tourSteps } from "./tour-steps";

const findStep = (id: string) => tourSteps.find((step) => step.id === id)!;

describe("tourSteps", () => {
  it("lists the steps built so far in order, each with its own id", () => {
    expect(tourSteps.map((step) => step.name)).toEqual([
      "Projects",
      "Adding a project",
      "Due date",
      "Project created",
      "Assigning a task",
      "Task assigned",
      "More tasks",
      "Adding an appointment",
      "In Google Calendar",
      "People",
      "Bin",
      "Explore",
    ]);
    expect(new Set(tourSteps.map((step) => step.id)).size).toBe(
      tourSteps.length,
    );
  });

  it("highlights the projects list, the project's window, the new project's bar, its appointments and the People and Bin menu entries, and centres the closing step", () => {
    expect(tourSteps.map((step) => step.element)).toEqual([
      'ul[aria-label="Projects"]',
      ".project-window",
      ".project-window",
      findTourProjectBar,
      ".project-window",
      ".project-window",
      ".project-window",
      findAppointmentsSection,
      findAppointmentsSection,
      '.app-menu a[href="/people"]',
      '.app-menu a[href="/bin"]',
      undefined,
    ]);
  });

  it("puts the steps that fill in, assign and add tasks and add the appointment in the window, and gives each of them an action", () => {
    expect(
      tourSteps.filter((step) => step.isInWindow).map((step) => step.id),
    ).toEqual([
      "add-project",
      "due-date",
      "assign-task",
      "task-assigned",
      "more-tasks",
      "add-appointment",
      "appointment-added",
    ]);
    expect(
      tourSteps.filter((step) => step.action).map((step) => step.id),
    ).toEqual([
      "add-project",
      "due-date",
      "project-created",
      "assign-task",
      "task-assigned",
      "more-tasks",
      "add-appointment",
      "appointment-added",
    ]);
  });

  it("lets the visitor press Create, the new bar, Priya or Save instead of Next", () => {
    expect(
      tourSteps
        .filter((step) => step.clickable)
        .map((step) => [step.id, step.clickable]),
    ).toEqual([
      ["due-date", findCreateButton],
      ["project-created", findTourProjectBar],
      ["assign-task", findFirstTaskPerson],
      ["add-appointment", findSaveButton],
    ]);
  });

  it("says the Barn Dance is next Saturday only on a Friday or a Saturday", () => {
    // Monday 23 to Sunday 29 November 2026.
    expect(
      [23, 24, 25, 26, 27, 28, 29].map((day) =>
        describeTourDance(`2026-11-${day}`),
      ),
    ).toEqual([
      "Saturday",
      "Saturday",
      "Saturday",
      "Saturday",
      "next Saturday",
      "next Saturday",
      "Saturday",
    ]);
  });

  it("says the baking is due tomorrow only on a Thursday", () => {
    expect(
      [25, 26, 27].map((day) => describeTourBakingDay(`2026-11-${day}`)),
    ).toEqual(["on Friday", "tomorrow", "on Friday"]);
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
    expect(describeTourStep(9)).toBe("step 10 of 12 (People)");
  });
});
