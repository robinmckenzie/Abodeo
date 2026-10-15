import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectForm, type FormMessage } from "./project-form";
import { newProjectFields } from "./projects";

function renderForm(isNew = true, message: FormMessage = null) {
  render(
    <ProjectForm
      values={{ ...newProjectFields, assignee: "boris" }}
      isNew={isNew}
      message={message}
      getFocusField={() => "title"}
      onChange={vi.fn()}
      onFieldFocus={vi.fn()}
      onFieldBlur={vi.fn()}
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("ProjectForm", () => {
  afterEach(cleanup);

  it("offers the four assignees, before the title and notes", () => {
    renderForm();
    const group = screen.getByRole("group", { name: "Assigned to" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => o.closest("label")?.textContent)).toEqual([
      "Unassigned",
      "Andy",
      "Boris",
      "Clement",
    ]);
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(
      group.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the arrow on the selected assignee only, in the same circle", () => {
    renderForm();
    const icons = document.querySelectorAll(".assignee-icon");
    expect(icons).toHaveLength(4);
    icons.forEach((icon) => expect(icon.querySelector("circle")).toBeTruthy());
    const arrows = document.querySelectorAll(".assignee-arrow");
    expect(arrows).toHaveLength(1);
    expect(arrows[0].closest("label")?.textContent).toBe("Boris");
  });

  it("starts with the title focused", () => {
    renderForm();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Title" }),
    );
  });

  it("has a Create button only for a new project", () => {
    renderForm(true);
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    cleanup();
    renderForm(false);
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  });

  it("says changes are saved automatically in an opened project only", () => {
    const note = () => screen.queryByText("Changes saved automatically.");
    renderForm(false);
    expect(note()).toBeTruthy();
    cleanup();
    renderForm(true);
    expect(note()).toBeNull();
  });

  it("does not say changes are saved while a save has failed", () => {
    renderForm(false, { text: "Not saved: full.", isError: true });
    expect(screen.queryByText("Changes saved automatically.")).toBeNull();
  });
});
