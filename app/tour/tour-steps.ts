// The demo tour's steps (AD #139 Demo Tour), in the order they are shown.
// Each has a short name, so that a step can be reported as, for example,
// "step 3 of 6 (Calendar)".
import { describeBinPeriod } from "../projects/delete-project";
import {
  addMoreTourTasks,
  chooseFirstTaskPerson,
  createTourProject,
  fillInTourProject,
  findCreateButton,
  findFirstTaskPerson,
  findTourProjectBar,
  openFirstTaskList,
  type TourActionContext,
} from "./tour-project";

export type TourStep = {
  id: string;
  name: string;
  // The area highlighted, as a CSS selector. Without one the bubble is
  // centred on the dimmed page. A function finds it when the step is shown.
  element?: string | (() => Element | undefined);
  // Which side of the area the bubble goes.
  side?: "top" | "right" | "bottom" | "left";
  title: string;
  // HTML, so that the closing step can hold links.
  description: string;
  // Whether the area is in the project's window, which the tour closes on
  // the way to a step that is not.
  isInWindow?: boolean;
  // What the tour does the first time the step is reached in a run. It
  // shows the step itself, once the area it highlights is on the page.
  action?: (context: TourActionContext) => Promise<void>;
  // A control on the page that the visitor may press instead of Next, once
  // the step's action has finished. It does its own job, and the press
  // then moves on as Next would.
  clickable?: string | (() => Element | undefined);
};

const repositoryUrl = "https://github.com/robinmckenzie/Abodeo";

export const tourSteps: readonly TourStep[] = [
  {
    id: "projects",
    name: "Projects",
    element: 'ul[aria-label="Projects"]',
    side: "bottom",
    title: "Your projects",
    description:
      "Everything on the go around the home, one bar each. These two are already under way, with photos of how they are getting on.",
  },
  {
    id: "add-project",
    name: "Adding a project",
    element: ".project-window",
    side: "left",
    isInWindow: true,
    title: "Adding a project",
    description:
      "A project starts with a title, a few notes, who it is for, and a first task. Press Create, or Next, to create it.",
    action: fillInTourProject,
    clickable: findCreateButton,
  },
  {
    id: "project-created",
    name: "Project created",
    element: findTourProjectBar,
    side: "bottom",
    title: "Project created",
    description:
      "That's the project created, with just the basics. To add more, such as tasks, people and appointments, click its bar to open it again. Try it, or press Next.",
    action: createTourProject,
    clickable: findTourProjectBar,
  },
  {
    id: "assign-task",
    name: "Assigning a task",
    element: ".project-window",
    side: "left",
    isInWindow: true,
    title: "Assigning a task",
    description:
      "Each task can go to a different person, chosen from its own list of people. Choose Priya for the first one, or press Next.",
    action: openFirstTaskList,
    clickable: findFirstTaskPerson,
  },
  {
    id: "task-assigned",
    name: "Task assigned",
    element: ".project-window",
    side: "left",
    isInWindow: true,
    title: "Task assigned",
    description:
      "The first task is now Priya's, and its row says so. The project itself can still belong to someone else.",
    action: chooseFirstTaskPerson,
  },
  {
    id: "more-tasks",
    name: "More tasks",
    element: ".project-window",
    side: "left",
    isInWindow: true,
    title: "More tasks",
    description:
      "Add tasks at any time, one per line, then choose who does each. Everything is saved as it goes.",
    action: addMoreTourTasks,
  },
  {
    id: "people",
    name: "People",
    element: '.app-menu a[href="/people"]',
    side: "right",
    title: "People",
    description:
      "The people who help around the home. Each project and each task can be given to one of them.",
  },
  {
    id: "bin",
    name: "Bin",
    element: '.app-menu a[href="/bin"]',
    side: "right",
    title: "The Bin",
    description: `A deleted project goes to the Bin. It stays there for ${describeBinPeriod()}, and can be restored until then.`,
  },
  {
    id: "explore",
    name: "Explore",
    title: "Over to you",
    description: [
      "<p>Explore freely. The two starting projects have images, and you can add your own.</p>",
      "<p>Press <kbd>E</kbd> to switch between opening projects in a window and in place.</p>",
      `<p>Abodeo's code is on <a href="${repositoryUrl}" target="_blank" rel="noreferrer">GitHub</a>, with its <a href="${repositoryUrl}/issues" target="_blank" rel="noreferrer">tickets</a>.</p>`,
      "<p>This is a demo account, so changes are not guaranteed to be kept.</p>",
    ].join(""),
  },
];

// A step as it is reported, such as "step 3 of 6 (Calendar)".
export function describeTourStep(
  index: number,
  steps: readonly TourStep[] = tourSteps,
) {
  return `step ${index + 1} of ${steps.length} (${steps[index].name})`;
}
