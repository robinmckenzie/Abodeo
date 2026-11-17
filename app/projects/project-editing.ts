import type { ProjectSaveFailure } from "./autosave";
import type { DeleteMode } from "./delete-project-dialog";
import type { FormMessage } from "./project-form";
import { newProjectFields, type ProjectFields } from "./projects";
import type { Task } from "./tasks";

// The project being added (id null) or opened, with the values in its form
// and its collapsed bar's height, which an expanded bar grows from. Each
// opening has its own key, so that a bar still squashing after one opening
// is never mistaken for the bar of the next. A new project has the id it
// will be added under in an account, kept for any retry. An account's
// project cannot be changed until its latest copy has loaded, and a field
// changed on another device waits for the person to choose a version.
export type OpenProject = {
  key: string;
  id: string | null;
  newId?: string;
  values: ProjectFields;
  message: FormMessage;
  barHeight: number;
  // Its place in the list when it opened, which it keeps in place while open.
  slot?: number;
  isLoading?: boolean;
  hasConflict?: boolean;
  // A new project's values as sent by each Create, for a retry.
  submitted?: ProjectFields[];
};

// A project being deleted (AD #62 Delete Projects), waiting for the person to
// confirm, as it was when Delete was chosen.
export type Deletion = {
  id: string;
  title: string;
  tasks: Task[];
  imageCount: number;
  appointmentCount: number | null;
  mode: DeleteMode;
  isBusy: boolean;
  message: string | null;
};

export const tasksConflictMessage =
  "These tasks were changed on another device. Your last change was not saved.";

export const changedSinceAddedMessage =
  "This project was added, then changed on another device, so some of your changes were not saved. Cancel to see it as saved.";

export const deleteFailureMessage =
  "Not deleted: Abodeo could not delete this project.";

let openings = 0;

export function createOpeningKey() {
  openings += 1;
  return `opening-${openings}`;
}

export function toggleId(
  ids: ReadonlySet<string>,
  id: string,
  isIncluded: boolean,
) {
  if (ids.has(id) === isIncluded) return ids;
  const next = new Set(ids);
  if (isIncluded) next.add(id);
  else next.delete(id);
  return next;
}

// Whether anything has been entered in the Add project form.
export function isNewProjectChanged(values: ProjectFields) {
  return (Object.keys(values) as (keyof ProjectFields)[]).some(
    (key) =>
      JSON.stringify(values[key]) !== JSON.stringify(newProjectFields[key]),
  );
}

export function joinList(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// What the person is asked before leaving, given what would be lost.
export function describeLosses(losses: string[]) {
  return `Leaving now will lose ${joinList(losses)}.\n\nOK continues without them. Cancel stays here.`;
}

export function pickFormValues({
  title,
  notes,
  assignee,
  dueDate,
  tasks,
}: ProjectFields): ProjectFields {
  return { title, notes, assignee, dueDate, tasks };
}

function isSameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isSameFields(a: ProjectFields, b: ProjectFields) {
  return (
    JSON.stringify(pickFormValues(a)) === JSON.stringify(pickFormValues(b))
  );
}

// A retry of Create, after an answer was lost, gives the project as first
// added. A field still as one of this form's Creates left it is given this
// one's value, as `changes`. One that matches none was changed on another
// device since, and is left as it is, which loses a change (`isLost`) only if
// this form also changed it between Creates.
export function reconcileCreatedProject(
  sending: ProjectFields,
  submitted: ProjectFields[],
  added: ProjectFields,
) {
  const differing = (Object.keys(sending) as (keyof ProjectFields)[]).filter(
    (field) => !isSameValue(sending[field], added[field]),
  );
  const ours = differing.filter((field) =>
    submitted.some((values) => isSameValue(values[field], added[field])),
  );
  const changes: Partial<ProjectFields> = {};
  for (const field of ours) {
    Object.assign(changes, { [field]: sending[field] });
  }
  const isLost = differing.some(
    (field) =>
      !ours.includes(field) &&
      submitted.some((values) => !isSameValue(values[field], sending[field])),
  );
  return { changes, isLost };
}

export function describeFailure(reason: ProjectSaveFailure) {
  const text = {
    "no-title": "A project needs a title.",
    full: "Not saved: this browser's storage for Abodeo is full.",
    unavailable: "Not saved: this browser is not letting Abodeo save.",
    unreadable:
      "Not saved: the saved copy of this project cannot be read, so it has been left as it is.",
    unreachable: "Not saved: Abodeo cannot reach your projects right now.",
    "signed-out": "Not saved: you have been signed out.",
    "account-changed":
      "Not saved: this page is no longer signed in to this account.",
    "not-found": "Not saved: this project is no longer in your account.",
    "too-large": "Not saved: this project is too large to save.",
    "unknown-assignee":
      "Not saved: that person is no longer in the list, so please choose someone else.",
    refused: "Not saved: Abodeo could not accept this change.",
    conflict: "This project was changed on another device.",
  }[reason];
  return { text, isError: true } satisfies FormMessage;
}
