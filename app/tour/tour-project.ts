// The demo tour's own project (AD #160 Tour Creates A Project), made as a
// visitor would make it, one step at a time: the tour fills in Add project,
// creates it, opens it to assign its first task, then adds and assigns two
// more tasks.
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
  firstTask: { title: "Buy flour and butter", person: "Priya" },
  moreTasks: [
    { title: "Bake two trays of scones", person: "Sam" },
    { title: "Pack them in the tin", person: "Priya" },
  ],
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

// The tour's project's bar in the projects list, if it is there.
export function findTourProjectBar() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("button[data-project-id]"),
  ].find((bar) => bar.textContent?.includes(tourProject.title));
}

// Opens Add project and fills it in, but leaves Create to the next step.
export async function fillInTourProject({ show, signal }: TourActionContext) {
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
    tourProject.firstTask.title,
    signal,
  );
  // The project goes to the first person, after Unassigned.
  const assignees = document.querySelectorAll<HTMLInputElement>(
    `${windowSelector} input[name="assignee"]`,
  );
  assignees[1]?.click();
}

// Presses Create, which closes the window once the project is saved, and
// shows the step on the new project's bar.
export async function createTourProject({ show, signal }: TourActionContext) {
  findInWindow<HTMLButtonElement>('button[type="submit"]')?.click();
  await waitUntil(
    () => !document.querySelector(windowSelector) && findTourProjectBar(),
    signal,
  );
  show();
}

// Opens the tour's project unless it is open, and waits until it can be
// changed: an opened project is read-only until its latest copy has loaded,
// and a change made before then would be lost.
async function openTourProject({ show, signal }: TourActionContext) {
  if (!document.querySelector(windowSelector)) {
    (await waitUntil(findTourProjectBar, signal)).click();
  }
  await waitUntil(
    () => findInWindow(".project-form-body:not(.is-read-only)"),
    signal,
  );
  show();
  await pause(tourPace.settling, signal);
}

// Gives a task to a person, by name, through the task's own list of people.
// If no one has that name, the list is closed and the task keeps its person.
async function assignTask(
  taskTitle: string,
  person: string,
  signal: AbortSignal,
) {
  const picker = await waitUntil(
    () =>
      findInWindow<HTMLButtonElement>(
        `button[data-task-assignee][aria-label^="${taskTitle} is assigned to "]`,
      ),
    signal,
  );
  picker.click();
  const options = await waitUntil(() => {
    const found = document.querySelectorAll<HTMLButtonElement>(
      ".task-assignee-list [role=menuitemradio]",
    );
    return found.length > 0 && [...found];
  }, signal);
  await pause(tourPace.settling, signal);
  const option = options.find((option) =>
    option.textContent?.startsWith(person),
  );
  if (!option) {
    picker.click();
    return;
  }
  option.click();
  await waitUntil(() => picker.textContent === person, signal);
  await pause(tourPace.settling, signal);
}

export async function assignFirstTourTask(context: TourActionContext) {
  await openTourProject(context);
  const { title, person } = tourProject.firstTask;
  await assignTask(title, person, context.signal);
}

// Adds both tasks at once, as two lines and one Enter, then assigns each.
export async function addMoreTourTasks(context: TourActionContext) {
  const { signal } = context;
  await openTourProject(context);
  const taskBox = await waitUntil(
    () =>
      findInWindow<HTMLTextAreaElement>(
        'textarea[aria-label="Add tasks, one per line"]:not([name])',
      ),
    signal,
  );
  taskBox.focus();
  setFieldValue(
    taskBox,
    tourProject.moreTasks.map((task) => task.title).join("\n"),
  );
  await pause(tourPace.settling, signal);
  pressEnter(taskBox);
  // The box clears only once both tasks are saved.
  await waitUntil(() => taskBox.value === "", signal);
  for (const { title, person } of tourProject.moreTasks) {
    await assignTask(title, person, signal);
  }
}

// Closes the project's window with its Close button, if it is open, and
// waits for it to go. A project already created stays in the list; Add
// project's unsaved form is discarded.
export async function closeProjectWindow(signal: AbortSignal) {
  const close = findInWindow<HTMLButtonElement>(".project-form-close");
  if (!close) return;
  close.click();
  await waitUntil(() => !document.querySelector(windowSelector), signal);
}
