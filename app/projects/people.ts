// The people that projects can be assigned to, and the rules for their names,
// without any storage (AD #61 Manage People). A project saves only a person's
// id, so a rename changes no project. Unassigned is not a person: it is always
// offered first, and cannot be added, renamed or removed.
import { isPersonId, unassignedId, type Project } from "./projects";

// A person has a name, a job title or both: the name is empty when only the
// job title is known, and the job title is left out when there is none.
export type Person = { id: string; name: string; jobTitle?: string; phone?: string; email?: string };

export const unassignedName = "Unassigned";
export const personNameMaxLength = 40;
export const personJobTitleMaxLength = 40;

// The people a store that already has projects assigned to them starts with.
export const startingPeople: readonly Person[] = [
  { id: "andy", name: "Andy" },
  { id: "boris", name: "Boris" },
  { id: "clement", name: "Clement" },
];

// The version of the saved form of the list, in the browser and in an account.
export const peopleVersion = 1;

export type PersonNameProblem = "blank" | "too-long" | "duplicate" | "invalid-contact";

export const personNameMessages: Record<PersonNameProblem, string> = {
  blank: "Enter a name or a job title.",
  "too-long": `Use ${personNameMaxLength} characters or fewer.`,
  duplicate: "Someone with that name is already in the list.",
  "invalid-contact": "Use a phone number of at most 100 characters and a valid email of at most 254 characters.",
};

// Surrounding spaces are dropped and runs of spaces become one.
export function normalisePersonName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

// A job title is tidied like a name. Validation rejects overlength text.
export function normalisePersonJobTitle(jobTitle: string | undefined) {
  return normalisePersonName(jobTitle ?? "");
}

export type PersonDetails = { name: string; jobTitle: string; phone: string; email: string };

export function readPersonDetails(person: Omit<Person, "id">): PersonDetails {
  return { name: person.name, jobTitle: person.jobTitle ?? "", phone: person.phone ?? "", email: person.email ?? "" };
}

export function checkPersonDetails(details: PersonDetails, others: readonly Person[]) {
  const jobTitle = normalisePersonJobTitle(details.jobTitle);
  if (jobTitle.length > personJobTitleMaxLength) return { ok: false as const, problem: "too-long" as const };
  const name = checkPersonName(details.name, others, jobTitle !== "");
  if (!name.ok) return name;
  const phone = details.phone.trim();
  const email = details.email.trim();
  if (phone.length > 100 || email.length > 254 || (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false as const, problem: "invalid-contact" as const };
  }
  return { ok: true as const, details: { name: name.name, jobTitle, phone, email } };
}

export function updatePersonDetails(people: readonly Person[], id: string, details: PersonDetails): ListChange {
  if (!people.some(person => person.id === id)) return { ok: false, problem: "not-found" };
  const checked = checkPersonDetails(details, people.filter(person => person.id !== id));
  if (!checked.ok) return checked;
  const { name, jobTitle, phone, email } = checked.details;
  return { ok: true, people: people.map(person => person.id !== id ? person : {
    id, name, ...(jobTitle && { jobTitle }), ...(phone && { phone }), ...(email && { email }),
  }) };
}

function withJobTitle(person: Person, jobTitle: string | undefined): Person {
  const title = normalisePersonJobTitle(jobTitle);
  return title === "" ? person : { ...person, jobTitle: title };
}

function isSameName(a: string, b: string) {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

// The name as it would be kept, or what is wrong with it. "Unassigned" counts
// as taken, as it is always in the list. With a job title, the name may be
// empty, and an empty name is never taken.
export function checkPersonName(
  name: string,
  others: readonly Person[],
  hasJobTitle = false,
): { ok: true; name: string } | { ok: false; problem: PersonNameProblem } {
  const normalised = normalisePersonName(name);
  if (normalised === "") {
    return hasJobTitle
      ? { ok: true, name: "" }
      : { ok: false, problem: "blank" };
  }
  if (normalised.length > personNameMaxLength) {
    return { ok: false, problem: "too-long" };
  }
  if (
    isSameName(normalised, unassignedName) ||
    others.some((other) => isSameName(other.name, normalised))
  ) {
    return { ok: false, problem: "duplicate" };
  }
  return { ok: true, name: normalised };
}

// A new person's id is made by the browser, so that sending the same one
// again, as after a lost answer, finds the person already added.
export function createPersonId() {
  return crypto.randomUUID();
}

export type ListChange =
  | { ok: true; people: Person[] }
  | { ok: false; problem: PersonNameProblem | "not-found" };

export function addPerson(
  people: readonly Person[],
  id: string,
  name: string,
  jobTitle?: string,
): ListChange {
  if (!isPersonId(id)) return { ok: false, problem: "not-found" };
  if (normalisePersonJobTitle(jobTitle).length > personJobTitleMaxLength) return { ok: false, problem: "too-long" };
  const existing = people.find((person) => person.id === id);
  if (existing) {
    // A retry of an add that was received.
    return isSameName(existing.name, normalisePersonName(name))
      ? { ok: true, people: [...people] }
      : { ok: false, problem: "duplicate" };
  }
  const checked = checkPersonName(
    name,
    people,
    normalisePersonJobTitle(jobTitle) !== "",
  );
  if (!checked.ok) return checked;
  return {
    ok: true,
    people: [...people, withJobTitle({ id, name: checked.name }, jobTitle)],
  };
}

export function renamePerson(
  people: readonly Person[],
  id: string,
  name: string,
  jobTitle?: string,
): ListChange {
  if (normalisePersonJobTitle(jobTitle).length > personJobTitleMaxLength) return { ok: false, problem: "too-long" };
  if (!people.some((person) => person.id === id)) {
    return { ok: false, problem: "not-found" };
  }
  const checked = checkPersonName(
    name,
    people.filter((person) => person.id !== id),
    normalisePersonJobTitle(jobTitle) !== "",
  );
  if (!checked.ok) return checked;
  return {
    ok: true,
    people: people.map((person) =>
      person.id === id
        ? withJobTitle({ id, name: checked.name, ...(person.phone && { phone: person.phone }), ...(person.email && { email: person.email }) }, jobTitle)
        : person,
    ),
  };
}

// Moves the person to the place in the list, counted after taking them out.
// Sending the same move again changes nothing more.
export function movePerson(
  people: readonly Person[],
  id: string,
  toIndex: number,
): ListChange {
  const from = people.findIndex((person) => person.id === id);
  if (from === -1) return { ok: false, problem: "not-found" };
  const next = [...people];
  const [person] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, person);
  return { ok: true, people: next };
}

export function removePerson(people: readonly Person[], id: string) {
  return people.filter((person) => person.id !== id);
}

// What a person is called where one line is needed: the name, or the job
// title when the name is not known.
export function describePerson(person: Person) {
  return person.name || person.jobTitle || "";
}

// A project assigned to someone not in the list shows as Unassigned.
export function findAssigneeName(people: readonly Person[], id: string) {
  const person = people.find((other) => other.id === id);
  return person ? describePerson(person) : unassignedName;
}

// The job title shown under the name, which is none when the job title is
// itself shown as the name.
export function findSubtitle(person: Person) {
  return person.name ? person.jobTitle : undefined;
}

// Whether the id is Unassigned or someone in the list.
export function isKnownAssignee(people: readonly Person[], id: string) {
  return id === unassignedId || people.some((person) => person.id === id);
}

export function countAssignedProjects(
  projects: readonly Pick<Project, "assignee">[],
  id: string,
) {
  return projects.filter((project) => project.assignee === id).length;
}

// The list of a store that has none saved yet: whichever of the starting
// people its projects are assigned to, so that projects assigned before the
// list could be changed keep their assignees.
export function derivePeopleFromProjects(
  projects: readonly Pick<Project, "assignee">[],
): Person[] {
  return startingPeople
    .filter((person) => countAssignedProjects(projects, person.id) > 0)
    .map((person) => ({ ...person }));
}

// A list's saved form, as kept in the browser and in an account's row.
export function serialisePeople(people: readonly Person[]) {
  return JSON.stringify({
    version: peopleVersion,
    people: people.map(({ id, name, jobTitle, phone, email }) => ({ id, name, ...(jobTitle && { jobTitle }), ...(phone && { phone }), ...(email && { email }) })),
  });
}

// Reads a list's saved form, or returns null if it is damaged or from a later
// version, so that it is never overwritten with something this version does
// not know about.
export function parsePeople(json: string | null): Person[] | null {
  try {
    return readPeople(JSON.parse(json ?? "null"));
  } catch {
    return null;
  }
}

// As parsePeople, from a value already parsed from JSON.
export function readPeople(saved: unknown): Person[] | null {
  const value = saved as { version?: unknown; people?: unknown } | null;
  if (value?.version !== peopleVersion || !Array.isArray(value.people)) {
    return null;
  }
  const people: Person[] = [];
  for (const entry of value.people) {
    const { id, name, jobTitle, phone, email } = (entry ?? {}) as {
      id?: unknown;
      name?: unknown;
      jobTitle?: unknown;
      phone?: unknown;
      email?: unknown;
    };
    if (!isPersonId(id) || typeof name !== "string") return null;
    if ((phone !== undefined && typeof phone !== "string") || (email !== undefined && typeof email !== "string")) return null;
    const contacts = { ...(typeof phone === "string" && phone && { phone }), ...(typeof email === "string" && email && { email }) };
    const contactCheck = checkPersonDetails({ name, jobTitle: typeof jobTitle === "string" ? jobTitle : "", phone: typeof phone === "string" ? phone : "", email: typeof email === "string" ? email : "" }, people);
    if (!contactCheck.ok || (phone !== undefined && contactCheck.details.phone !== phone) || (email !== undefined && contactCheck.details.email !== email)) return null;
    const checked = checkPersonName(
      name,
      people,
      typeof jobTitle === "string" && jobTitle !== "",
    );
    if (!checked.ok || checked.name !== name) return null;
    if (people.some((person) => person.id === id)) return null;
    if (jobTitle === undefined) {
      people.push({ id, name, ...contacts });
      continue;
    }
    if (
      typeof jobTitle !== "string" ||
      jobTitle === "" ||
      normalisePersonJobTitle(jobTitle) !== jobTitle
    ) {
      return null;
    }
    people.push({ id, name, jobTitle, ...contacts });
  }
  return people;
}

// Where each person in the source list is in the target, by name regardless
// of case. Those without a match are left out.
export function mapAssigneesByName(
  source: readonly Person[],
  target: readonly Person[],
) {
  const mapped = new Map<string, string>();
  for (const person of source) {
    if (person.name === "") continue;
    const match = target.find((other) => isSameName(other.name, person.name));
    if (match) mapped.set(person.id, match.id);
  }
  return mapped;
}
