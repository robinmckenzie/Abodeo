// Keeps the list of people in the browser's local storage, for use while signed
// out (AD #61 Manage People). It is one entry holding the whole ordered list.
// A signed-in account's list is never kept here (see account-people.ts). This
// is the only code that touches the list in browser storage; what is done with
// it, such as removing someone from the projects, is in people-management.ts.
import { parsePeople, serialisePeople, type Person } from "./people";

export const peopleKey = "abodeo-people";

// Removal and assignment in different tabs take turns on this lock, where the
// browser has Web Locks.
const lockName = "abodeo-people";

export type StoredPeople =
  | { state: "absent" }
  // Damaged or from a later version: left as it is.
  | { state: "unreadable" }
  | { state: "unavailable" }
  | { state: "found"; people: Person[] };

export function readStoredPeople(): StoredPeople {
  let json: string | null;
  try {
    json = localStorage.getItem(peopleKey);
  } catch {
    return { state: "unavailable" };
  }
  if (json === null) return { state: "absent" };
  const people = parsePeople(json);
  return people ? { state: "found", people } : { state: "unreadable" };
}

export function writeStoredPeople(people: readonly Person[]) {
  try {
    localStorage.setItem(peopleKey, serialisePeople(people));
    return true;
  } catch {
    return false;
  }
}

export function removeStoredPeople() {
  try {
    localStorage.removeItem(peopleKey);
  } catch {
    // The list is kept.
  }
}

export function isPeopleKey(key: string | null) {
  return key === null || key === peopleKey;
}

export function hasWebLocks() {
  return typeof navigator !== "undefined" && navigator.locks !== undefined;
}

// Runs the work once no other tab is changing who is in the list or assigned
// to a project. Without Web Locks, it runs at once.
export async function withPeopleLock<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  if (!hasWebLocks()) return work();
  return navigator.locks.request(lockName, work);
}
