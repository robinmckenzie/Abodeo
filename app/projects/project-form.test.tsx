import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Person } from "./people";
import { ProjectForm, type AddPerson, type FormMessage } from "./project-form";
import { newProjectFields } from "./projects";

const people: Person[] = [
  { id: "andy", name: "Andy" },
  { id: "boris", name: "Boris" },
  { id: "clement", name: "Clement" },
];

function renderForm(
  isNew = true,
  message: FormMessage = null,
  extra: {
    people?: Person[];
    onAddPerson?: AddPerson;
    onChange?: () => void;
    assignee?: string;
  } = {},
) {
  render(
    <ProjectForm
      values={{ ...newProjectFields, assignee: extra.assignee ?? "boris" }}
      isNew={isNew}
      people={extra.people ?? people}
      onAddPerson={extra.onAddPerson}
      message={message}
      getFocusField={() => "title"}
      onChange={extra.onChange ?? vi.fn()}
      onFieldFocus={vi.fn()}
      onFieldBlur={vi.fn()}
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("ProjectForm", () => {
  afterEach(cleanup);

  it("shows an opened project's appointments below its images", () => {
    render(
      <ProjectForm
        values={{ ...newProjectFields, assignee: "boris" }}
        people={people}
        isNew={false}
        message={null}
        getFocusField={() => "title"}
        onChange={vi.fn()}
        onFieldFocus={vi.fn()}
        onFieldBlur={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        images={<p>Images here</p>}
        appointments={<p>Appointments here</p>}
      />,
    );

    const images = screen.getByText("Images here");
    const appointments = screen.getByText("Appointments here");
    expect(
      images.compareDocumentPosition(appointments) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers Unassigned and then the people, before the title and notes", () => {
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

  it("offers only Unassigned when there are no people", () => {
    renderForm(true, null, { people: [], assignee: "unassigned" });
    const group = screen.getByRole("group", { name: "Assigned to" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((o) => o.closest("label")?.textContent),
    ).toEqual(["Unassigned"]);
  });

  it("shows someone no longer in the list as Unassigned", () => {
    renderForm(true, null, { assignee: "zed" });
    const unassigned = screen.getByRole("radio", { name: "Unassigned" });
    expect((unassigned as HTMLInputElement).checked).toBe(true);
  });

  it("lets Unassigned be chosen for someone no longer in the list", () => {
    const onChange = vi.fn();
    renderForm(true, null, { assignee: "zed", onChange });
    fireEvent.click(screen.getByRole("radio", { name: "Unassigned" }));
    expect(onChange).toHaveBeenCalledWith({ assignee: "unassigned" });
  });

  it("does not delay the form by the length of the list", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `p${i}`,
      name: `Person ${i}`,
    }));
    renderForm(true, null, { people: many });
    const arrivals = [
      ...document.querySelectorAll<HTMLElement>(".assignee-option"),
    ].map((label) => Number(label.style.getPropertyValue("--arrival")));
    expect(Math.max(...arrivals)).toBeLessThanOrEqual(4);
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
        people={people}
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

  it("goes no further than the dates that can be saved", () => {
    const onChange = renderWithDueDate("9999-12-31");
    day("Friday 31 December 9999").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("group", { name: "December 9999" })).toBeTruthy();
    expect(document.activeElement).toBe(day("Friday 31 December 9999"));
    cleanup();
    renderWithDueDate("0000-01-01");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    day("Saturday 1 January 0").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("group", { name: "January 0" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers a box for tasks in a new project only", () => {
    renderForm();
    expect(
      screen.getByRole("textbox", { name: "Add tasks, one per line" }),
    ).toBeTruthy();
    cleanup();
    renderForm(false);
    expect(
      screen.queryByRole("textbox", { name: "Add tasks, one per line" }),
    ).toBeNull();
  });

  it("turns the lines typed into tasks, ignoring blank lines", () => {
    const onChange = vi.fn();
    render(
      <ProjectForm
        values={newProjectFields}
        people={people}
        isNew
        message={null}
        getFocusField={() => "title"}
        onChange={onChange}
        onFieldFocus={vi.fn()}
        onFieldBlur={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Add tasks, one per line" }),
      { target: { value: "Buy paint\n\n  Fetch ladder  \n- [x] Hang door" } },
    );
    const { tasks } = onChange.mock.calls.at(-1)![0];
    expect(
      tasks.map((t: { title: string; isDone: boolean }) => [t.title, t.isDone]),
    ).toEqual([
      ["Buy paint", false],
      ["Fetch ladder", false],
      ["Hang door", false],
    ]);
  });
});

describe("ProjectForm's box to add a person (AD #61)", () => {
  afterEach(cleanup);

  const box = () => screen.getByRole("textbox", { name: "Add a person" });

  it("has no box without a way to add someone", () => {
    renderForm();
    expect(screen.queryByRole("textbox", { name: "Add a person" })).toBeNull();
  });

  it("sits below the people, inside Assigned to", () => {
    renderForm(true, null, { onAddPerson: vi.fn() });
    const group = screen.getByRole("group", { name: "Assigned to" });
    expect(group.contains(box())).toBe(true);
    const last = within(group).getByRole("radio", { name: "Clement" });
    expect(
      last.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("adds the person on Enter and chooses them, without creating the project", async () => {
    const person = { id: "new-id", name: "Dora" };
    const onAddPerson = vi.fn().mockResolvedValue({ ok: true, person });
    const onChange = vi.fn();
    renderForm(true, null, { onAddPerson, onChange });
    fireEvent.change(box(), { target: { value: "Dora" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ assignee: "new-id" }),
    );
    expect(onAddPerson).toHaveBeenCalledWith("Dora");
    expect((box() as HTMLInputElement).value).toBe("");
  });

  it("shows why a name was refused, and chooses no one", async () => {
    const onAddPerson = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "duplicate" });
    const onChange = vi.fn();
    renderForm(true, null, { onAddPerson, onChange });
    fireEvent.change(box(), { target: { value: "Andy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Someone with that name is already in the list.",
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(box(), { target: { value: "Andy 2" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
