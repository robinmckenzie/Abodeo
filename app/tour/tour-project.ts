// The demo tour's own project (AD #160 Tour Creates A Project), made as a
// visitor would make it, one step at a time: the tour fills in Add project,
// chooses its due date, creates it, opens it and the first task's list of
// people, chooses Priya, adds and assigns two more tasks, then fills in and
// saves an appointment in Google Calendar (AD #161 Tour Appointment).
import {
  describeDueDate,
  findNextFriday,
  findToday,
  findWeekday,
} from "../projects/due-date";

import { appointmentsUnavailableMessage } from "../projects/project-appointments";

import {
  pause,
  pressEnter,
  setFieldValue,
  tourPace,
  typeInto,
  waitUntil,
} from "./tour-page";

export const tourProject = {
  title: "Bake for the barn dance",
  get notes() {
    return `Something sweet for ${describeTourDance()}.`;
  },
  firstTask: { title: "Buy flour and butter", person: "Priya" },
  moreTasks: [
    { title: "Bake two trays of scones", person: "Sam" },
    { title: "Pack them in the tin", person: "Priya" },
  ],
};

// The appointment the tour adds to the project. It starts at the form's own
// next whole hour.
export const tourAppointment = {
  title: "Barn dance planning",
  notes: "Agree who brings what.",
};

// What a step's action is given: show puts the step's bubble on the page
// (again, if the area it highlights has been replaced), refresh fits the
// highlight to an area that has changed size, describe changes the shown
// bubble's wording (HTML) once the action knows how things went, signal ends
// the action when the tour ends, and hurried ends its typing and pauses at
// once.
// visitorActed is true when the visitor reached the step by pressing the
// previous step's control (TourStep.clickable), so the action leaves out
// what that press already did.
export type TourActionContext = {
  show: () => void;
  refresh?: () => void;
  describe?: (html: string) => void;
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

// The project's due date: the Friday before the barn dance, the first
// Friday after today.
export function findTourDueDate(today = findToday()) {
  return findNextFriday(today);
}

// When the barn dance is, the day after the due date: "next Saturday" on
// a Friday or a Saturday, when it is more than a week away, and otherwise
// "Saturday".
export function describeTourDance(today = findToday()) {
  const weekday = findWeekday(today);
  return weekday === "Friday" || weekday === "Saturday"
    ? "next Saturday"
    : "Saturday";
}

// When the baking is due, for the Due date step: "tomorrow" on a Thursday,
// and otherwise "on Friday".
export function describeTourBakingDay(today = findToday()) {
  return findWeekday(today) === "Thursday" ? "tomorrow" : "on Friday";
}

// Chooses the due date in Add project's calendar, moving to the next month
// if the day is not in the one shown. A day chosen already is left.
export async function chooseTourDueDate({
  show,
  signal,
  hurried,
}: TourActionContext) {
  const name = describeDueDate(findTourDueDate());
  const findDay = () =>
    findInWindow<HTMLButtonElement>(
      `button[name="dueDate"][aria-label="${name}"]`,
    ) ?? undefined;
  await waitUntil(() => findInWindow(".due-date-picker"), signal);
  show();
  await pause(tourPace.settling, signal, hurried);
  if (!findDay()) {
    findInWindow<HTMLButtonElement>('button[name="dueDate-next"]')?.click();
    await waitUntil(findDay, signal);
    await pause(tourPace.settling, signal, hurried);
  }
  const day = findDay()!;
  if (day.getAttribute("aria-pressed") !== "true") day.click();
  await waitUntil(
    () => findDay()?.getAttribute("aria-pressed") === "true",
    signal,
  );
}

// Presses Create, unless the visitor did, which closes the window once the
// project is saved, and shows the step on the new project's bar. Acting
// again after Back, with the project created and open, it closes it.
export async function createTourProject({
  show,
  signal,
  visitorActed,
}: TourActionContext) {
  if (!visitorActed) {
    const create = findCreateButton();
    if (create) create.click();
    else await closeProjectWindow(signal);
  }
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

// The opened project's appointments, in the window.
export function findAppointmentsSection() {
  return findInWindow('section[aria-label="Appointments"]') ?? undefined;
}

function findAppointmentForm() {
  return findInWindow('[role="group"][aria-label="New appointment"]');
}

// The new appointment form's Save button, which the visitor may press
// instead of Next.
export function findSaveButton() {
  return (
    findInWindow<HTMLButtonElement>(
      ".appointment-form-buttons button:first-child",
    ) ?? undefined
  );
}

function findAddAppointmentButton() {
  return findInWindow<HTMLButtonElement>(
    'button[aria-label="Add appointment"]',
  );
}

// The tour's appointment in the project's list, once it is there.
export function findTourAppointment() {
  return [
    ...document.querySelectorAll(
      `${windowSelector} .appointment-entry .appointment-title`,
    ),
  ].find((title) => title.textContent === tourAppointment.title);
}

// Whether the section says that something went wrong: the list could not be
// shown, or the form could not be opened.
function hasAppointmentsAlert() {
  return [
    ...(findAppointmentsSection()?.querySelectorAll('[role="alert"]') ?? []),
  ].some((alert) => !alert.classList.contains("appointment-error"));
}

const isSettled = (section: Element) =>
  !/Loading appointments…|Connecting to Google Calendar…/.test(
    section.textContent ?? "",
  );

// Waits until the appointments have loaded, and gives whether an
// appointment can be added: false when they cannot be shown, Google
// Calendar has to be connected first, or no one is signed in.
export async function waitForAppointments(signal: AbortSignal) {
  const section = await waitUntil(
    () => {
      const found = findAppointmentsSection();
      return found && isSettled(found) && found;
    },
    signal,
  );
  return Boolean(
    section.querySelector('[role="group"][aria-label="New appointment"]') ??
      findAddAppointmentButton(),
  );
}

// Whether the tour's last try added its appointment, for the wording of
// "In Google Calendar" shown again, when the list may still be loading.
let isTourAppointmentAdded = false;

export function wasTourAppointmentAdded() {
  return isTourAppointmentAdded;
}

export const tourAppointmentAddedText =
  "The appointment is now in the demo account's Google Calendar, and shows in the project.";
export const tourAppointmentFailedText =
  "Google Calendar could not be reached just now, so the appointment was not added. You can add one yourself after the tour.";

// Closes the new appointment form with its Cancel button, if it is open.
export function cancelAppointmentForm() {
  findInWindow<HTMLButtonElement>(
    ".appointment-form-buttons button:last-child",
  )?.click();
}

function failToAddAppointment(context: TourActionContext) {
  isTourAppointmentAdded = false;
  cancelAppointmentForm();
  context.describe?.(tourAppointmentFailedText);
}

// Opens the project and its new appointment form, unless the form is open
// from an earlier visit, and fills it in at once, leaving Save to the next
// step. If Google Calendar cannot be reached, says so instead.
export async function fillInTourAppointment(context: TourActionContext) {
  const { signal, hurried } = context;
  await openTourProject(context);
  if (!findAppointmentForm()) {
    if (!(await waitForAppointments(signal))) {
      failToAddAppointment(context);
      return;
    }
    findAddAppointmentButton()?.click();
    const opened = await waitUntil(() => {
      const section = findAppointmentsSection();
      if (findAppointmentForm()) return "form";
      if (hasAppointmentsAlert()) return "failed";
      if (section && isSettled(section) && !findAddAppointmentButton()) {
        return "failed";
      }
      return false;
    }, signal);
    if (opened === "failed") {
      failToAddAppointment(context);
      return;
    }
  }
  const form = findAppointmentForm()!;
  setFieldValue(
    form.querySelector<HTMLInputElement>('input[type="text"]')!,
    tourAppointment.title,
  );
  setFieldValue(form.querySelector("textarea")!, tourAppointment.notes);
  context.refresh?.();
  await pause(tourPace.settling, signal, hurried);
}

// Presses Save, unless the visitor did, and waits for Google Calendar's
// answer: the appointment in the project's list, or a failure, when the form
// is closed and the bubble says so.
export async function addTourAppointment(context: TourActionContext) {
  const { show, signal, visitorActed } = context;
  show();
  if (!visitorActed) {
    const save = findSaveButton();
    if (!save) {
      failToAddAppointment(context);
      return;
    }
    save.click();
  }
  const outcome = await waitUntil(() => {
    if (findInWindow(".appointment-error")) return "failed";
    if (findAppointmentForm()) return false;
    if (findTourAppointment()) return "added";
    const section = findAppointmentsSection();
    if (
      !section ||
      section.textContent?.includes(appointmentsUnavailableMessage)
    ) {
      return "failed";
    }
    return false;
  }, signal);
  if (outcome === "failed") {
    failToAddAppointment(context);
    return;
  }
  isTourAppointmentAdded = true;
  context.refresh?.();
  context.describe?.(tourAppointmentAddedText);
}
