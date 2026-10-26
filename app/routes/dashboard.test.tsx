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
import { serialisePeople } from "../projects/people";
import { peopleKey } from "../projects/people-storage";
import { projectKeyPrefix } from "../projects/project-storage";
import { refreshPeople } from "../projects/use-people";
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

// Sign-in is not set up, so projects are kept in the browser, as signed out.
beforeEach(() => {
  localStorage.clear();
  refreshProjects();
  refreshPeople();
  forgetPresentation();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ configured: false })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Waits for the sign-in check, which comes before projects are shown.
async function renderDashboard(state?: unknown) {
  const Stub = createRoutesStub([{ path: "/dashboard", Component: Dashboard }]);
  const rendered = render(
    <Stub initialEntries={[{ pathname: "/dashboard", state }]} />,
  );
  await act(async () => {});
  return rendered;
}

// Saves the browser's list of people, with ids made from their names.
function savePeople(...names: string[]) {
  localStorage.setItem(
    peopleKey,
    serialisePeople(names.map((name) => ({ id: name.toLowerCase(), name }))),
  );
  refreshPeople();
}

const titleField = () => screen.getByRole("textbox", { name: "Title" });
const notesField = () => screen.getByRole("textbox", { name: "Notes" });
// The collapsed bars, not the buttons in an expanded one's form.
const bars = () =>
  within(screen.getByRole("list", { name: "Projects" }))
    .queryAllByRole("button")
    .filter((button) => button.dataset.projectId);
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

// jsdom has no scrolling element, nor any layout, so a 900-pixel window is
// faked, with any expanded bar at barTop on the page.
function fakeLayout(sizes: {
  barTop: number;
  height: number;
  pageHeight: number;
}) {
  const page = document.documentElement;
  const layout = {
    ...sizes,
    scrollTop: 0,
    restore() {
      Reflect.deleteProperty(page, "clientHeight");
      Reflect.deleteProperty(page, "scrollHeight");
      Reflect.deleteProperty(page, "scrollTop");
      Reflect.deleteProperty(document, "scrollingElement");
    },
  };
  Object.defineProperty(document, "scrollingElement", {
    configurable: true,
    value: page,
  });
  Object.defineProperties(page, {
    clientHeight: { configurable: true, value: 900 },
    scrollHeight: { configurable: true, get: () => layout.pageHeight },
    scrollTop: {
      configurable: true,
      get: () => layout.scrollTop,
      set: (value: number) => (layout.scrollTop = value),
    },
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    () => layout.height,
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top: layout.barTop - layout.scrollTop }) as DOMRect,
  );
  return layout;
}

function pressKey(key: string, target: Element = document.body) {
  fireEvent.keyDown(target, { key });
}

describe("Dashboard", () => {
  it("shows the small logo as the main heading", async () => {
    await renderDashboard();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("img")).toBe(
      screen.getByRole("img", { name: "Abodeo - Your home, sorted." }),
    );
  });

  it("hides the Development panel unless VITE_SHOW_DEVELOPMENT_PANEL is true", async () => {
    vi.stubEnv("VITE_SHOW_DEVELOPMENT_PANEL", "false");
    await renderDashboard();
    expect(
      screen.queryByRole("region", { name: "Default projects" }),
    ).toBeNull();
    cleanup();
    vi.stubEnv("VITE_SHOW_DEVELOPMENT_PANEL", "true");
    try {
      await renderDashboard();
      expect(
        screen.getByRole("region", { name: "Default projects" }),
      ).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lists its keyboard shortcuts, with Esc only while a project is open", async () => {
    await renderDashboard();
    const panel = screen.getByRole("complementary", {
      name: "Keyboard shortcuts",
    });
    const shortcuts = () =>
      within(panel)
        .queryAllByRole("listitem")
        .map((row) => row.textContent);
    expect(shortcuts()).toEqual([
      "TToggle tuning panel",
      "ESwitch window / in place",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(shortcuts()).toContain("EscClose open project");
    await closeForm();
    expect(shortcuts()).not.toContain("EscClose open project");
  });

  it("does not list the tuning shortcut in the deployed app", async () => {
    vi.stubEnv("DEV", false);
    try {
      await renderDashboard();
      const panel = screen.getByRole("complementary", {
        name: "Keyboard shortcuts",
      });
      const rows = within(panel)
        .queryAllByRole("listitem")
        .map((row) => row.textContent);
      expect(rows).toEqual(["ESwitch window / in place"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("switches presentation and closes a project from the keycaps", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "E" }));
    expect(localStorage.getItem("abodeo-project-presentation")).toBe(
      "in-place",
    );
    fireEvent.click(bars()[0]);
    expect(titleField()).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    });
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  });

  it("underlines the current presentation in E's shortcut", async () => {
    await renderDashboard();
    const current = () =>
      screen
        .getByRole("complementary", { name: "Keyboard shortcuts" })
        .querySelector(".is-current")?.textContent;
    expect(current()).toBe("window");
    pressKey("e");
    expect(current()).toBe("in place");
  });

  it("does not list T or E while typing in a field, where they do not work", async () => {
    await renderDashboard();
    const panel = screen.getByRole("complementary", {
      name: "Keyboard shortcuts",
    });
    const shortcuts = () =>
      within(panel)
        .queryAllByRole("listitem")
        .map((row) => row.textContent);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(document.activeElement).toBe(titleField());
    expect(shortcuts()).toEqual(["EscClose open project"]);
    act(() => screen.getByRole("button", { name: "Close" }).focus());
    expect(shortcuts()).toEqual([
      "TToggle tuning panel",
      "ESwitch window / in place",
      "MShow or hide a failed-save message",
      "EscClose open project",
    ]);
  });

  it("shows and hides a failed-save message on the open project with M, in development", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    act(() => screen.getByRole("button", { name: "Close" }).focus());
    const note = "Not saved: Abodeo cannot reach your projects right now.";
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.keyDown(window, { key: "m" });
    expect(screen.getByText(note)).toBeTruthy();
    fireEvent.keyDown(window, { key: "m" });
    expect(screen.queryByText(note)).toBeNull();
  });

  it("shows that there are no projects yet", async () => {
    await renderDashboard();
    expect(screen.getByText("No projects added yet.")).toBeTruthy();
  });

  it("adds projects as bars, with their notes and assignee saved", async () => {
    savePeople("Andy", "Boris", "Clement");
    await renderDashboard();
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
    await renderDashboard();
    await addProject("Kitchen", "  \n ");
    expect(bars()[0].querySelector(".project-bar-notes")).toBeNull();
  });

  it("opens the Add project form in a floating window, with Unassigned chosen", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("radio", { name: "Unassigned" }),
    ).toHaveProperty("checked", true);
    expect(document.activeElement).toBe(titleField());
  });

  it("does not create a project without a title", async () => {
    await renderDashboard();
    await addProject("   ", "Notes");
    expect(screen.getByRole("alert").textContent).toBe(
      "A project needs a title.",
    );
    expect(savedProjects()).toHaveLength(0);
  });

  it("adds nothing when the form is closed without Create", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(titleField(), { target: { value: "Unwanted" } });
    await closeForm();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedProjects()).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add project" }),
    );
  });

  it("adds nothing when Cancel is pressed, in either presentation", async () => {
    await renderDashboard();
    for (const presentation of ["window", "in place"]) {
      if (presentation === "in place") pressKey("e");
      fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      fireEvent.change(titleField(), { target: { value: "Unwanted" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });
      expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
      expect(savedProjects()).toHaveLength(0);
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add project" }),
      );
    }
  });

  it("lets only a new project's form be used while it is added in place", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const expanded = titleField().closest("li")!;
    expect(bars()[0].closest("[inert]")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Add project" }).closest("[inert]"),
    ).not.toBeNull();
    expect(expanded.closest("[inert]")).toBeNull();
    // Closed by Cancel or Esc, without the arrow an opened project has.
    expect(
      within(expanded).queryByRole("button", { name: "Close" }),
    ).toBeNull();

    await act(async () => pressKey("Escape", titleField()));
    expect(bars()[0].closest("[inert]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add project" }).closest("[inert]"),
    ).toBeNull();
  });

  it("tells the user when a new project cannot be saved", async () => {
    await renderDashboard();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await addProject("Kitchen");
    expect(screen.getByRole("alert").textContent).toMatch(/Not saved/);
    expect(titleField()).toHaveProperty("value", "Kitchen");
    expect(bars()).toHaveLength(0);
  });

  it("saves an opened project's changes without a button", async () => {
    savePeople("Andy", "Boris", "Clement");
    await renderDashboard();
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
    await renderDashboard();
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
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(titleField(), { target: { value: " " } });
    expect(screen.getByText(/its last title is kept/)).toBeTruthy();
    await closeForm();
    expect(savedProjects()[0].title).toBe("Kitchen");
  });

  it("saves a change made just before the page is left", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(notesField(), { target: { value: "Last words" } });
    fireEvent(window, new Event("pagehide"));
    expect(savedProjects()[0].notes).toBe("Last words");
  });

  it("saves a change made just before the dashboard is left within the app", async () => {
    const { unmount } = await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.change(notesField(), { target: { value: "Last words" } });
    unmount();
    expect(savedProjects()[0].notes).toBe("Last words");
  });

  it("marks a project whose last changes could not be saved", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    fireEvent.change(notesField(), { target: { value: "Lost" } });
    await act(async () => {
      fireEvent.blur(notesField());
    });
    expect(screen.getByText(/^Not saved/).getAttribute("role")).toBe("alert");
    await closeForm();
    expect(bars()[0].textContent).toMatch(/Last changes not saved/);
  });

  it("shows projects saved in another tab while the dashboard was closed", async () => {
    const { unmount } = await renderDashboard();
    unmount();
    await renderDashboard();
    await addProject("Mine");
    const mine = Object.keys(localStorage)[0];
    cleanup();
    localStorage.setItem(
      `${projectKeyPrefix}theirs`,
      localStorage.getItem(mine)!.replace("Mine", "Theirs"),
    );
    await renderDashboard();
    expect(bars().map((bar) => bar.textContent)).toEqual([
      "UnassignedMine",
      "UnassignedTheirs",
    ]);
  });

  it("says when saved projects cannot be read, and leaves them alone", async () => {
    localStorage.setItem(`${projectKeyPrefix}bad`, "{damaged");
    refreshProjects();
    await renderDashboard();
    expect(screen.getByRole("alert").textContent).toMatch(
      /1 saved project cannot be read/,
    );
    expect(screen.queryByText("No projects added yet.")).toBeNull();
    expect(localStorage.getItem(`${projectKeyPrefix}bad`)).toBe("{damaged");
  });

  it("switches between the floating window and in place with E, and remembers it", async () => {
    await renderDashboard();
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
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titleField().closest("li")).toBeTruthy();
  });

  it("keeps an unfinished new project open when E switches", async () => {
    await renderDashboard();
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
    await renderDashboard();
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
    await renderDashboard();
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

  it("closes a project in place with Esc when focus is outside the form", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    fireEvent.click(bars()[0]);
    (document.activeElement as HTMLElement).blur();
    await act(async () => pressKey("Escape"));
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
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
    screen
      .getAllByRole("textbox", { name: "Title" })
      .map((field) => [
        (field as HTMLInputElement).value,
        field.closest("li")!.hasAttribute("inert"),
      ]);

  it("keeps a project opened while another is squashing open", async () => {
    const finishAnimations = holdAnimations();
    try {
      await renderDashboard();
      await addProject("First");
      await addProject("Second");
      pressKey("e");
      fireEvent.click(bars()[0]);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      // Opens the second project while the first is still squashing.
      fireEvent.click(
        screen.getByRole("button", { name: "Second, Unassigned" }),
      );
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
      await renderDashboard();
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
      await renderDashboard();
      await addProject("First");
      await addProject("Second");
      pressKey("e");
      fireEvent.click(bars()[0]);
      fireEvent.change(notesField(), { target: { value: "Typed" } });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Second, Unassigned" }),
        );
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

  // In a 900-pixel window, a bar expanding in place to its height at barTop
  // on a page of pageHeight. A 16-pixel margin is kept from the window's
  // edges.
  it.each([
    ["an opened project to show its foot", false, 800, 600, 2000, 516],
    ["an opened project only when it does not fit", false, 100, 600, 2000, 0],
    ["a tall opened project only to its top", false, 800, 1200, 2500, 784],
    ["a new project to the page's end", true, 800, 600, 1500, 600],
    ["a long page's new project only to its top", true, 1000, 600, 3000, 984],
  ])("scrolls %s", async (_, isNew, barTop, height, pageHeight, scrolled) => {
    await renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    const layout = fakeLayout({ barTop, height, pageHeight });
    try {
      fireEvent.click(
        isNew ? screen.getByRole("button", { name: "Add project" }) : bars()[0],
      );
      expect(layout.scrollTop).toBe(scrolled);
    } finally {
      layout.restore();
    }
  });

  it("scrolls back up to an opened project that moves up as another closes", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    pressKey("e");
    // Scrolled to 700, with the bar opening at 1000 and then moving up to
    // 450 as an open project above it closes.
    const layout = fakeLayout({ barTop: 1000, height: 600, pageHeight: 3000 });
    layout.scrollTop = 700;
    try {
      fireEvent.click(bars()[0]);
      expect(layout.scrollTop).toBe(716);
      layout.barTop = 450;
      await act(() => new Promise(requestAnimationFrame));
      expect(layout.scrollTop).toBe(434);
    } finally {
      layout.restore();
    }
  });

  describe("while a bar expands", () => {
    // Animation frames come every 16 milliseconds, on demand.
    function startExpanding(sizes: Parameters<typeof fakeLayout>[0]) {
      holdAnimations();
      vi.useFakeTimers({
        toFake: [
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "performance",
        ],
      });
      return fakeLayout(sizes);
    }

    afterEach(() => {
      vi.useRealTimers();
      delete (Element.prototype as Partial<Element>).animate;
    });

    it("keeps an opened project's top in sight as it moves up", async () => {
      await renderDashboard();
      await addProject("Kitchen");
      pressKey("e");
      const layout = startExpanding({
        barTop: 1000,
        height: 600,
        pageHeight: 3000,
      });
      layout.scrollTop = 900;
      try {
        fireEvent.click(bars()[0]);
        // A project above squashes closed, moving the bar up.
        layout.barTop = 450;
        vi.advanceTimersByTime(16);
        expect(layout.scrollTop).toBe(434);
        vi.advanceTimersByTime(600);
        expect(layout.scrollTop).toBe(434);
      } finally {
        layout.restore();
      }
    });

    it("stops following when the page is scrolled by hand", async () => {
      await renderDashboard();
      await addProject("Kitchen");
      pressKey("e");
      const layout = startExpanding({
        barTop: 800,
        height: 600,
        pageHeight: 2000,
      });
      try {
        fireEvent.click(bars()[0]);
        vi.advanceTimersByTime(100);
        expect(layout.scrollTop).toBeGreaterThan(0);
        fireEvent.wheel(window);
        layout.scrollTop = 50;
        vi.advanceTimersByTime(600);
        expect(layout.scrollTop).toBe(50);
      } finally {
        layout.restore();
      }
    });

    it("stops following when a key scrolls the page", async () => {
      await renderDashboard();
      await addProject("Kitchen");
      pressKey("e");
      const layout = startExpanding({
        barTop: 800,
        height: 600,
        pageHeight: 2000,
      });
      try {
        fireEvent.click(bars()[0]);
        vi.advanceTimersByTime(100);
        pressKey("PageDown");
        layout.scrollTop = 700;
        vi.advanceTimersByTime(600);
        expect(layout.scrollTop).toBe(700);
      } finally {
        layout.restore();
      }
    });

    it("arrives at the foot as the bar finishes expanding", async () => {
      await renderDashboard();
      await addProject("Kitchen");
      pressKey("e");
      const layout = startExpanding({
        barTop: 800,
        height: 600,
        pageHeight: 2000,
      });
      try {
        fireEvent.click(bars()[0]);
        vi.advanceTimersByTime(600);
        expect(layout.scrollTop).toBe(516);
      } finally {
        layout.restore();
      }
    });
  });

  it("keeps the X and autosave note in the floating window", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(dialog).getByText(/Changes saved/)).toBeTruthy();
  });

  it("types E into a field without switching", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    pressKey("e", titleField());
    pressKey("E", notesField());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(localStorage.getItem("abodeo-project-presentation")).toBeNull();
  });

  it("opens the Add project form when arriving from Get Started", async () => {
    await renderDashboard({ openAddProject: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(titleField());
  });
});

describe("Dashboard due dates", () => {
  // Today is Saturday 10 October 2026, so the calendar opens at October.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 10, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const day = (name: string) => screen.getByRole("button", { name });
  const icon = () => bars()[0].querySelector(".due-date-icon");

  async function reopenApp() {
    cleanup();
    refreshProjects();
    await renderDashboard();
  }

  it.each([
    ["the floating window", false],
    ["in place", true],
  ])(
    "adds, changes and clears a due date in %s, keeping it after reopening",
    async (_, isInPlace) => {
      await renderDashboard();
      if (isInPlace) pressKey("e");
      fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      fireEvent.change(titleField(), { target: { value: "Kitchen" } });
      fireEvent.click(day("Friday 16 October 2026"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create" }));
      });

      // The weekday above the number, then the month's strip in its colour.
      expect(icon()?.textContent).toBe("Friday16October");
      expect(
        (icon() as HTMLElement).style.getPropertyValue("--month-colour"),
      ).toBe("#c8245c");
      expect(icon()?.getAttribute("aria-hidden")).toBe("true");
      expect(
        bars()[0].querySelector(".project-bar-assignee + .due-date-icon"),
      ).toBe(icon());
      expect(bars()[0].getAttribute("aria-label")).toBe(
        "Kitchen, Unassigned, due Friday 16 October 2026",
      );
      expect(savedProjects()[0].dueDate).toBe("2026-10-16");

      // Changing it saves straight away and updates the icon.
      fireEvent.click(bars()[0]);
      fireEvent.click(screen.getByRole("button", { name: "Next month" }));
      await act(async () => {
        fireEvent.click(day("Monday 2 November 2026"));
      });
      expect(savedProjects()[0].dueDate).toBe("2026-11-02");
      await closeForm();
      expect(icon()?.textContent).toBe("Monday2November");

      await reopenApp();
      expect(icon()?.textContent).toBe("Monday2November");

      // Clearing it removes the icon.
      fireEvent.click(bars()[0]);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      });
      expect(savedProjects()[0].dueDate).toBeNull();
      await closeForm();
      expect(icon()).toBeNull();
      await reopenApp();
      expect(icon()).toBeNull();
      expect(bars()[0].getAttribute("aria-label")).toBe("Kitchen, Unassigned");
    },
  );

  it("keeps the calendar's month and day when E switches presentation", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    const nextMonth = screen.getByRole("button", { name: "Next month" });
    nextMonth.focus();
    fireEvent.click(nextMonth);
    fireEvent.click(nextMonth);
    pressKey("e");
    expect(screen.getByRole("group", { name: "December 2026" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Next month" }),
    );
    day("Thursday 10 December 2026").focus();
    pressKey("ArrowDown", document.activeElement!);
    pressKey("e");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(day("Thursday 17 December 2026"));
    expect(savedProjects()[0].dueDate).toBeNull();
  });

  it("keeps the calendar's day when E follows clearing the due date", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await act(async () => {
      fireEvent.click(day("Monday 2 November 2026"));
    });
    await closeForm();
    // Cleared at once, without moving in the calendar, then switched.
    fireEvent.click(bars()[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });
    expect(document.activeElement).toBe(day("Monday 2 November 2026"));
    pressKey("e");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("group", { name: "November 2026" })).toBeTruthy();
    expect(document.activeElement).toBe(day("Monday 2 November 2026"));
    expect(savedProjects()[0].dueDate).toBeNull();
  });

  it("creates a project without a due date, showing no icon", async () => {
    await renderDashboard();
    await addProject("Kitchen");
    expect(savedProjects()[0].dueDate).toBeNull();
    expect(icon()).toBeNull();
  });

  it("loads a project saved before due dates with none, keeping the rest", async () => {
    const older = {
      version: 1,
      title: "Kitchen",
      notes: "Tiles",
      assignee: "andy",
      createdAt: "2026-10-15T10:00:00.000Z",
      updatedAt: "2026-10-15T10:00:00.000Z",
    };
    localStorage.setItem(`${projectKeyPrefix}old`, JSON.stringify(older));
    refreshProjects();
    await renderDashboard();
    expect(bars().map((bar) => bar.textContent)).toEqual(["AndyKitchenTiles"]);
    expect(icon()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("tasks", () => {
  const entryBox = () =>
    screen.getByRole("textbox", { name: "Add tasks, one per line" });
  const taskTitles = () =>
    screen
      .queryAllByRole("button", { name: /^Edit / })
      .map((button) => button.textContent);
  const savedTasks = (): { title: string; isDone: boolean }[] =>
    savedProjects()[0].tasks;

  async function openKitchen() {
    await renderDashboard();
    await addProject("Kitchen");
    fireEvent.click(bars()[0]);
  }

  async function enterTasks(text: string) {
    fireEvent.change(entryBox(), { target: { value: text } });
    await act(async () => {
      fireEvent.keyDown(entryBox(), { key: "Enter" });
    });
  }

  async function click(name: string) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });
  }

  const newTasksBox = () =>
    screen.getByRole("textbox", { name: "Add tasks, one per line" });

  it("typed in the Add project form become the new project's tasks", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(titleField(), { target: { value: "Shed" } });
    fireEvent.change(newTasksBox(), {
      target: { value: "Paint\n\nOil hinges\nFit lock" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });
    expect(
      savedProjects()[0].tasks.map((t: { title: string }) => t.title),
    ).toEqual(["Paint", "Oil hinges", "Fit lock"]);
  });

  it("create a project with no tasks when the Add project form's box is empty", async () => {
    await renderDashboard();
    await addProject("Shed");
    expect(savedProjects()[0].tasks).toEqual([]);
  });

  it("typed in the Add project form are discarded by Cancel", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(newTasksBox(), { target: { value: "Paint" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(savedProjects()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(newTasksBox()).toHaveProperty("value", "");
  });

  it("adds a task per line with Enter, after the notes, and keeps them", async () => {
    await openKitchen();
    expect(
      notesField().compareDocumentPosition(entryBox()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    entryBox().focus();
    // Shift+Enter leaves the line break to the box.
    fireEvent.change(entryBox(), { target: { value: "- Tiles" } });
    fireEvent.keyDown(entryBox(), { key: "Enter", shiftKey: true });
    expect(taskTitles()).toEqual([]);
    await enterTasks("- Tiles\n\n2. [x] **Grout**\n- [ ]\n  Seal  ");

    expect(taskTitles()).toEqual(["Tiles", "**Grout**", "Seal"]);
    expect(
      screen.getByRole("checkbox", { name: "Mark **Grout** as done" }),
    ).toHaveProperty("checked", true);
    expect(entryBox()).toHaveProperty("value", "");
    expect(document.activeElement).toBe(entryBox());
    expect(savedTasks().map(({ title, isDone }) => [title, isDone])).toEqual([
      ["Tiles", false],
      ["**Grout**", true],
      ["Seal", false],
    ]);
    // Counted on the dashboard's bar.
    await closeForm();
    expect(bars()[0].textContent).toBe("UnassignedKitchen3 tasks, 1 completed");
    expect(bars()[0].getAttribute("aria-label")).toBe(
      "Kitchen, Unassigned, 3 tasks, 1 completed",
    );
    cleanup();
    refreshProjects();
    await renderDashboard();
    fireEvent.click(bars()[0]);
    expect(taskTitles()).toEqual(["Tiles", "**Grout**", "Seal"]);
  });

  it("marks a task done without moving it", async () => {
    await openKitchen();
    await enterTasks("Tiles\nGrout");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Mark Tiles as done" }),
      );
    });
    expect(taskTitles()).toEqual(["Tiles", "Grout"]);
    expect(savedTasks()[0].isDone).toBe(true);
  });

  it("keeps the text and says so when adding cannot be saved", async () => {
    await openKitchen();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await enterTasks("Tiles");
    expect(taskTitles()).toEqual([]);
    expect(entryBox()).toHaveProperty("value", "Tiles");
    expect(screen.getByText(/^Not saved/).id).toBe(
      entryBox().getAttribute("aria-describedby"),
    );
  });

  it("puts a change back when it cannot be saved", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await click("Delete Tiles");
    expect(taskTitles()).toEqual(["Tiles"]);
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
    expect(screen.getByText(/^Not saved/)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete Tiles" }),
    );
  });

  it("keeps unsubmitted text when the project is closed and reopened", async () => {
    await openKitchen();
    fireEvent.change(entryBox(), { target: { value: "Half typed" } });
    await closeForm();
    fireEvent.click(bars()[0]);
    expect(entryBox()).toHaveProperty("value", "Half typed");
    expect(savedTasks()).toEqual([]);
  });

  it("edits a title with Enter, trimmed, and cancels with Escape without closing", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    fireEvent.click(screen.getByRole("button", { name: "Edit Tiles" }));
    const field = screen.getByRole("textbox", { name: "Title of task Tiles" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "  Wall tiles " } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(taskTitles()).toEqual(["Wall tiles"]);
    expect(savedTasks()[0].title).toBe("Wall tiles");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit Wall tiles" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Wall tiles" }));
    fireEvent.change(document.activeElement!, { target: { value: "Oops" } });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(taskTitles()).toEqual(["Wall tiles"]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit Wall tiles" }),
    );
  });

  it("moves focus between titles with Up and Down, stopping at the ends", async () => {
    await openKitchen();
    await enterTasks("Tiles\nGrout\nSeal");
    const title = (name: string) =>
      screen.getByRole("button", { name: `Edit ${name}` });
    title("Tiles").focus();
    fireEvent.keyDown(title("Tiles"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(title("Tiles"));
    fireEvent.keyDown(title("Tiles"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(title("Grout"));
    fireEvent.keyDown(title("Grout"), { key: "ArrowDown" });
    fireEvent.keyDown(title("Seal"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(title("Seal"));
    fireEvent.keyDown(title("Seal"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(title("Grout"));
  });

  it("saves an edit on leaving it, unless it is empty", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    fireEvent.click(screen.getByRole("button", { name: "Edit Tiles" }));
    fireEvent.change(document.activeElement!, { target: { value: "   " } });
    fireEvent.blur(document.activeElement!);
    expect(taskTitles()).toEqual(["Tiles"]);

    fireEvent.click(screen.getByRole("button", { name: "Edit Tiles" }));
    fireEvent.change(document.activeElement!, { target: { value: "Grout" } });
    await act(async () => {
      fireEvent.blur(document.activeElement!);
    });
    expect(savedTasks()[0].title).toBe("Grout");
  });

  it("saves an edit when the project is closed", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    fireEvent.click(screen.getByRole("button", { name: "Edit Tiles" }));
    fireEvent.change(document.activeElement!, { target: { value: "Grout" } });
    await act(async () => {
      pressKey("Escape", screen.getByRole("heading", { name: "Tasks" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedTasks()[0].title).toBe("Grout");
  });

  it("cancels an edit with Escape in place without closing the project", async () => {
    pressKey("e");
    await openKitchen();
    await enterTasks("Tiles");
    fireEvent.click(screen.getByRole("button", { name: "Edit Tiles" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Tiles" })).toBeTruthy();
  });

  it("deletes a task, with Undo putting it back where it was", async () => {
    await openKitchen();
    await enterTasks("Tiles\nGrout\nSeal");
    await click("Delete Grout");
    expect(taskTitles()).toEqual(["Tiles", "Seal"]);
    expect(savedTasks()).toHaveLength(2);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Undo deleting Grout" }),
    );
    await click("Undo deleting Grout");
    expect(taskTitles()).toEqual(["Tiles", "Grout", "Seal"]);
    expect(savedTasks()).toHaveLength(3);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit Grout" }),
    );
  });

  it("offers Undo again when putting the task back cannot be saved", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    await click("Delete Tiles");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await click("Undo deleting Tiles");
    expect(taskTitles()).toEqual([]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Undo deleting Tiles" }),
    );
    vi.restoreAllMocks();
    await click("Undo deleting Tiles");
    expect(taskTitles()).toEqual(["Tiles"]);
  });

  it("offers Undo for 8 seconds, then moves focus to the entry box", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    vi.useFakeTimers();
    try {
      await click("Delete Tiles");
      act(() => vi.advanceTimersByTime(7900));
      expect(screen.getByRole("button", { name: "Undo deleting Tiles" }));
      act(() => vi.advanceTimersByTime(200));
      expect(
        screen.queryByRole("button", { name: "Undo deleting Tiles" }),
      ).toBeNull();
      expect(document.activeElement).toBe(entryBox());
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends Undo when the project closes", async () => {
    await openKitchen();
    await enterTasks("Tiles");
    await click("Delete Tiles");
    await closeForm();
    fireEvent.click(bars()[0]);
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("moves tasks up and down, keeping focus on the button", async () => {
    await openKitchen();
    await enterTasks("Tiles\nGrout\nSeal");
    await click("Move Tiles down");
    expect(taskTitles()).toEqual(["Grout", "Tiles", "Seal"]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move Tiles down" }),
    );
    await click("Move Seal up");
    expect(taskTitles()).toEqual(["Grout", "Seal", "Tiles"]);
    // Already at the top.
    await click("Move Grout up");
    expect(savedTasks().map(({ title }) => title)).toEqual([
      "Grout",
      "Seal",
      "Tiles",
    ]);
  });
});

describe("Dashboard people (AD #61)", () => {
  const assigneeLabels = () =>
    [
      ...screen
        .getByRole("group", { name: "Assigned to" })
        .querySelectorAll("label"),
    ].map((label) => label.textContent);

  it("offers only Unassigned, and a box to add someone, in a new browser", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(assigneeLabels()).toEqual(["Unassigned", "Add a person"]);
  });

  it("offers the people in the list", async () => {
    savePeople("Dora", "Eli");
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(assigneeLabels()).toEqual([
      "Unassigned",
      "Dora",
      "Eli",
      "Add a person",
    ]);
  });

  it("starts a browser's list with those its projects are assigned to", async () => {
    localStorage.setItem(
      `${projectKeyPrefix}old`,
      JSON.stringify({
        version: 3,
        title: "Old shed",
        notes: "",
        assignee: "boris",
        dueDate: null,
        tasks: [],
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    refreshProjects();
    await renderDashboard();
    expect(bars().map((bar) => bar.textContent)).toEqual(["BorisOld shed"]);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(assigneeLabels()).toEqual(["Unassigned", "Boris", "Add a person"]);
  });

  it("adds a person from a new project's form and creates the project assigned to them", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(titleField(), { target: { value: "Shed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Add a person" }), {
      target: { value: "Dora" },
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Add a person" }), {
        key: "Enter",
      });
    });
    // Enter adds the person, and does not create the project.
    expect(savedProjects()).toHaveLength(0);
    expect(
      (screen.getByRole("radio", { name: "Dora" }) as HTMLInputElement).checked,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });
    expect(bars().map((bar) => bar.textContent)).toEqual(["DoraShed"]);
    expect(savedProjects()[0].assignee).toBe(
      JSON.parse(localStorage.getItem(peopleKey)!).people[0].id,
    );
  });

  it("adds a person from an open project's form, saving the assignment", async () => {
    await renderDashboard();
    await addProject("Shed");
    fireEvent.click(bars()[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Add a person" }), {
      target: { value: "Dora" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    await closeForm();
    expect(bars().map((bar) => bar.textContent)).toEqual(["DoraShed"]);
  });

  it("shows why a name is refused, and adds no one", async () => {
    savePeople("Dora");
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add a person" }), {
      target: { value: "dora" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    expect(
      screen.getByText("Someone with that name is already in the list."),
    ).toBeTruthy();
    expect(assigneeLabels()).toEqual(["Unassigned", "Dora", "Add a person"]);
  });

  it("shows a renamed person's new name on the project", async () => {
    savePeople("Dora");
    await renderDashboard();
    await addProject("Shed", "", "Dora");
    expect(bars().map((bar) => bar.textContent)).toEqual(["DoraShed"]);
    savePeople("Dorothy");
    // The same person, as the id is kept: only the name changes.
    localStorage.setItem(
      peopleKey,
      serialisePeople([{ id: "dora", name: "Dorothy" }]),
    );
    refreshPeople();
    await act(async () => {});
    expect(bars().map((bar) => bar.textContent)).toEqual(["DorothyShed"]);
  });

  it("goes to the People screen from the application menu, saving the open project first", async () => {
    const Stub = createRoutesStub([
      { path: "/dashboard", Component: Dashboard },
      { path: "/people", Component: () => <p>People screen</p> },
    ]);
    render(<Stub initialEntries={["/dashboard"]} />);
    await act(async () => {});
    await addProject("Shed");
    fireEvent.click(bars()[0]);
    fireEvent.change(titleField(), { target: { value: "Shed, painted" } });
    // Earlier tests can leave typed tasks behind, which the check before
    // leaving asks about.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "People" }));
    });
    await act(async () => {});
    expect(screen.getByText("People screen")).toBeTruthy();
    expect(savedProjects()[0].title).toBe("Shed, painted");
  });

  it("always shows the application menu links, with Projects as the current screen", async () => {
    await renderDashboard();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Projects" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("link", { name: "People" })).toBeTruthy();
  });
});

describe("Dashboard deleting (AD #62)", () => {
  async function openDeleteWindow(title: string) {
    await addProject(title);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(title) }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    return screen.getByRole("dialog", { name: `Delete “${title}”?` });
  }

  it("asks first, saying there is no Bin when signed out, and leaves the project if cancelled", async () => {
    await renderDashboard();
    const dialog = await openDeleteWindow("Kitchen");
    expect(within(dialog).getByText(/there is no Bin/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(
      screen.queryByRole("dialog", { name: /Delete “Kitchen”/ }),
    ).toBeNull();
    expect(savedProjects()).toHaveLength(1);
  });

  it("removes the project for good on confirming, and closes it", async () => {
    await renderDashboard();
    const dialog = await openDeleteWindow("Kitchen");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    expect(savedProjects()).toEqual([]);
    expect(bars()).toEqual([]);
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(screen.getByText("No projects added yet.")).toBeTruthy();
  });

  it("has no link to the Bin while signed out", async () => {
    await renderDashboard();
    expect(screen.queryByRole("link", { name: "Bin" })).toBeNull();
  });
});
