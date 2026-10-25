import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectBar } from "./project-bar";
import type { Person } from "./people";
import type { Project } from "./projects";

afterEach(cleanup);

const project: Project = {
  id: "p1",
  title: "Bathroom",
  notes: "",
  assignee: "andy",
  dueDate: null,
  tasks: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const people: Person[] = [{ id: "andy", name: "Andy" }];

describe("ProjectBar assignee (AD #61)", () => {
  const bar = (list: Person[] | null, assignee = "andy") => (
    <ul>
      <ProjectBar
        project={{ ...project, assignee }}
        people={list}
        hasUnsavedChanges={false}
        onOpen={() => {}}
      />
    </ul>
  );

  it("shows the person's current name", () => {
    render(bar([{ id: "andy", name: "Anders" }]));
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Bathroom, Anders",
    );
  });

  it("shows Unassigned for someone no longer in the list", () => {
    render(bar(people, "zed"));
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Bathroom, Unassigned",
    );
  });

  it("shows no name while the list is not available", () => {
    render(bar(null));
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Bathroom",
    );
  });
});

describe("ProjectBar thumbnail (AD #48)", () => {
  it("shows the newest image's thumbnail, without changing the bar's label", () => {
    render(
      <ul>
        <ProjectBar
          project={project}
          people={people}
          hasUnsavedChanges={false}
          thumbnailUrl="blob:test/1"
          onOpen={() => {}}
        />
      </ul>,
    );
    const image = document.querySelector(".project-bar-thumbnail");
    expect(image?.getAttribute("src")).toBe("blob:test/1");
    expect(image?.getAttribute("alt")).toBe("");
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Bathroom, Andy",
    );
  });

  it("shows none for a project without images", () => {
    render(
      <ul>
        <ProjectBar
          project={project}
          people={people}
          hasUnsavedChanges={false}
          onOpen={() => {}}
        />
      </ul>,
    );
    expect(document.querySelector(".project-bar-thumbnail")).toBeNull();
  });
});
