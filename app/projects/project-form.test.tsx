import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
    renderForm(false);
    expect(findAutosaveNote()).toBeTruthy();
    cleanup();
    renderForm(true);
    expect(findAutosaveNote()).toBeNull();
  });

  it("does not say changes are saved while a save has failed", () => {
    renderForm(false, { text: "Not saved: full.", isError: true });
    expect(findAutosaveNote()).toBeNull();
  });
});

// The note is split over two lines, so it is matched as a whole sentence.
function findAutosaveNote() {
  return screen.queryByText(
    (_, element) =>
      element?.tagName === "P" &&
      element.textContent === "Changes saved automatically.",
  );
}

describe("ProjectForm's due date", () => {
  afterEach(cleanup);

  function renderWithDueDate(dueDate: string | null) {
    const onChange = vi.fn();
    render(
      <ProjectForm
        values={{ ...newProjectFields, dueDate }}
        isNew={false}
        message={null}
        getFocusField={() => "start"}
        onChange={onChange}
        onFieldFocus={vi.fn()}
        onFieldBlur={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    return onChange;
  }

  const dueDate = () => screen.getByRole("group", { name: "Due date" });
  const day = (name: string) => screen.getByRole("button", { name });

  it("shows a calendar below the assignees, opening at the due date's month", () => {
    renderWithDueDate("2026-10-16");
    const assignees = screen.getByRole("group", { name: "Assigned to" });
    expect(
      assignees.compareDocumentPosition(dueDate()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "October 2026" })).toBeTruthy();
    expect(day("Friday 16 October 2026").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      within(dueDate()).getAllByRole("button", { pressed: true }),
    ).toHaveLength(1);
  });

  it("opens at this month when there is no due date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 1, 3, 12));
    try {
      renderWithDueDate(null);
      expect(screen.getByRole("group", { name: "February 2027" })).toBeTruthy();
      expect(
        within(dueDate()).queryAllByRole("button", { pressed: true }),
      ).toHaveLength(0);
      expect(
        day("Wednesday 3 February 2027").getAttribute("aria-current"),
      ).toBe("date");
    } finally {
      vi.useRealTimers();
    }
  });

  it("chooses a day", () => {
    const onChange = renderWithDueDate("2026-10-16");
    fireEvent.click(day("Thursday 29 October 2026"));
    expect(onChange).toHaveBeenCalledWith({ dueDate: "2026-10-29" });
  });

  it("moves between months with the arrows", () => {
    const onChange = renderWithDueDate("2026-10-16");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("group", { name: "January 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("group", { name: "December 2026" })).toBeTruthy();
    fireEvent.click(day("Thursday 24 December 2026"));
    expect(onChange).toHaveBeenCalledWith({ dueDate: "2026-12-24" });
  });

  it("clears the due date, with a Clear button shown only when one is set", () => {
    const onChange = renderWithDueDate("2026-10-16");
    fireEvent.click(within(dueDate()).getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith({ dueDate: null });
    cleanup();
    renderWithDueDate(null);
    expect(
      within(dueDate()).queryByRole("button", { name: "Clear" }),
    ).toBeNull();
  });

  it("is one Tab stop, whose arrow keys move between days and months", () => {
    renderWithDueDate("2026-10-30");
    const tabbable = () =>
      within(dueDate())
        .getAllByRole("button", { name: /[0-9]{4}$/ })
        .filter((button) => button.tabIndex === 0);
    expect(tabbable()).toEqual([day("Friday 30 October 2026")]);
    day("Friday 30 October 2026").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(day("Saturday 31 October 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("group", { name: "November 2026" })).toBeTruthy();
    expect(document.activeElement).toBe(day("Saturday 7 November 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(day("Friday 30 October 2026"));
    expect(tabbable()).toEqual([day("Friday 30 October 2026")]);
  });
});
