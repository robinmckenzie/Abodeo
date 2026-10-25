// The people API between the server and the browser, for a signed-in account's
// list of people (AD #61 Manage People). Both sides import it, so it uses
// neither Node nor browser APIs.
import type { Person, PersonNameProblem } from "./people";

export const peoplePath = "/api/people";

// The most a request body may be, in bytes. Provisional.
export const peopleBodyLimit = 16 * 1024;

// The list as saved. With none saved yet, people are those the account's
// projects are assigned to, read-only until a change, the sign-in move or an
// establish saves them, and revision is 0.
export type PeopleResponse = {
  people: Person[];
  revision: number;
  established: boolean;
};

// One change at a time, applied to the list as saved now. Sending an add or a
// remove again, as after a lost answer, changes nothing more.
export type PeopleOperation =
  | { op: "add"; id: string; name: string; jobTitle?: string }
  // A rename also sets the job title, and clears it if none is sent.
  | { op: "rename"; id: string; name: string; jobTitle?: string }
  // dryRun only counts the projects that would be set to Unassigned.
  // expectedCount is the count the person confirmed: if it has changed, nothing
  // is changed.
  | { op: "remove"; id: string; expectedCount?: number; dryRun?: boolean }
  // Saves the list as it is, once the move of the browser's projects is
  // settled.
  | { op: "establish" };

// What removing would change: the readable projects assigned to the person,
// and those that could not be read and so are left as they are.
export type RemovalCount = { count: number; unreadable: number };

export type PeopleErrorCode =
  | "not_signed_in"
  | "invalid_request"
  | "method_not_allowed"
  | "unavailable"
  | "not_found"
  | "account_changed"
  | "too_large"
  // The name is blank or too long, with the problem named.
  | "invalid_name"
  | "duplicate_name"
  | "count_changed"
  // The saved list cannot be read, so it is left as it is.
  | "unreadable";

export type PeopleInvalidName = Exclude<PersonNameProblem, "duplicate">;
