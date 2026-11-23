// The demo tour's steps (AD #139 Demo Tour), in the order they are shown.
// Each has a short name, so that a step can be reported as, for example,
// "step 3 of 6 (Calendar)".
import { describeBinPeriod } from "../projects/delete-project";
import { createTourProject, type TourActionContext } from "./tour-project";

export type TourStep = {
  id: string;
  name: string;
  // The area highlighted, as a CSS selector. Without one the bubble is
  // centred on the dimmed page.
  element?: string;
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
    id: "project",
    name: "Your project",
    element: ".project-window",
    side: "left",
    isInWindow: true,
    title: "Adding a project",
    description:
      "Watch a project being added: a title, a few notes, who it is for, and a first task. Once it is created, it opens and takes two more tasks. Everything is saved as it goes.",
    action: createTourProject,
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
