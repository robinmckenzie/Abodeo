// The demo tour's own project (AD #160 Tour Creates A Project): the tour
// adds it through the Add project window, as a visitor would, then opens it
// and adds two more tasks.
import {
  pause,
  pressEnter,
  setFieldValue,
  tourPace,
  typeInto,
  waitUntil,
} from "./tour-page";

export const tourProject = {
  title: "Bake for the street party",
  notes: "Something sweet for Saturday.",
  firstTask: "Buy flour and butter",
  moreTasks: ["Bake two trays of scones", "Pack them in the tin"],
};

// What a step's action is given: show puts the step's bubble on the page
// (again, if the area it highlights has been replaced), and signal ends the
// action when the tour ends.
export type TourActionContext = {
  show: () => void;
  signal: AbortSignal;
};

const windowSelector = ".project-window";

function findInWindow<T extends Element>(selector: string) {
  return document.querySelector<T>(`${windowSelector} ${selector}`);
}

function listBars() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("button[data-project-id]"),
  ];
}

export async function createTourProject({ show, signal }: TourActionContext) {
  const earlierBars = new Set(listBars().map((bar) => bar.dataset.projectId));

  document.querySelector<HTMLButtonElement>("button.add-project")?.click();
  const title = await waitUntil(
    () => findInWindow<HTMLInputElement>('input[name="title"]'),
    signal,
  );
  show();
  await pause(tourPace.settling, signal);
  await typeInto(title, tourProject.title, signal);
  await typeInto(
    findInWindow<HTMLTextAreaElement>('textarea[name="notes"]')!,
    tourProject.notes,
    signal,
  );
  await typeInto(
    findInWindow<HTMLTextAreaElement>('textarea[name="tasks"]')!,
    tourProject.firstTask,
    signal,
  );
  // The first person, after Unassigned.
  const assignees = document.querySelectorAll<HTMLInputElement>(
    `${windowSelector} input[name="assignee"]`,
  );
  assignees[1]?.click();
  await pause(tourPace.settling, signal);
  findInWindow<HTMLButtonElement>('button[type="submit"]')!.click();

  // Create closes the window once the project is saved.
  const bar = await waitUntil(
    () =>
      !document.querySelector(windowSelector) &&
      listBars().find((bar) => !earlierBars.has(bar.dataset.projectId)),
    signal,
  );
  bar.click();
  // An opened project is read-only until its latest copy has loaded, and a
  // task added before then would be lost.
  const taskBox = await waitUntil(
    () =>
      findInWindow(".project-form-body:not(.is-read-only)") &&
      findInWindow<HTMLTextAreaElement>(
        'textarea[aria-label="Add tasks, one per line"]:not([name])',
      ),
    signal,
  );
  show();
  await pause(tourPace.settling, signal);
  taskBox.focus();
  setFieldValue(taskBox, tourProject.moreTasks.join("\n"));
  await pause(tourPace.settling, signal);
  pressEnter(taskBox);
  // The box clears only once both tasks are saved.
  await waitUntil(() => taskBox.value === "", signal);
}

// Closes the project's window with its Close button, if it is open, and
// waits for it to go. The project stays in the list.
export async function closeProjectWindow(signal: AbortSignal) {
  const close = findInWindow<HTMLButtonElement>(".project-form-close");
  if (!close) return;
  close.click();
  await waitUntil(() => !document.querySelector(windowSelector), signal);
}
