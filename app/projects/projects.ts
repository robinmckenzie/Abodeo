// Projects and the rules for their fields, without any storage, so that the
// same rules can apply whether projects are kept in the browser or, later, in
// a database.

// Hard-coded for now. The ids are what is saved, so that the names shown can
// change without affecting saved projects.
export const assignees = [
  { id: "unassigned", name: "Unassigned" },
  { id: "andy", name: "Andy" },
  { id: "boris", name: "Boris" },
  { id: "clement", name: "Clement" },
] as const;

export type AssigneeId = (typeof assignees)[number]["id"];

export type ProjectFields = {
  title: string;
  notes: string;
  assignee: AssigneeId;
};

export type Project = ProjectFields & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const newProjectFields: ProjectFields = {
  title: "",
  notes: "",
  assignee: "unassigned",
};

// The version of the saved form of a project. A project saved by a later
// version of the app counts as unreadable, so that it is never overwritten
// with fields this version does not know about.
export const projectVersion = 1;

export function hasTitle(title: string) {
  return title.trim() !== "";
}

export function isAssigneeId(value: unknown): value is AssigneeId {
  return assignees.some((assignee) => assignee.id === value);
}

export function findAssigneeName(id: AssigneeId) {
  return assignees.find((assignee) => assignee.id === id)?.name ?? id;
}

// A project's saved form, as kept under its own storage entry. The id is in
// the entry's name, not here.
export function serialiseProject(project: Project) {
  const { title, notes, assignee, createdAt, updatedAt } = project;
  return JSON.stringify({
    version: projectVersion,
    title,
    notes,
    assignee,
    createdAt,
    updatedAt,
  });
}

// Reads a project's saved form, or returns null if it is damaged, incomplete
// or from a later version.
export function parseProject(id: string, json: string | null): Project | null {
  try {
    const saved = JSON.parse(json ?? "null");
    if (
      saved?.version !== projectVersion ||
      typeof saved.title !== "string" ||
      !hasTitle(saved.title) ||
      typeof saved.notes !== "string" ||
      !isAssigneeId(saved.assignee) ||
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
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  } catch {
    return null;
  }
}

// Oldest first. Projects created in the same millisecond keep a stable order.
export function sortProjects(projects: Project[]) {
  return [...projects].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
