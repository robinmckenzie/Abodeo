import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Person } from "./people";
import type { PersonFailure } from "./people-messages";
import type { AddPerson } from "./project-form";
import { TaskAssigneePicker } from "./task-assignee-picker";
import { unassignedId } from "./projects";

type AddResult =
  | { ok: true; person: Person }
  | { ok: false; reason: PersonFailure };

// jsdom hides popovers, such as the list of people.
beforeAll(() => {
  const shown = document.createElement("style");
  shown.textContent = "[popover] { display: grid !important; }";
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// An answer to adding someone that the test gives when it chooses.
function deferAdd() {
  let answer!: (result: AddResult) => void;
  const promise = new Promise<AddResult>((resolve) => (answer = resolve));
  return { promise, answer };
}

// A task's picker whose people and assignee change as a task list's would.
function renderPicker(startPeople: Person[], add: AddPerson) {
  const chosen: string[] = [];
  function Harness() {
    const [people, setPeople] = useState(startPeople);
    const [assignee, setAssignee] = useState(unassignedId);
    return (
      <TaskAssigneePicker
        taskId="tiles"
        taskTitle="Tiles"
        assignee={assignee}
        people={people}
        onChoose={(id) => {
          chosen.push(id);
          setAssignee(id);
        }}
        onAddPerson={async (name) => {
          const result = await add(name);
          if (result.ok) setPeople((current) => [...current, result.person]);
          return result;
        }}
      />
    );
  }
  render(<Harness />);
  return chosen;
}

const button = () =>
  screen.getByRole("button", { name: /^Tiles is assigned to/ });
const addBox = () =>
  screen.getByRole("textbox", {
    name: "Add a person and assign Tiles to them",
  });

function startAdding(name: string) {
  fireEvent.change(addBox(), { target: { value: name } });
  fireEvent.keyDown(addBox(), { key: "Enter" });
}

const andy = { id: "andy", name: "Andy" };
const boris = { id: "boris", name: "Boris" };
const dora = { id: "dora", name: "Dora" };

describe("adding a person that is answered late (AD #128)", () => {
  it("does not undo someone chosen after Escape, nor close the reopened list or take focus", async () => {
    const pending = deferAdd();
    const chosen = renderPicker([andy, boris], () => pending.promise);
    fireEvent.click(button());
    startAdding("Dora");
    fireEvent.keyDown(addBox(), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(button());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Boris" }));
    expect(button().textContent).toBe("Boris");

    // Opened again, with focus in the box, when Dora's answer comes.
    fireEvent.click(button());
    addBox().focus();
    await act(async () => pending.answer({ ok: true, person: dora }));

    expect(button().textContent).toBe("Boris");
    expect(chosen).toEqual(["boris"]);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement).toBe(addBox());
    // Dora still joins the list of people.
    expect(screen.getByRole("menuitemradio", { name: "Dora" })).toBeTruthy();
  });

  it("does not assign them once the list is closed without choosing", async () => {
    const pending = deferAdd();
    const chosen = renderPicker([andy], () => pending.promise);
    fireEvent.click(button());
    startAdding("Dora");
    // A press outside.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();

    await act(async () => pending.answer({ ok: true, person: dora }));

    expect(button().textContent).toBe("Unassigned");
    expect(chosen).toEqual([]);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("does not undo someone chosen while the list stayed open", async () => {
    const pending = deferAdd();
    const chosen = renderPicker([andy], () => pending.promise);
    fireEvent.click(button());
    startAdding("Dora");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Andy" }));

    await act(async () => pending.answer({ ok: true, person: dora }));

    expect(button().textContent).toBe("Andy");
    expect(chosen).toEqual(["andy"]);
  });

  it("still assigns them and closes when the list stays open", async () => {
    const pending = deferAdd();
    const chosen = renderPicker([andy], () => pending.promise);
    fireEvent.click(button());
    startAdding("Dora");

    await act(async () => pending.answer({ ok: true, person: dora }));

    expect(button().textContent).toBe("Dora");
    expect(chosen).toEqual(["dora"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button());
  });
});

describe("the list's place (AD #128)", () => {
  it("stays above its button when a refusal makes it taller", async () => {
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    // A button near the bottom of a 768-pixel window, so the list opens above.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 600,
      bottom: 630,
      right: 500,
    } as DOMRect);
    let height = 200;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      () => height,
    );
    renderPicker([andy], async () => ({ ok: false, reason: "duplicate" }));
    fireEvent.click(button());
    const list = screen.getByRole("menu");
    expect(list.style.top).toBe(`${600 - 4 - 200}px`);

    addBox().focus();
    await act(async () => startAdding("andy"));
    expect(screen.getByRole("alert")).toBeTruthy();
    height = 240;
    act(() => resized());

    // Its bottom is still just above the button.
    expect(list.style.top).toBe(`${600 - 4 - 240}px`);
    expect(document.activeElement).toBe(addBox());
  });
});
