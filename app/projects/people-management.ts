// Changing the list of people in the browser while signed out (AD #61 Manage
// People): the first read, adding, renaming and removing. Removing someone
// also sets their projects to Unassigned, so this uses both the people's
// storage and the projects'.
import {
  addPerson,
  countAssignedProjects,
  movePerson,
  derivePeopleFromProjects,
  removePerson,
  renamePerson,
  type ListChange,
  type Person,
} from "./people";
import {
  hasWebLocks,
  readStoredPeople,
  withPeopleLock,
  writeStoredPeople,
} from "./people-storage";
import { loadProjects, saveProjectChanges } from "./project-storage";
import { unassignedId } from "./projects";

export type PeopleLoad =
  | { ok: true; people: Person[] }
  | { ok: false; reason: "unreadable" | "unavailable" };

// The saved list. With none saved yet, it is whichever of the starting people
// the browser's projects are assigned to, and is saved then so that it stays
// as it is. A list that cannot be read is left as it is. The caller receives
// the default projects first, so that their assignees are the ones counted.
export function loadPeople(): PeopleLoad {
  const stored = readStoredPeople();
  if (stored.state === "found") return { ok: true, people: stored.people };
  if (stored.state !== "absent") return { ok: false, reason: stored.state };
  const loaded = loadProjects();
  if (!loaded.ok) return { ok: false, reason: "unavailable" };
  const people = derivePeopleFromProjects(loaded.projects);
  // Nothing is written for an empty list, as none of the projects can be
  // assigned to anyone yet, so there is nothing to keep fixed.
  if (people.length > 0 && !writeStoredPeople(people)) {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, people };
}

export type PeopleChangeResult =
  | { ok: true; people: Person[]; person?: Person }
  | { ok: false; reason: Extract<ListChange, { ok: false }>["problem"] }
  | { ok: false; reason: "unreadable" | "unavailable" };

// Applies the change to the list as saved now, so that a change made in
// another tab is kept.
async function changeList(
  change: (people: Person[]) => ListChange,
): Promise<PeopleChangeResult> {
  return withPeopleLock(async () => {
    const loaded = loadPeople();
    if (!loaded.ok) return loaded;
    const changed = change(loaded.people);
    if (!changed.ok) return { ok: false, reason: changed.problem };
    if (!writeStoredPeople(changed.people)) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, people: changed.people };
  });
}

export function addStoredPerson(id: string, name: string, jobTitle?: string) {
  return changeList((people) => addPerson(people, id, name, jobTitle));
}

export function renameStoredPerson(
  id: string,
  name: string,
  jobTitle?: string,
) {
  return changeList((people) => renamePerson(people, id, name, jobTitle));
}

export function moveStoredPerson(id: string, toIndex: number) {
  return changeList((people) => movePerson(people, id, toIndex));
}

// How many readable projects are assigned to the person.
export function countStoredAssignedProjects(id: string) {
  const loaded = loadProjects();
  return loaded.ok ? countAssignedProjects(loaded.projects, id) : null;
}

export type RemovalResult =
  | { ok: true; people: Person[] }
  // The projects assigned changed since the person was shown the count.
  | { ok: false; reason: "count-changed"; count: number }
  | { ok: false; reason: "unreadable" | "unavailable" };

// Removes the person and sets their projects to Unassigned. With Web Locks,
// the projects go first, so that a failure part way leaves the person in the
// list and the removal can be tried again, and no other tab can assign them
// meanwhile. Without, the list goes first, so that no tab can assign them
// once it is saved, and a sweep then sets right anything assigned in between.
// Projects that cannot be read are left as they are. Not atomic: a failure
// part way leaves some projects changed.
export function removeStoredPerson(
  id: string,
  expectedCount?: number,
): Promise<RemovalResult> {
  return withPeopleLock(async (): Promise<RemovalResult> => {
    const loaded = loadPeople();
    if (!loaded.ok) return loaded;
    if (!loaded.people.some((person) => person.id === id)) {
      return { ok: true, people: loaded.people };
    }
    const projects = loadProjects();
    if (!projects.ok) return { ok: false, reason: "unavailable" };
    const affected = projects.projects.filter(
      (project) => project.assignee === id,
    );
    if (expectedCount !== undefined && expectedCount !== affected.length) {
      return { ok: false, reason: "count-changed", count: affected.length };
    }
    const people = removePerson(loaded.people, id);
    const unassign = async (ids: string[]) => {
      for (const projectId of ids) {
        const result = await saveProjectChanges(projectId, {
          assignee: unassignedId,
        });
        // A project that cannot be read or has gone is left as it is.
        if (!result.ok && result.reason === "unavailable") return false;
        if (!result.ok && result.reason === "full") return false;
      }
      return true;
    };
    if (hasWebLocks()) {
      if (!(await unassign(affected.map((project) => project.id)))) {
        return { ok: false, reason: "unavailable" };
      }
      if (!writeStoredPeople(people)) {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, people };
    }
    if (!writeStoredPeople(people)) {
      return { ok: false, reason: "unavailable" };
    }
    const sweepIds = (): string[] => {
      const current = loadProjects();
      if (!current.ok) return [];
      return current.projects
        .filter(
          (project) =>
            project.assignee !== unassignedId &&
            !people.some((person) => person.id === project.assignee),
        )
        .map((project) => project.id);
    };
    if (!(await unassign(sweepIds()))) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, people };
  });
}
