import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectBar } from "./project-bar";
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

describe("ProjectBar thumbnail (AD #48)", () => {
  it("shows the newest image's thumbnail, without changing the bar's label", () => {
    render(
      <ul>
        <ProjectBar
          project={project}
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
          hasUnsavedChanges={false}
          onOpen={() => {}}
        />
      </ul>,
    );
    expect(document.querySelector(".project-bar-thumbnail")).toBeNull();
  });
});
