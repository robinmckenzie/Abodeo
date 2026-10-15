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
      "KitchenAndy",
      "KitchenUnassigned",
    ]);
    expect(savedProjects().find((p) => p.assignee === "andy").notes).toBe(
      "Tiles\nGrout",
    );
    expect(screen.queryByText("No projects added yet.")).toBeNull();
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
    expect(bars()[0].textContent).toBe("BathroomClement");
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
    pressKey("E", screen.getByRole("button", { name: "Create" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titleField()).toHaveProperty("value", "Draft");
    expect(document.activeElement).toBe(titleField());
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
