// What is said when a change to the list of people fails (AD #61 Manage
// People), on the People screen and where someone is added from a project.
import { personNameMessages, type PersonNameProblem } from "./people";
import type { PeopleFailure } from "./account-people";

export type PersonFailure = PeopleFailure | "unavailable";

export function describePersonFailure(reason: PersonFailure) {
  switch (reason) {
    case "blank":
    case "too-long":
    case "duplicate":
      return personNameMessages[reason satisfies PersonNameProblem];
    case "not-found":
      return "That person is no longer in the list.";
    case "list-unreadable":
      return "The list of people cannot be read, so it has been left as it is.";
    case "unavailable":
      return "Not saved: this browser is not letting Abodeo save.";
    case "signed-out":
      return "Not saved: you have been signed out.";
    case "account-changed":
      return "Not saved: this page is no longer signed in to this account.";
    case "too-large":
    case "refused":
    case "unreadable":
    case "unknown-assignee":
      return "Not saved: Abodeo could not accept this change.";
    case "unreachable":
      return "Not saved: Abodeo cannot reach your people right now.";
  }
}
