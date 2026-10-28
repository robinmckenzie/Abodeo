import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import People, { describeRemoval } from "./people";
import { serialisePeople } from "../projects/people";
import { peopleKey, readStoredPeople } from "../projects/people-storage";
import { createProject, loadProjects } from "../projects/project-storage";
import { newProjectFields } from "../projects/projects";
import { refreshPeople } from "../projects/use-people";
import { refreshProjects } from "../projects/use-projects";
import { accountStatusPath, accountProfilePath, authBasePath } from "../account/account-api";
import { withAppLayout } from "../test-routes";

// Sign-in is not set up, so people are kept in the browser, as signed out.
beforeEach(() => {
  localStorage.clear();
  refreshProjects();
  refreshPeople();
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

function savePeople(...names: string[]) {
  localStorage.setItem(
    peopleKey,
    serialisePeople(names.map((name) => ({ id: name.toLowerCase(), name }))),
  );
  refreshPeople();
}

// A project that an earlier version assigned to someone.
async function saveAssignedProject(title: string, assignee: string) {
  const created = await createProject({ ...newProjectFields, title });
  if (!created.ok) throw new Error("not created");
  const key = `abodeo-project:${created.project.id}`;
  localStorage.setItem(
    key,
    localStorage.getItem(key)!.replace('"unassigned"', `"${assignee}"`),
  );
  refreshProjects();
}

async function renderPeople() {
  const Stub = createRoutesStub(
    withAppLayout([
      { path: "/people", Component: People },
      { path: "/dashboard", Component: () => <p>Dashboard</p> },
    ]),
  );
  const rendered = render(<Stub initialEntries={["/people"]} />);
  await act(async () => {});
  return rendered;
}

const names = () =>
  within(screen.getByRole("list", { name: "People" }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".people-name")?.textContent);
const floatingMessage = () =>
  document.querySelector(".floating-message")?.textContent;
const addBox = () =>
  screen.getByRole("textbox", {
    name: "Name or job title",
  });

async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

async function add(name: string) {
  fireEvent.change(addBox(), { target: { value: name } });
  await act(async () => {
    fireEvent.submit(addBox().closest("form")!);
  });
}

describe("the People screen", () => {
  it.each([true, false])("carries approval through actual sign-out and restores protection on failure, success=%s", async success => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    let sessionEnded = false;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === accountStatusPath) return Response.json({ configured: true });
      if (path === `${authBasePath}/get-session`) return Response.json({ user: { id: "ada", name: "Ada", email: "ada@example.test" } });
      if (path === accountProfilePath) return Response.json({ preferredName: null });
      if (path === "/api/people") return Response.json({ people: [], revision: 1, established: true });
      if (path === `${authBasePath}/sign-out`) {
        sessionEnded = success;
        return Response.json({}, { status: success ? 200 : 503 });
      }
      return Response.json({});
    }));
    await renderPeople();
    await waitFor(() => expect(screen.getByRole("button", { name: /Signed in as Ada/ })).toBeTruthy());
    fireEvent.change(addBox(), { target: { value: "unfinished" } });
    await press(/Signed in as Ada/);
    await press("Sign out");
    expect(sessionEnded).toBe(success);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(!success);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((addBox() as HTMLInputElement).disabled).toBe(success);
    expect((addBox() as HTMLInputElement).value).toBe("unfinished");
  });
  it("quick-add classifies only whole titles and retains failed input", async () => {
    await renderPeople();
    await add(" Interior designer ");
    expect(readStoredPeople()).toMatchObject({ people: [{ name: "", jobTitle: "Interior designer" }] });
    await add("Bob the plumber");
    expect(names()).toEqual(["Interior designer", "Bob the plumber"]);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await add("Unrecognised text");
    expect((addBox() as HTMLInputElement).value).toBe("Unrecognised text");
    expect(screen.getByRole("alert").textContent).toMatch(/Not saved/);
    write.mockRestore();
    await press("Add");
    expect(names()).toEqual(["Interior designer", "Bob the plumber", "Unrecognised text"]);
  });

  it("switches one editor, retains invalid drafts and keeps row actions separate", async () => {
    savePeople("Andy", "Boris");
    await renderPeople();
    await press("Details for Andy");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "" } });
    await press("Details for Boris");
    expect(screen.getAllByRole("textbox", { name: "Name" })).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toMatch(/Enter a name/);
    await press("Details for Andy");
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    await press("Move Andy down");
    expect(names()).toEqual(["Boris", "Andy"]);
    await press("Delete Andy");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByRole("alertdialog").closest("li")?.textContent).toContain("Andy");
    await press("Cancel");
    await press("Details for Andy");
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("");
  });

  it("retains failed contact edits after collapse and retries them, then swaps atomically", async () => {
    savePeople("Andy");
    await renderPeople();
    await press("Details for Andy");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "+44 (0) 1234" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "andy@example.test" } });
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(readStoredPeople()).toMatchObject({ people: [{ id: "andy", name: "Andy" }] });
    await press("Details for Andy");
    expect((screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement).value).toBe("andy@example.test");
    write.mockRestore();
    await press("Retry");
    expect(readStoredPeople()).toMatchObject({ people: [{ id: "andy", name: "Andy", phone: "+44 (0) 1234", email: "andy@example.test" }] });
    await press("Swap name and job title");
    await waitFor(() => expect(readStoredPeople()).toMatchObject({ people: [{ id: "andy", name: "", jobTitle: "Andy", email: "andy@example.test" }] }));
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "" } });
    await waitFor(() => expect(readStoredPeople()).toEqual({ state: "found", people: [{ id: "andy", name: "", jobTitle: "Andy" }] }));
  });

  it.each(["Projects", "Abodeo - Your home, sorted."])("guards %s departure once and can stay", async link => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await renderPeople();
    fireEvent.change(addBox(), { target: { value: "unfinished" } });
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: link })); });
    expect((addBox() as HTMLInputElement).value).toBe("unfinished");
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: link })); });
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("says there is no one yet, in a new browser", async () => {
    await renderPeople();
    expect(screen.getByText("No people added yet.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "People" })).toBeNull();
  });

  it("says where the people are kept", async () => {
    await renderPeople();
    expect(screen.getByText(/They are kept in this browser\./)).toBeTruthy();
  });

  it("lists the existing people in order", async () => {
    savePeople("Andy", "Boris");
    await renderPeople();
    expect(names()).toEqual(["Andy", "Boris"]);
  });

  it("lists those an existing browser's projects are assigned to", async () => {
    await saveAssignedProject("Shed", "clement");
    await renderPeople();
    expect(names()).toEqual(["Clement"]);
  });

  it("adds a person, keeping the change", async () => {
    await renderPeople();
    await add("  Dora   Lee ");
    expect(names()).toEqual(["Dora Lee"]);
    expect(floatingMessage()).toBe("Dora Lee was added.");
    expect((addBox() as HTMLInputElement).value).toBe("");
    expect(readStoredPeople()).toMatchObject({
      people: [{ name: "Dora Lee" }],
    });
  });

  it.each([
    ["a blank name", " ", "Enter a name or a job title."],
    ["a name that is too long", "x".repeat(41), "Use 40 characters or fewer."],
    [
      "a name already in the list",
      "andy",
      "Someone with that name is already in the list.",
    ],
    [
      "Unassigned",
      "Unassigned",
      "Someone with that name is already in the list.",
    ],
  ])("refuses %s, saying why", async (_, name, message) => {
    savePeople("Andy");
    await renderPeople();
    await add(name);
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(names()).toEqual(["Andy"]);
    // Typing again clears the message.
    fireEvent.change(addBox(), { target: { value: "Dora" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retains edits when collapsed and saves automatically", async () => {
    savePeople("Andy", "Boris");
    await renderPeople();
    await press("Details for Andy");
    let box = screen.getByRole("textbox", {
      name: "Name",
    });
    expect((box as HTMLInputElement).value).toBe("Andy");
    fireEvent.change(box, { target: { value: "Anders" } });
    fireEvent.pointerDown(document.body);
    expect(names()).toEqual(["Andy", "Boris"]);

    await press("Details for Andy");
    box = screen.getByRole("textbox", {
      name: "Name",
    });
    expect((box as HTMLInputElement).value).toBe("Anders");
    await waitFor(() => expect(names()).toEqual(["Anders", "Boris"]));
  });

  it("keeps a person's projects when they are renamed", async () => {
    await saveAssignedProject("Shed", "andy");
    await renderPeople();
    await press("Details for Andy");
    const box = screen.getByRole("textbox", {
      name: "Name",
    });
    fireEvent.change(box, { target: { value: "Anders" } });
    await waitFor(() => expect(names()).toEqual(["Anders"]));
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects[0].assignee).toBe("andy");
  });

  it("refuses a rename to a name in use, and stays editing", async () => {
    savePeople("Andy", "Boris");
    await renderPeople();
    await press("Details for Andy");
    const box = screen.getByRole("textbox", {
      name: "Name",
    });
    fireEvent.change(box, { target: { value: "boris" } });
    expect(screen.getByRole("alert").textContent).toBe(
      "Someone with that name is already in the list.",
    );
    expect(
      screen.getByRole("textbox", {
        name: "Name",
      }),
    ).toBeTruthy();
  });

  it("asks before removing someone with no projects", async () => {
    savePeople("Andy", "Boris");
    await renderPeople();
    await press("Delete Andy");
    const dialog = screen.getByRole("alertdialog", { name: "Remove Andy" });
    expect(dialog.textContent).toContain(
      "Andy is not assigned to any project.",
    );
    expect(names()).toEqual(["Andy", "Boris"]);
    await press("Remove");
    expect(names()).toEqual(["Boris"]);
  });

  it("asks before removing someone assigned to projects, saying how many", async () => {
    savePeople("Andy", "Boris");
    await saveAssignedProject("Shed", "andy");
    await saveAssignedProject("Fence", "andy");
    await saveAssignedProject("Gate", "boris");
    await renderPeople();
    await press("Delete Andy");
    const dialog = screen.getByRole("alertdialog", { name: "Remove Andy" });
    expect(dialog.textContent).toContain(
      "Andy is assigned to 2 projects. Removing Andy sets them to Unassigned.",
    );
    // Nothing has changed yet.
    expect(names()).toEqual(["Andy", "Boris"]);
    await press("Remove");
    expect(names()).toEqual(["Boris"]);
    const loaded = loadProjects();
    expect(
      loaded.ok && loaded.projects.map((project) => project.assignee).sort(),
    ).toEqual(["boris", "unassigned", "unassigned"]);
    expect(floatingMessage()).toBe("Andy was removed.");
  });

  it("keeps everything when the removal is cancelled", async () => {
    savePeople("Andy");
    await saveAssignedProject("Shed", "andy");
    await renderPeople();
    await press("Delete Andy");
    await press("Cancel");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(names()).toEqual(["Andy"]);
    const loaded = loadProjects();
    expect(loaded.ok && loaded.projects[0].assignee).toBe("andy");
  });

  it("asks again, with the new count, when the projects changed meanwhile", async () => {
    savePeople("Andy");
    await saveAssignedProject("Shed", "andy");
    await renderPeople();
    await press("Delete Andy");
    // Another tab assigns Andy to a second project.
    await saveAssignedProject("Fence", "andy");
    await press("Remove");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Please check again.");
    expect(dialog.textContent).toContain("assigned to 2 projects");
    expect(names()).toEqual(["Andy"]);
  });

  it("leaves a list it cannot read as it is, and offers no changes", async () => {
    localStorage.setItem(peopleKey, "{damaged");
    refreshPeople();
    await renderPeople();
    expect(screen.getByRole("alert").textContent).toMatch(/cannot be read/);
    expect(
      screen.queryByRole("textbox", {
        name: "Add a person (required unless only job title known)",
      }),
    ).toBeNull();
    expect(localStorage.getItem(peopleKey)).toBe("{damaged");
  });

  it("has the application menu, with People as the current screen", async () => {
    await renderPeople();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "People" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Projects" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});

describe("describing a removal", () => {
  const person = { id: "andy", name: "Andy" };

  it("names the number of projects", () => {
    expect(describeRemoval({ person, count: 1, unreadable: 0 })).toBe(
      "Andy is assigned to 1 project. Removing Andy sets it to Unassigned.",
    );
    expect(describeRemoval({ person, count: 0, unreadable: 0 })).toBe(
      "Andy is not assigned to any project.",
    );
  });

  it("says how many projects could not be read and were not changed", () => {
    expect(describeRemoval({ person, count: 3, unreadable: 2 })).toBe(
      "Andy is assigned to 3 projects. Removing Andy sets them to Unassigned. 2 projects could not be read and were not changed.",
    );
    expect(describeRemoval({ person, count: 3, unreadable: 1 })).toMatch(
      /1 project could not be read/,
    );
  });
});
