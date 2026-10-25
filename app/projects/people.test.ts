import { describe, expect, it } from "vitest";

import {
  addPerson,
  checkPersonName,
  countAssignedProjects,
  derivePeopleFromProjects,
  findAssigneeName,
  isKnownAssignee,
  mapAssigneesByName,
  movePerson,
  normalisePersonName,
  parsePeople,
  removePerson,
  renamePerson,
  serialisePeople,
  personNameMaxLength,
  type Person,
} from "./people";

const andy = { id: "andy", name: "Andy" };
const boris = { id: "boris", name: "Boris" };
const people: Person[] = [andy, boris];

describe("person names", () => {
  it("drops surrounding spaces and joins runs of spaces", () => {
    expect(normalisePersonName("  Mary   Ann \t Lee ")).toBe("Mary Ann Lee");
  });

  it("accepts a name as it would be kept", () => {
    expect(checkPersonName("  Dora  ", people)).toEqual({
      ok: true,
      name: "Dora",
    });
  });

  it("refuses a blank name", () => {
    expect(checkPersonName("   ", people)).toEqual({
      ok: false,
      problem: "blank",
    });
  });

  it("refuses a name over the limit, but accepts one at it", () => {
    expect(checkPersonName("x".repeat(personNameMaxLength), [])).toMatchObject({
      ok: true,
    });
    expect(
      checkPersonName("x".repeat(personNameMaxLength + 1), []),
    ).toMatchObject({ ok: false, problem: "too-long" });
  });

  it("refuses a name already in the list, whatever the case", () => {
    expect(checkPersonName("aNdY", people)).toEqual({
      ok: false,
      problem: "duplicate",
    });
  });

  it("refuses Unassigned, which is always in the list", () => {
    expect(checkPersonName(" UNASSIGNED ", [])).toEqual({
      ok: false,
      problem: "duplicate",
    });
  });
});

describe("changing the list", () => {
  it("adds a person at the end", () => {
    expect(addPerson(people, "c1", "Clement")).toEqual({
      ok: true,
      people: [andy, boris, { id: "c1", name: "Clement" }],
    });
  });

  it("finds a person already added when the same add is sent again", () => {
    expect(addPerson(people, "andy", " andy ")).toEqual({
      ok: true,
      people,
    });
    expect(addPerson(people, "andy", "Someone else")).toEqual({
      ok: false,
      problem: "duplicate",
    });
  });

  it("refuses an id that cannot be one", () => {
    expect(addPerson(people, "unassigned", "Dora").ok).toBe(false);
    expect(addPerson(people, "has space", "Dora").ok).toBe(false);
  });

  it("renames, keeping the id and the order", () => {
    expect(renamePerson(people, "andy", "Anders")).toEqual({
      ok: true,
      people: [{ id: "andy", name: "Anders" }, boris],
    });
  });

  it("lets a person change only the case of their name", () => {
    expect(renamePerson(people, "andy", "ANDY")).toMatchObject({ ok: true });
  });

  it("refuses to rename to another person's name or to someone not there", () => {
    expect(renamePerson(people, "andy", "boris")).toEqual({
      ok: false,
      problem: "duplicate",
    });
    expect(renamePerson(people, "zed", "Zed")).toEqual({
      ok: false,
      problem: "not-found",
    });
  });

  it("removes a person", () => {
    expect(removePerson(people, "andy")).toEqual([boris]);
    expect(removePerson(people, "zed")).toEqual(people);
  });
});

describe("who is assigned", () => {
  it("names the person, and anyone not in the list as Unassigned", () => {
    expect(findAssigneeName(people, "boris")).toBe("Boris");
    expect(findAssigneeName(people, "zed")).toBe("Unassigned");
    expect(findAssigneeName(people, "unassigned")).toBe("Unassigned");
  });

  it("knows Unassigned and the people in the list", () => {
    expect(isKnownAssignee(people, "unassigned")).toBe(true);
    expect(isKnownAssignee(people, "andy")).toBe(true);
    expect(isKnownAssignee(people, "zed")).toBe(false);
  });

  it("counts the projects assigned to a person", () => {
    const projects = [
      { assignee: "andy" },
      { assignee: "boris" },
      { assignee: "andy" },
    ];
    expect(countAssignedProjects(projects, "andy")).toBe(2);
    expect(countAssignedProjects(projects, "zed")).toBe(0);
  });
});

describe("the list a store with no list starts with", () => {
  it("is empty when no project is assigned to Andy, Boris or Clement", () => {
    expect(
      derivePeopleFromProjects([{ assignee: "unassigned" }, { assignee: "z" }]),
    ).toEqual([]);
  });

  it("has those who are assigned, in the order Andy, Boris, Clement", () => {
    expect(
      derivePeopleFromProjects([
        { assignee: "clement" },
        { assignee: "andy" },
        { assignee: "clement" },
      ]),
    ).toEqual([andy, { id: "clement", name: "Clement" }]);
  });
});

describe("the saved list", () => {
  it("reads back what was saved", () => {
    expect(parsePeople(serialisePeople(people))).toEqual(people);
    expect(parsePeople(serialisePeople([]))).toEqual([]);
  });

  it.each([
    ["nothing", null],
    ["damaged JSON", "{"],
    ["a later version", JSON.stringify({ version: 2, people: [] })],
    ["no people", JSON.stringify({ version: 1 })],
    [
      "a person without a name",
      JSON.stringify({ version: 1, people: [{ id: "a" }] }),
    ],
    [
      "an id that cannot be one",
      JSON.stringify({ version: 1, people: [{ id: "unassigned", name: "A" }] }),
    ],
    [
      "the same id twice",
      JSON.stringify({
        version: 1,
        people: [
          { id: "a", name: "A" },
          { id: "a", name: "B" },
        ],
      }),
    ],
    [
      "the same name twice",
      JSON.stringify({
        version: 1,
        people: [
          { id: "a", name: "A" },
          { id: "b", name: "a" },
        ],
      }),
    ],
    [
      "a name not as it would be kept",
      JSON.stringify({ version: 1, people: [{ id: "a", name: " A" }] }),
    ],
  ])("treats %s as unreadable", (_, json) => {
    expect(parsePeople(json)).toBeNull();
  });
});

describe("matching people by name", () => {
  it("maps each person to the one with the same name, whatever the case", () => {
    const mapped = mapAssigneesByName(
      [
        { id: "x1", name: "Andy" },
        { id: "x2", name: "Zoe" },
      ],
      [{ id: "b1", name: "andy" }],
    );
    expect([...mapped]).toEqual([["x1", "b1"]]);
  });
});

describe("job titles", () => {
  it("adds a person with a tidied job title, or none", () => {
    expect(addPerson(people, "c1", "Clement", "  Site   manager ")).toEqual({
      ok: true,
      people: [
        andy,
        boris,
        { id: "c1", name: "Clement", jobTitle: "Site manager" },
      ],
    });
    expect(addPerson(people, "c1", "Clement", "  ")).toEqual({
      ok: true,
      people: [andy, boris, { id: "c1", name: "Clement" }],
    });
  });

  it("sets and clears a job title when renaming", () => {
    const titled = renamePerson(people, "andy", "Andy", "Plumber");
    expect(titled).toEqual({
      ok: true,
      people: [{ ...andy, jobTitle: "Plumber" }, boris],
    });
    expect(
      renamePerson((titled as { people: Person[] }).people, "andy", "Andy"),
    ).toEqual({ ok: true, people });
  });

  it("keeps a job title through saving and reading", () => {
    const titled = [{ ...andy, jobTitle: "Plumber" }, boris];
    expect(parsePeople(serialisePeople(titled))).toEqual(titled);
  });
});

describe("moving a person", () => {
  it("moves them to a place in the list", () => {
    expect(movePerson(people, "andy", 1)).toEqual({
      ok: true,
      people: [boris, andy],
    });
    expect(movePerson(people, "boris", 0)).toEqual({
      ok: true,
      people: [boris, andy],
    });
  });

  it("keeps a move to the same place as it is, and refuses someone not in the list", () => {
    expect(movePerson(people, "andy", 0)).toEqual({ ok: true, people });
    expect(movePerson(people, "nobody", 0)).toEqual({
      ok: false,
      problem: "not-found",
    });
  });
});
