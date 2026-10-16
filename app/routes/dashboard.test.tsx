import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import Dashboard from "./dashboard";
import { forgetPresentation } from "../projects/presentation";
import { projectKeyPrefix } from "../projects/project-storage";
import { refreshProjects } from "../projects/use-projects";

// jsdom has no modal dialogs, so the floating window's are stood in for.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  localStorage.clear();
  refreshProjects();
  forgetPresentation();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDashboard(state?: unknown) {
  const Stub = createRoutesStub([{ path: "/dashboard", Component: Dashboard }]);
  return render(<Stub initialEntries={[{ pathname: "/dashboard", state }]} />);
}

const titleField = () => screen.getByRole("textbox", { name: "Title" });
const notesField = () => screen.getByRole("textbox", { name: "Notes" });
const bars = () =>
  within(screen.getByRole("list", { name: "Projects" })).queryAllByRole(
    "button",
  );
const savedProjects = () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith(projectKeyPrefix))
    .map((key) => JSON.parse(localStorage.getItem(key)!));

async function addProject(title: string, notes = "", assignee = "Unassigned") {
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  fireEvent.change(titleField(), { target: { value: title } });
  fireEvent.change(notesField(), { target: { value: notes } });
  fireEvent.click(screen.getByRole("radio", { name: assignee }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  });
}

async function closeForm() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });
}

function pressKey(key: string, target: Element = document.body) {
  fireEvent.keyDown(target, { key });
}

describe("Dashboard", () => {
  it("shows the small logo as the main heading", () => {
    renderDashboard();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("img")).toBe(
      screen.getByRole("img", { name: "Abodeo - Your home, sorted." }),
    );
  });

  it("shows that there are no projects yet", () => {
    renderDashboard();
    expect(screen.getByText("No projects added yet.")).toBeTruthy();
  });

  it("adds projects as bars, with their notes and assignee saved", async () => {
    renderDashboard();
    await addProject("Kitchen", "Tiles\nGrout", "Andy");
    await addProject("Kitchen");
    expect(bars().map((bar) => bar.textContent)).toEqual([
      "AndyKitchenTiles\nGrout",
      "UnassignedKitchen",
    ]);
    // The notes show under the title, with their line breaks, and a project
    // without notes has none.
    const [first, second] = bars();
    expect(
      first.querySelector(".project-bar-title + .project-bar-notes")
        ?.textContent,
    ).toBe("Tiles\nGrout");
    expect(second.querySelector(".project-bar-notes")).toBeNull();
    // Screen readers name the bar by its title and assignee, not the notes.
    expect(screen.getByRole("button", { name: "Kitchen, Andy" })).toBe(first);
    expect(savedProjects().find((p) => p.assignee === "andy").notes).toBe(
      "Tiles\nGrout",
    );
    expect(screen.queryByText("No projects added yet.")).toBeNull();
  });

  it("shows no notes preview for notes of only spaces", async () => {
    renderDashboard();
    await addProject("Kitchen", "  \n ");
    expect(bars()[0].querySelector(".project-bar-notes")).toBeNull();
  });

  it("opens the Add project form in a floating window, with Unassigned chosen", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("radio", { name: "Unassigned" }),
    ).toHaveProperty("checked", true);
    expect(document.activeElement).toBe(titleField());
  });

  it("does not create a project without a title", async () => {
    renderDashboard();
    await addProject("   ", "Notes");
    expect(screen.getByRole("alert").textContent).toBe(
      "A project needs a title.",
    );
    expect(savedProjects()).toHaveLength(0);
  });

  it("adds nothing when the form is closed without Create", async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(titleField(), { target: { value: "Unwanted" } });
    await closeForm();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedProjects()).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add project" }),
    );
  });

  it("tells the user when a new project cannot be saved", async () => {
    renderDashboard();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await addProject("Kitchen");
    expect(screen.getByRole("alert").textContent).toMatch(/Not saved/);
    expect(titleField()).toHaveProperty("value", "Kitchen");
    expect(bars()).toHaveLength(0);
  });

  it("saves an opened project's changes without a button", async () => {
    renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(titleField(), { target: { value: "Bathroom" } });
    fireEvent.click(screen.getByRole("radio", { name: "Clement" }));
    fireEvent.change(notesField(), { target: { value: "One\nTwo" } });
    await closeForm();
    expect(savedProjects()[0]).toMatchObject({
      title: "Bathroom",
      notes: "One\nTwo",
      assignee: "clement",
    });
    expect(bars()[0].textContent).toBe("ClementBathroomOne\nTwo");
  });

  it("opens a project with focus just before the title, not in it", async () => {
    renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    const start = document.activeElement as HTMLElement;
    expect(start).not.toBe(titleField());
    expect(start.getAttribute("role")).toBe("group");
    expect(start.getAttribute("tabindex")).toBe("-1");
    // Tab goes from it to the first control inside it, the title.
    expect(start.querySelector("input, textarea, button")).toBe(titleField());
  });

  it("keeps the last valid title when the title is cleared", async () => {
    renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(titleField(), { target: { value: " " } });
    expect(screen.getByText(/its last title is kept/)).toBeTruthy();
    await closeForm();
    expect(savedProjects()[0].title).toBe("Kitchen");
  });

  it("saves a change made just before the page is left", async () => {
    renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(notesField(), { target: { value: "Last words" } });
    fireEvent(window, new Event("pagehide"));
    expect(savedProjects()[0].notes).toBe("Last words");
  });

  it("saves a change made just before the dashboard is left within the app", async () => {
    const { unmount } = renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(notesField(), { target: { value: "Last words" } });
    unmount();
    expect(savedProjects()[0].notes).toBe("Last words");
  });

  it("marks a project whose last changes could not be saved", async () => {
    renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    fireEvent.change(notesField(), { target: { value: "Lost" } });
    await act(async () => {
      fireEvent.blur(notesField());
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Not saved/);
    await closeForm();
    expect(bars()[0].textContent).toMatch(/Last changes not saved/);
  });

  it("shows projects saved in another tab while the dashboard was closed", async () => {
    const { unmount } = renderDashboard();
    unmount();
    renderDashboard();
    await addProject("Mine");
    const mine = Object.keys(localStorage)[0];
    cleanup();
    localStorage.setItem(
      `${projectKeyPrefix}theirs`,
      localStorage.getItem(mine)!.replace("Mine", "Theirs"),
    );
    renderDashboard();
    expect(bars().map((bar) => bar.textContent)).toEqual([
      "UnassignedMine",
      "UnassignedTheirs",
    ]);
  });

  it("says when saved projects cannot be read, and leaves them alone", () => {
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    refreshProjects();
    renderDashboard();
    expect(screen.getByRole("alert").textContent).toMatch(
      /1 saved project cannot be read/,
    );
    expect(screen.queryByText("No projects added yet.")).toBeNull();
    expect(localStorage.getItem(`${projectKeyPrefix}bad`)).toBe("{damaged");
  });

  it("switches between the floating window and in place with E, and remembers it", async () => {
    renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    expect(localStorage.getItem("abodeo-project-presentation")).toBe(
      "in-place",
    );
    fireEvent.click(bars()[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titleField().closest("li")).toBeTruthy();

    cleanup();
    forgetPresentation();
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titleField().closest("li")).toBeTruthy();
  });

  it("keeps an unfinished new project open when E switches", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(titleField(), { target: { value: "Draft" } });
    const isTyped = fireEvent.keyDown(
      screen.getByRole("button", { name: "Create" }),
      { key: "E" },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titleField()).toHaveProperty("value", "Draft");
    expect(document.activeElement).toBe(titleField());
    // The E that switched is not typed into the newly focused title.
    expect(isTyped).toBe(false);
  });

  it("closes a project in place with the arrow below it, without the X or autosave note", async () => {
    renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    fireEvent.click(bars()[0]);
    const expanded = titleField().closest("li")!;
    expect(screen.queryByText(/Changes saved/)).toBeNull();
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    expect(closeButtons).toHaveLength(1);
    expect(closeButtons[0].parentElement).toBe(expanded);
    expect(expanded.lastElementChild).toBe(closeButtons[0]);

    fireEvent.change(notesField(), { target: { value: "Squashed" } });
    await act(async () => {
      fireEvent.click(closeButtons[0]);
    });
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(savedProjects()[0].notes).toBe("Squashed");
  });

  it("closes a project in place with Esc, from a field or from the arrow", async () => {
    renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    fireEvent.click(bars()[0]);
    await act(async () => pressKey("Escape", notesField()));
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();

    fireEvent.click(bars()[0]);
    const arrow = screen.getByRole("button", { name: "Close" });
    await act(async () => pressKey("Escape", arrow));
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(document.activeElement).toBe(bars()[0]);
  });

  // Animations that finish only when told to.
  function holdAnimations() {
    const finishes: (() => void)[] = [];
    Element.prototype.animate = vi.fn(
      () =>
        ({
          finished: new Promise<void>((resolve) => finishes.push(resolve)),
          cancel: () => {},
        }) as unknown as Animation,
    );
    return () => act(async () => finishes.forEach((finish) => finish()));
  }

  // The titles shown, with whether each is in a bar squashing closed.
  const shownTitles = () =>
    screen.getAllByRole("textbox", { name: "Title" }).map((field) => [
      (field as HTMLInputElement).value,
      field.closest("li")!.hasAttribute("inert"),
    ]);

  it("keeps a project opened while another is squashing open", async () => {
    const finishAnimations = holdAnimations();
    try {
      renderDashboard();
      await addProject("First");
      await addProject("Second");
      pressKey("e");
      fireEvent.click(bars()[0]);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      // Opens the second project while the first is still squashing.
      fireEvent.click(bars()[1]);
      expect(shownTitles()).toEqual([
        ["First", true],
        ["Second", false],
      ]);
      await finishAnimations();
      expect(shownTitles()).toEqual([["Second", false]]);
    } finally {
      delete (Element.prototype as Partial<Element>).animate;
    }
  });

  it("keeps a new project's form as it was while it squashes for another", async () => {
    const finishAnimations = holdAnimations();
    try {
      renderDashboard();
      pressKey("e");
      fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      fireEvent.change(titleField(), { target: { value: "Draft" } });
      const draftField = titleField();
      fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      expect(shownTitles()).toEqual([
        ["Draft", true],
        ["", false],
      ]);
      expect(screen.getAllByRole("textbox", { name: "Title" })[0]).toBe(
        draftField,
      );
      await finishAnimations();
      expect(shownTitles()).toEqual([["", false]]);
    } finally {
      delete (Element.prototype as Partial<Element>).animate;
    }
  });

  it("squashes an open project closed, as it was, while the next one opens", async () => {
    const finishAnimations = holdAnimations();
    try {
      renderDashboard();
      await addProject("First");
      await addProject("Second");
      pressKey("e");
      fireEvent.click(bars()[0]);
      fireEvent.change(notesField(), { target: { value: "Typed" } });
      await act(async () => {
        fireEvent.click(bars()[1]);
      });
      expect(shownTitles()).toEqual([
        ["First", true],
        ["Second", false],
      ]);
      expect(savedProjects().find((p) => p.title === "First").notes).toBe(
        "Typed",
      );
      await finishAnimations();
      expect(shownTitles()).toEqual([["Second", false]]);
      expect(bars()[0]).toHaveProperty("dataset.projectId");
    } finally {
      delete (Element.prototype as Partial<Element>).animate;
    }
  });

  it("keeps the X and autosave note in the floating window", async () => {
    renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(dialog).getByText(/Changes saved/)).toBeTruthy();
  });

  it("types E into a field without switching", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    pressKey("e", titleField());
    pressKey("E", notesField());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(localStorage.getItem("abodeo-project-presentation")).toBeNull();
  });

  it("opens the Add project form when arriving from Get Started", () => {
    renderDashboard({ openAddProject: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(titleField());
  });
});
