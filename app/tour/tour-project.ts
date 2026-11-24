// The demo tour's own project (AD #160 Tour Creates A Project), made as a
// visitor would make it, one step at a time: the tour fills in Add project,
// creates it, opens it and the first task's list of people, chooses Priya,
// then adds and assigns two more tasks.
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
// (again, if the area it highlights has been replaced), signal ends the
// action when the tour ends, and hurried ends its typing and pauses at once.
// visitorActed is true when the visitor reached the step by pressing the
// previous step's control (TourStep.clickable), so the action leaves out
// what that press already did.
export type TourActionContext = {
  show: () => void;
  signal: AbortSignal;
  hurried?: AbortSignal;
  visitorActed?: boolean;
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

// Add project's Create button, which the visitor may press instead of Next.
export function findCreateButton() {
  return findInWindow<HTMLButtonElement>('button[type="submit"]') ?? undefined;
}

// Opens Add project and fills it in, but leaves Create to the next step.
export async function fillInTourProject({
  show,
  signal,
  hurried,
}: TourActionContext) {
  document.querySelector<HTMLButtonElement>("button.add-project")?.click();
  const title = await waitUntil(
    () => findInWindow<HTMLInputElement>('input[name="title"]'),
    signal,
  );
  show();
  await pause(tourPace.settling, signal, hurried);
  await typeInto(title, tourProject.title, signal, hurried);
  await typeInto(
    findInWindow<HTMLTextAreaElement>('textarea[name="notes"]')!,
    tourProject.notes,
    signal,
    hurried,
  );
  await typeInto(
    findInWindow<HTMLTextAreaElement>('textarea[name="tasks"]')!,
    tourProject.firstTask.title,
    signal,
    hurried,
  );
  // The project goes to the first person, after Unassigned.
  const assignees = document.querySelectorAll<HTMLInputElement>(
    `${windowSelector} input[name="assignee"]`,
  );
  assignees[1]?.click();
}

// Presses Create, unless the visitor did, which closes the window once the
// project is saved, and shows the step on the new project's bar.
export async function createTourProject({
  show,
  signal,
  visitorActed,
}: TourActionContext) {
  if (!visitorActed) findCreateButton()?.click();
  await waitUntil(
    () => !document.querySelector(windowSelector) && findTourProjectBar(),
    signal,
  );
  show();
}

// Opens the tour's project unless it is open, or the visitor has clicked
// its bar, and waits until it can be changed: an opened project is
// read-only until its latest copy has loaded, and a change made before then
// would be lost.
async function openTourProject({
  show,
  signal,
  hurried,
  visitorActed,
}: TourActionContext) {
  if (!visitorActed && !document.querySelector(windowSelector)) {
    (await waitUntil(findTourProjectBar, signal)).click();
  }
  await waitUntil(
    () => findInWindow(".project-form-body:not(.is-read-only)"),
    signal,
  );
  show();
  await pause(tourPace.settling, signal, hurried);
}

// Opens the tour's project again as it was left, for a step in its window
// shown again without acting, unless a window is open or the project is not
// in the list. If the visitor clicked its bar, only waits for it.
export async function reopenTourProject(
  signal: AbortSignal,
  visitorActed = false,
) {
  if (document.querySelector(windowSelector)) return;
  const bar = findTourProjectBar();
  if (!bar) return;
  if (!visitorActed) bar.click();
  await waitUntil(
    () => findInWindow(".project-form-body:not(.is-read-only)"),
    signal,
  );
}

// A task's button showing who it is assigned to, which opens its list.
function findPicker(taskTitle: string) {
  return findInWindow<HTMLButtonElement>(
    `button[data-task-assignee][aria-label^="${taskTitle} is assigned to "]`,
  );
}

const isOpen = (picker: HTMLButtonElement) =>
  picker.getAttribute("aria-expanded") === "true";

// The person's entry in the open list of people, if there is one.
function findPersonOption(person: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".task-assignee-list [role=menuitemradio]",
    ),
  ].find((option) => option.textContent?.startsWith(person));
}

// Opens a task's list of people, unless it is open, and waits for it.
async function openPeopleList(taskTitle: string, signal: AbortSignal) {
  const picker = await waitUntil(() => findPicker(taskTitle), signal);
  if (!isOpen(picker)) picker.click();
  await waitUntil(
    () => document.querySelector(".task-assignee-list [role=menuitemradio]"),
    signal,
  );
  return picker;
}

// Chooses a person, by name, in the task's open list, and waits until the
// task shows them. If no one has that name, the list is closed and the task
// keeps its person.
async function choosePerson(
  picker: HTMLButtonElement,
  person: string,
  signal: AbortSignal,
  hurried?: AbortSignal,
) {
  const option = findPersonOption(person);
  if (!option) {
    picker.click();
    return;
  }
  option.click();
  await waitUntil(() => picker.textContent === person, signal);
  await pause(tourPace.settling, signal, hurried);
}

// Gives a task to a person through the task's own list of people.
async function assignTask(
  taskTitle: string,
  person: string,
  signal: AbortSignal,
  hurried?: AbortSignal,
) {
  const picker = await openPeopleList(taskTitle, signal);
  await pause(tourPace.settling, signal, hurried);
  await choosePerson(picker, person, signal, hurried);
}

// Priya's entry in the first task's open list, which the visitor may choose
// instead of Next.
export function findFirstTaskPerson() {
  return findPersonOption(tourProject.firstTask.person);
}

// Opens the project and the first task's list of people, and leaves the list
// open for the visitor to see. If the person is not there, it is closed.
export async function openFirstTaskList(context: TourActionContext) {
  await openTourProject(context);
  const { title, person } = tourProject.firstTask;
  const picker = await openPeopleList(title, context.signal);
  if (!findPersonOption(person)) picker.click();
}

// Chooses the person in the first task's list, opening it again if the
// press on Next closed it. If the visitor chose them, waits until the task
// shows them.
export async function chooseFirstTaskPerson({
  show,
  signal,
  hurried,
  visitorActed,
}: TourActionContext) {
  const { title, person } = tourProject.firstTask;
  show();
  const picker = await waitUntil(() => findPicker(title), signal);
  if (visitorActed) {
    await waitUntil(() => picker.textContent === person, signal);
    return;
  }
  if (picker.textContent === person) return;
  const wasOpen = isOpen(picker);
  await openPeopleList(title, signal);
  if (!wasOpen) await pause(tourPace.settling, signal, hurried);
  await choosePerson(picker, person, signal, hurried);
}

// Adds both tasks at once, as two lines and one Enter, then assigns each.
export async function addMoreTourTasks(context: TourActionContext) {
  const { signal, hurried } = context;
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
  await pause(tourPace.settling, signal, hurried);
  pressEnter(taskBox);
  // The box clears only once both tasks are saved.
  await waitUntil(() => taskBox.value === "", signal);
  for (const { title, person } of tourProject.moreTasks) {
    await assignTask(title, person, signal, hurried);
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
