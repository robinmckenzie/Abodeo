// Projects and the rules for their fields, without any storage, so that the
// same rules can apply whether projects are kept in the browser or, later, in
// a database.
import { isCalendarDate } from "./due-date";
import { isTask, type Task } from "./tasks";

// What is saved is a person's id, so that the names shown can change without
// affecting saved projects. Unassigned is not a person (see people.ts).
export const unassignedId = "unassigned";

export type ProjectFields = {
  title: string;
  notes: string;
  assignee: string;
  // "YYYY-MM-DD", or null for none.
  dueDate: string | null;
  tasks: Task[];
};

export type Project = ProjectFields & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const newProjectFields: ProjectFields = {
  title: "",
  notes: "",
  assignee: unassignedId,
  dueDate: null,
  tasks: [],
};

// The version of the saved form of a project. A project saved by a later
// version of the app counts as unreadable, so that it is never overwritten
// with fields this version does not know about. Version 1 had no due date,
// and versions 1 and 2 had no tasks.
const versionWithoutDueDate = 1;
const versionWithoutTasks = 2;
export const projectVersion = 3;

// Whether this version of the app can read a project saved in the given
// version: the current one, or an older one that lacked some fields.
function isReadableVersion(version: unknown) {
  return [versionWithoutDueDate, versionWithoutTasks, projectVersion].includes(
    version as number,
  );
}

export function hasTitle(title: string) {
  return title.trim() !== "";
}

// Whether a value could be a person's id: its shape only. Who exists is for
// the list of people to say, so that reading a project never needs it, and a
// project never becomes unreadable because a person was removed.
export function isPersonId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== unassignedId &&
    /^[\w-]{1,100}$/.test(value)
  );
}

export function isAssigneeId(value: unknown): value is string {
  return value === unassignedId || isPersonId(value);
}

// A project's saved form, as kept under its own storage entry. The id is in
// the entry's name, not here.
export function serialiseProject(project: Project) {
  const { title, notes, assignee, dueDate, tasks, createdAt, updatedAt } =
    project;
  return JSON.stringify({
    version: projectVersion,
    title,
    notes,
    assignee,
    dueDate,
    tasks: tasks.map(({ id, title, isDone }) => ({ id, title, isDone })),
    createdAt,
    updatedAt,
  });
}

// Reads a project's saved form, or returns null if it is damaged, incomplete
// or from a later version. A project saved before due dates or tasks has
// none.
export function parseProject(id: string, json: string | null): Project | null {
  try {
    const saved = JSON.parse(json ?? "null");
    const version = saved?.version;
    const dueDate = version === versionWithoutDueDate ? null : saved?.dueDate;
    const tasks =
      version === versionWithoutDueDate || version === versionWithoutTasks
        ? []
        : saved?.tasks;
    if (
      !isReadableVersion(version) ||
      typeof saved.title !== "string" ||
      !hasTitle(saved.title) ||
      typeof saved.notes !== "string" ||
      !isAssigneeId(saved.assignee) ||
      (dueDate !== null && !isCalendarDate(dueDate)) ||
      !Array.isArray(tasks) ||
      !tasks.every(isTask) ||
      typeof saved.createdAt !== "string" ||
      typeof saved.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      id,
      title: saved.title,
      notes: saved.notes,
      assignee: saved.assignee,
      dueDate,
      tasks: tasks.map(({ id, title, isDone }: Task) => ({
        id,
        title,
        isDone,
      })),
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  } catch {
    return null;
  }
}

// Earliest due date first, then those without a due date by title. Equal ones
// keep a stable order. This is the order the dashboard shows.
export function sortProjectsByDueDate(projects: Project[]) {
  return [...projects].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return (
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  });
}

// Oldest first. Projects created in the same millisecond keep a stable order.
export function sortProjects(projects: Project[]) {
  return [...projects].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
