// Saving a change to a project that may have been changed elsewhere, such as
// on another device, without any storage. A save says, for each field it
// changes, the value it was based on, so that a field changed since is
// refused rather than silently replaced.
import { isCalendarDate } from "./due-date";
import {
  hasTitle,
  isAssigneeId,
  type Project,
  type ProjectFields,
} from "./projects";
import { isTask, type Task } from "./tasks";

export type ProjectField = keyof ProjectFields;

export const projectFields: readonly ProjectField[] = [
  "title",
  "notes",
  "assignee",
  "dueDate",
  "tasks",
];

export function isSameFieldValue(
  field: ProjectField,
  a: ProjectFields[ProjectField],
  b: ProjectFields[ProjectField],
) {
  if (field !== "tasks") return a === b;
  return isSameTasks(a as Task[], b as Task[]);
}

function isSameTasks(a: Task[], b: Task[]) {
  return (
    a.length === b.length &&
    a.every(
      (task, index) =>
        task.id === b[index].id &&
        task.title === b[index].title &&
        task.isDone === b[index].isDone,
    )
  );
}

// The fields being changed whose saved value is no longer the one the change
// was based on.
export function findConflictingFields(
  saved: ProjectFields,
  base: Partial<ProjectFields>,
  changes: Partial<ProjectFields>,
): ProjectField[] {
  return projectFields.filter(
    (field) =>
      changes[field] !== undefined &&
      !isSameFieldValue(field, saved[field], base[field]!),
  );
}

export function applyProjectChanges(
  saved: Project,
  changes: Partial<ProjectFields>,
  now: string,
): Project {
  const next = { ...saved, updatedAt: now };
  for (const field of projectFields) {
    if (changes[field] !== undefined) {
      Object.assign(next, { [field]: copyValue(field, changes[field]) });
    }
  }
  return next;
}

function copyValue(field: ProjectField, value: unknown) {
  if (field !== "tasks") return value;
  return (value as Task[]).map(({ id, title, isDone }) => ({
    id,
    title,
    isDone,
  }));
}

// Whether a value would be valid as a saved project's field. A title must
// not be blank.
export function isValidFieldValue(field: ProjectField, value: unknown) {
  switch (field) {
    case "title":
      return typeof value === "string" && hasTitle(value);
    case "notes":
      return typeof value === "string";
    case "assignee":
      return isAssigneeId(value);
    case "dueDate":
      return value === null || isCalendarDate(value);
    case "tasks":
      return Array.isArray(value) && value.every(isTask);
  }
}

// Only the project's fields, each valid, from a request body. Anything else
// is dropped. Undefined if any field given is not valid.
export function readProjectFields(
  value: unknown,
): Partial<ProjectFields> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields: Partial<ProjectFields> = {};
  for (const field of projectFields) {
    if (!(field in value)) continue;
    const fieldValue = (value as Record<string, unknown>)[field];
    if (!isValidFieldValue(field, fieldValue)) return undefined;
    Object.assign(fields, { [field]: copyValue(field, fieldValue) });
  }
  return fields;
}

// A save's changes and the base of each, from a request body. Every changed
// field needs a base, and at least one field must change. Undefined if not
// valid.
export function readProjectSave(
  body: unknown,
):
  | { base: Partial<ProjectFields>; changes: Partial<ProjectFields> }
  | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { base, changes } = body as { base?: unknown; changes?: unknown };
  const readChanges = readProjectFields(changes);
  // A saved title is never blank, but a base is only compared, so it is
  // read leniently.
  const readBase = readBaseFields(base);
  if (!readChanges || !readBase) return undefined;
  const changed = projectFields.filter((f) => readChanges[f] !== undefined);
  if (changed.length === 0) return undefined;
  if (changed.some((field) => readBase[field] === undefined)) return undefined;
  return { base: readBase, changes: readChanges };
}

function readBaseFields(value: unknown): Partial<ProjectFields> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields: Partial<ProjectFields> = {};
  for (const field of projectFields) {
    if (!(field in value)) continue;
    const fieldValue = (value as Record<string, unknown>)[field];
    const isValid =
      field === "title"
        ? typeof fieldValue === "string"
        : isValidFieldValue(field, fieldValue);
    if (!isValid) return undefined;
    Object.assign(fields, { [field]: copyValue(field, fieldValue) });
  }
  return fields;
}
