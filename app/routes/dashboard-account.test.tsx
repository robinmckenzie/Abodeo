// Signing in and out on the dashboard, with the account endpoints stood in
// for by a fake fetch.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import { activityReportInterval } from "../account/activity-report";
import { recheckInterval } from "../account/use-account";
import { forgetPresentation } from "../projects/presentation";
import { handleProjectsRequest } from "../projects/project-handler.server";
import { createMemoryProjectStore } from "../projects/test-projects.server";
import { refreshProjects } from "../projects/use-projects";

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
  vi.unstubAllGlobals();
});

type Server = {
  configured: boolean;
  session: { name: string; email: string } | null;
  preferredName: string | null;
  signOutStatus: number;
  signInStatus: number;
  calendarStatus: number;
  calendarBodies: unknown[];
  calls: string[];
  hang: boolean;
  // The account's projects, behind the real projects endpoints.
  projects: ReturnType<typeof createMemoryProjectStore>;
  // Answers every projects request with this status instead, when set.
  projectsStatus: number | null;
  // Handles this many projects requests, then answers 503, as if lost.
  lostAnswers: number;
};

// Answers as the account endpoints would, recording each call.
function fakeServer(overrides: Partial<Server> = {}) {
  const server: Server = {
    configured: true,
    session: null,
    preferredName: null,
    signOutStatus: 200,
    signInStatus: 500,
    calendarStatus: 503,
    calendarBodies: [],
    calls: [],
    hang: false,
    projects: createMemoryProjectStore(),
    projectsStatus: null,
    lostAnswers: 0,
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      server.calls.push(`${init.method ?? "GET"} ${path}`);
      if (server.hang) return new Promise(() => {});
      if (path.startsWith("/api/projects")) {
        if (server.projectsStatus !== null) {
          return Response.json(
            { error: "unavailable" },
            { status: server.projectsStatus },
          );
        }
        const answer = handleProjectsRequest(
          new Request(`http://localhost${path}`, {
            method: init.method,
            headers: init.headers,
            body: init.body,
          }),
          {
            readSessionUserId: async () => (server.session ? "ada" : undefined),
            store: server.projects.store,
            reportFailure: () => {},
            defaultIds: [],
          },
        );
        if (server.lostAnswers > 0) {
          server.lostAnswers--;
          await answer;
          return Response.json({ error: "unavailable" }, { status: 503 });
        }
        return answer;
      }
      switch (path) {
        case "/api/account/status":
          return Response.json({ configured: server.configured });
        case "/api/auth/get-session":
          return Response.json(
            server.session && {
              user: { id: "ada", ...server.session },
              session: { expiresAt: new Date(Date.now() + 86_400_000) },
            },
          );
        case "/api/account/profile":
          if (!server.session) {
            return Response.json({ error: "not_signed_in" }, { status: 401 });
          }
          if (init.method === "PUT") {
            server.preferredName = JSON.parse(String(init.body)).preferredName;
          }
          return Response.json({ preferredName: server.preferredName });
        case "/api/auth/sign-out":
          return new Response("{}", { status: server.signOutStatus });
        case "/api/auth/sign-in/social":
          return new Response("{}", { status: server.signInStatus });
        case "/api/account/activity":
          return new Response(null, { status: server.session ? 204 : 401 });
        case "/api/calendar/test-appointment":
          server.calendarBodies.push(JSON.parse(String(init.body)));
          return new Response("{}", { status: server.calendarStatus });
      }
      return new Response(null, { status: 404 });
    }),
  );
  return server;
}

async function renderDashboard(search = "") {
  const Stub = createRoutesStub([{ path: "/dashboard", Component: Dashboard }]);
  render(<Stub initialEntries={[`/dashboard${search}`]} />);
  // Lets the account lookups finish.
  await act(async () => {});
}

const signInButton = () =>
  screen.getByRole("button", { name: "Sign in with Google" });

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function addProject(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: title },
  });
  await click(screen.getByRole("button", { name: "Create" }));
}

describe("the dashboard's account control", () => {
  it("offers sign-in when signed out, showing no identity", async () => {
    fakeServer();
    await renderDashboard();

    expect(signInButton()).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it("shows the Google name, then the preferred name once set, and the Google name once cleared", async () => {
    fakeServer({ session: { name: "Ada Lovelace", email: "ada@example.com" } });
    await renderDashboard();

    const account = screen.getByRole("button", { name: /Signed in as/ });
    expect(account.textContent).toBe("Signed in as Ada Lovelace");

    await click(account);
    expect(screen.getByText(/ada@example\.com/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Preferred name" }), {
      target: { value: "  Ada  " },
    });
    await click(screen.getByRole("button", { name: "Save" }));
    expect(account.textContent).toBe("Signed in as Ada");

    await click(screen.getByRole("button", { name: "Clear" }));
    expect(account.textContent).toBe("Signed in as Ada Lovelace");
  });

  it("says sign-in is unavailable when it is not configured, leaving projects usable", async () => {
    fakeServer({ configured: false });
    await renderDashboard();

    expect(screen.getByText("Sign-in is unavailable")).toBeTruthy();
    await addProject("Paint the fence");
    expect(
      screen.getByRole("button", { name: /Paint the fence/ }),
    ).toBeTruthy();
  });

  it("says sign-in is unavailable when the server cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError())),
    );
    await renderDashboard();

    expect(screen.getByText("Sign-in is unavailable")).toBeTruthy();
  });

  // Until the sign-in is known, no projects are shown, so that a signed-in
  // person never edits the browser's by mistake.
  it("does not hold up the dashboard while the account service does not answer", async () => {
    localStorage.setItem(
      "abodeo-project:p1",
      JSON.stringify({
        version: 3,
        title: "Paint the fence",
        notes: "",
        assignee: "andy",
        dueDate: null,
        tasks: [],
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    refreshProjects();
    fakeServer({ hang: true });
    await renderDashboard();

    expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Paint the fence/ }),
    ).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it("gives up on a request that does not answer", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fakeServer();
    await renderDashboard();

    expect(timeout).toHaveBeenCalledWith(8000);
  });

  it("says when sign-in did not complete, and removes the error from the address", async () => {
    fakeServer();
    await renderDashboard("?error=access_denied");

    expect(screen.getByRole("alert").textContent).toBe(
      "Sign-in did not complete. Please try again.",
    );
    expect(signInButton()).toBeTruthy();
  });

  it("stops showing an account whose session has ended elsewhere", async () => {
    const server = fakeServer({
      session: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    await renderDashboard();
    expect(screen.getByText(/Signed in as/)).toBeTruthy();

    server.session = null;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + recheckInterval);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(signInButton()).toBeTruthy();
  });

  it("reports clicks and keypresses while signed in, at most once a minute", async () => {
    const server = fakeServer({
      session: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    await renderDashboard();
    const reports = () =>
      server.calls.filter((call) => call === "POST /api/account/activity");
    // An idle page reports nothing.
    expect(reports()).toHaveLength(0);

    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(reports()).toHaveLength(1);

    clock.mockReturnValue(now + activityReportInterval - 1);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "a" });
      fireEvent.pointerDown(document.body);
    });
    expect(reports()).toHaveLength(1);

    clock.mockReturnValue(now + activityReportInterval);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "a" });
    });
    expect(reports()).toHaveLength(2);
  });

  it("lists the sign-in record without saying it ends on sign-out", async () => {
    fakeServer({ session: { name: "Ada Lovelace", email: "ada@example.com" } });
    await renderDashboard();

    await click(screen.getByRole("button", { name: /Signed in as/ }));

    expect(
      screen.getByText("A sign-in record for each browser you use."),
    ).toBeTruthy();
  });

  it("reports no activity while signed out", async () => {
    const server = fakeServer();
    await renderDashboard();

    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.keyDown(document.body, { key: "a" });
    });

    expect(server.calls).not.toContain("POST /api/account/activity");
  });

  it("keeps showing the account and says so when sign-out fails", async () => {
    fakeServer({
      session: { name: "Ada Lovelace", email: "ada@example.com" },
      signOutStatus: 503,
    });
    await renderDashboard();

    await click(screen.getByRole("button", { name: /Signed in as/ }));
    await click(screen.getByRole("button", { name: "Sign out" }));

    expect(screen.getByRole("alert").textContent).toMatch(
      /Sign-out did not complete/,
    );
    expect(screen.getByText(/Signed in as/)).toBeTruthy();
  });

  it("leaves the browser's projects and settings as they are when signing in or out", async () => {
    const server = fakeServer();
    await renderDashboard();
    await addProject("Paint the fence");
    const before = { ...localStorage };

    await click(signInButton());
    server.session = { name: "Ada Lovelace", email: "ada@example.com" };
    server.signOutStatus = 503;
    cleanup();
    await renderDashboard();
    await click(screen.getByRole("button", { name: /Signed in as/ }));
    await click(screen.getByRole("button", { name: "Sign out" }));

    // Signed in, the account's projects were shown, so the hint for the
    // welcome screen is the only addition.
    const after = { ...localStorage };
    delete after["abodeo-account-has-projects"];
    expect(after).toEqual(before);
  });
});

describe("leaving to sign in or out", () => {
  const signInStarted = (server: Server) =>
    server.calls.includes("POST /api/auth/sign-in/social");

  beforeEach(() => {
    // In place, the account control can be used while a project is open, as
    // the floating window's dialog would otherwise prevent.
    localStorage.setItem("abodeo-project-presentation", "in-place");
    forgetPresentation();
  });

  it("goes straight on when nothing would be lost", async () => {
    const server = fakeServer();
    const confirm = vi.spyOn(window, "confirm");
    await renderDashboard();
    await addProject("Paint the fence");

    await click(screen.getByRole("button", { name: /Paint the fence/ }));
    await click(signInButton());

    expect(confirm).not.toHaveBeenCalled();
    expect(signInStarted(server)).toBe(true);
  });

  it("asks before losing a new project not yet added, and stays if asked to", async () => {
    const server = fakeServer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Paint the fence" },
    });

    await click(signInButton());

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatch(/the new project/);
    expect(signInStarted(server)).toBe(false);
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement)
        .value,
    ).toBe("Paint the fence");
  });

  it("continues without it if the person chooses to", async () => {
    const server = fakeServer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Paint the fence" },
    });

    await click(signInButton());

    expect(signInStarted(server)).toBe(true);
  });

  it("does not ask about an Add project form left empty", async () => {
    fakeServer();
    const confirm = vi.spyOn(window, "confirm");
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    await click(signInButton());

    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before leaving a project whose title is blank", async () => {
    fakeServer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDashboard();
    await addProject("Paint the fence");
    await click(screen.getByRole("button", { name: /Paint the fence/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "  " },
    });

    await click(signInButton());

    expect(confirm.mock.calls[0][0]).toMatch(/title, which is blank/);
  });

  it("saves changes still waiting to be saved before leaving", async () => {
    fakeServer();
    await renderDashboard();
    await addProject("Paint the fence");
    await click(screen.getByRole("button", { name: /Paint the fence/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Green" },
    });

    await click(signInButton());

    const saved = Object.keys(localStorage)
      .filter((key) => key.startsWith("abodeo-project:"))
      .map((key) => JSON.parse(localStorage.getItem(key)!));
    expect(saved[0].notes).toBe("Green");
  });

  it("asks before losing changes that could not be saved", async () => {
    const server = fakeServer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDashboard();
    await addProject("Paint the fence");
    await click(screen.getByRole("button", { name: /Paint the fence/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Green" },
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });

    await click(signInButton());

    expect(confirm.mock.calls[0][0]).toMatch(/changes to the project/);
    expect(signInStarted(server)).toBe(false);
  });

  it("asks before losing tasks typed but not yet added", async () => {
    fakeServer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDashboard();
    await addProject("Paint the fence");
    await click(screen.getByRole("button", { name: /Paint the fence/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Add tasks, one per line" }),
      { target: { value: "Buy paint" } },
    );

    await click(signInButton());

    expect(confirm.mock.calls[0][0]).toMatch(/tasks typed but not yet added/);
  });

  it("asks the same before signing out", async () => {
    const server = fakeServer({
      session: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDashboard();
    await click(screen.getByRole("button", { name: /Signed in as/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Paint the fence" },
    });

    await click(screen.getByRole("button", { name: "Sign out" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(server.calls).not.toContain("POST /api/auth/sign-out");
  });
});

describe("the Calendar test", () => {
  const ada = { name: "Ada Lovelace", email: "ada@example.com" };
  const testButton = () =>
    screen.getByRole("button", { name: "Create test appointment" });

  it("is offered in the account panel when signed in", async () => {
    fakeServer({ session: ada });
    await renderDashboard();

    await click(screen.getByRole("button", { name: /Signed in as/ }));

    expect(testButton()).toBeTruthy();
    expect(screen.getByText(/ID of your Abodeo calendar/)).toBeTruthy();
  });

  it("sends the browser's time zone, and says so when the test cannot start", async () => {
    const server = fakeServer({ session: ada });
    // Earlier tests can leave typed tasks behind, which the check before
    // leaving asks about.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderDashboard();
    await click(screen.getByRole("button", { name: /Signed in as/ }));

    await click(testButton());

    expect(server.calls).toContain("POST /api/calendar/test-appointment");
    expect(server.calendarBodies).toEqual([
      { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    ]);
    expect(screen.getByRole("alert").textContent).toBe(
      "The test appointment could not be created. Please try again.",
    );
  });

  it("asks before losing unsaved work, and stays if asked to", async () => {
    const server = fakeServer({ session: ada });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderDashboard();
    await click(screen.getByRole("button", { name: /Signed in as/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Paint the fence" },
    });

    await click(testButton());

    expect(confirm).toHaveBeenCalledOnce();
    expect(server.calls).not.toContain("POST /api/calendar/test-appointment");
  });

  it("shows the result Google's return brought, with a link to the signed-in account's calendar once created", async () => {
    fakeServer({ session: ada });
    await renderDashboard("?calendar=created");

    expect(
      screen
        .getByText(/^Test appointment created in your Abodeo calendar\./)
        .getAttribute("role"),
    ).toBe("status");
    expect(
      screen
        .getByRole("link", { name: "Open Google Calendar" })
        .getAttribute("href"),
    ).toBe("https://calendar.google.com/calendar/r?authuser=ada%40example.com");
  });

  it("holds back the link until the signed-in account is known", async () => {
    fakeServer({ hang: true });
    await renderDashboard("?calendar=created");

    expect(
      screen.getByText(/^Test appointment created in your Abodeo calendar\./),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Google Calendar" })).toBe(
      null,
    );
  });

  it("says when access was not given or another account was chosen, and ignores unknown results", async () => {
    fakeServer({ session: ada });
    await renderDashboard("?calendar=denied");
    expect(screen.getByRole("alert").textContent).toBe(
      "Calendar access was not given, so no appointment was created.",
    );
    cleanup();

    await renderDashboard("?calendar=wrong-account");
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose the Google account you signed in with. No appointment was created.",
    );
    cleanup();

    await renderDashboard("?calendar=nonsense");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a signed-in account's projects (AD #41)", () => {
  const ada = { name: "Ada Lovelace", email: "ada@example.com" };
  const fields = {
    notes: "",
    assignee: "andy" as const,
    dueDate: null,
    tasks: [],
  };
  const browserProject = (id: string, title: string) =>
    localStorage.setItem(
      `abodeo-project:${id}`,
      JSON.stringify({
        version: 3,
        title,
        ...fields,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
  const browserProjectIds = () =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("abodeo-project:"),
    );
  const titleField = () =>
    screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
  const accountProject = (server: Server, id: string) =>
    server.projects.accounts.get("ada")?.get(id);

  // Lets every request and the answers' effects finish.
  async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => {});
  }

  async function openProject(title: string) {
    await click(screen.getByRole("button", { name: new RegExp(title) }));
    await settle();
  }

  async function typeTitle(title: string) {
    fireEvent.change(titleField(), { target: { value: title } });
    await act(async () => {
      fireEvent.blur(titleField());
    });
    await settle();
  }

  it("shows the account's projects, not the browser's", async () => {
    browserProject("b1", "Browser shed");
    refreshProjects();
    const server = fakeServer({ session: ada });
    await server.projects.store.create("ada", "a1", {
      title: "Account shed",
      ...fields,
    });
    await renderDashboard();
    await settle();

    expect(screen.getByRole("button", { name: /Account shed/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Browser shed/ })).toBeNull();
  });

  it("adds a project to the account and not to the browser", async () => {
    const server = fakeServer({ session: ada });
    await renderDashboard();
    await settle();

    await addProject("Paint the fence");
    await settle();

    expect(
      screen.getByRole("button", { name: /Paint the fence/ }),
    ).toBeTruthy();
    expect(browserProjectIds()).toEqual([]);
    const [saved] = server.projects.accounts.get("ada")!.values();
    expect(saved.title).toBe("Paint the fence");
  });

  it("adds a new project once when Create is pressed again after a failure", async () => {
    const server = fakeServer({ session: ada });
    await renderDashboard();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.change(titleField(), { target: { value: "Paint the fence" } });
    server.projectsStatus = 503;
    await click(screen.getByRole("button", { name: "Create" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "Not saved: Abodeo cannot reach your projects right now.",
    );

    server.projectsStatus = null;
    await click(screen.getByRole("button", { name: "Create" }));
    await settle();

    expect(server.projects.accounts.get("ada")!.size).toBe(1);
  });

  describe("when a Create's answer was lost", () => {
    async function createWithLostAnswer() {
      const server = fakeServer({ session: ada });
      await renderDashboard();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      fireEvent.change(titleField(), { target: { value: "Shed" } });
      server.lostAnswers = 1;
      await click(screen.getByRole("button", { name: "Create" }));
      await settle();
      const [added] = server.projects.accounts.get("ada")!.values();
      return { server, added };
    }

    it("saves edits made before Create is pressed again", async () => {
      const { server, added } = await createWithLostAnswer();
      fireEvent.change(titleField(), { target: { value: "Painted shed" } });
      await click(screen.getByRole("button", { name: "Create" }));
      await settle();

      expect(server.projects.accounts.get("ada")!.size).toBe(1);
      expect(accountProject(server, added.id)?.title).toBe("Painted shed");
      expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    });

    it("keeps changes made on another device since", async () => {
      const { server, added } = await createWithLostAnswer();
      await server.projects.store.saveChanges(
        "ada",
        added.id,
        { notes: "" },
        { notes: "From the other device" },
      );
      fireEvent.change(titleField(), { target: { value: "Painted shed" } });
      await click(screen.getByRole("button", { name: "Create" }));
      await settle();

      expect(accountProject(server, added.id)).toMatchObject({
        title: "Painted shed",
        notes: "From the other device",
      });
      expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    });

    it("says so when this form and another device both changed a field", async () => {
      const { server, added } = await createWithLostAnswer();
      await server.projects.store.saveChanges(
        "ada",
        added.id,
        { notes: "" },
        { notes: "From the other device" },
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
        target: { value: "Mine" },
      });
      await click(screen.getByRole("button", { name: "Create" }));
      await settle();

      expect(accountProject(server, added.id)?.notes).toBe(
        "From the other device",
      );
      expect(
        screen.getByText(/changed on another device, so some/),
      ).toBeTruthy();
    });
  });

  it("offers to move the browser's own projects in, and moves them", async () => {
    browserProject("b1", "Browser shed");
    refreshProjects();
    const server = fakeServer({ session: ada });
    await renderDashboard();
    await settle();
    expect(
      screen.getByText(
        "This browser has 1 project saved while signed out. Move it into your account?",
      ),
    ).toBeTruthy();

    await click(screen.getByRole("button", { name: "Move" }));
    await settle();

    expect(accountProject(server, "b1")?.title).toBe("Browser shed");
    expect(browserProjectIds()).toEqual([]);
    expect(screen.getByRole("button", { name: /Browser shed/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
  });

  it("leaves the browser and account as they are on Not now, and offers again at the next sign-in", async () => {
    browserProject("b1", "Browser shed");
    refreshProjects();
    const server = fakeServer({ session: ada });
    await renderDashboard();
    await settle();

    await click(screen.getByRole("button", { name: "Not now" }));
    expect(browserProjectIds()).toEqual(["abodeo-project:b1"]);
    expect(server.projects.accounts.get("ada")!.size).toBe(0);
    cleanup();
    await renderDashboard();
    await settle();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();

    // jsdom cannot leave the page, so the reload after signing out is stood
    // in for by rendering again, and its complaint is silenced.
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Earlier tests can leave typed tasks behind, which the check before
    // leaving asks about.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click(screen.getByRole("button", { name: /Signed in as/ }));
    await click(screen.getByRole("button", { name: "Sign out" }));
    await settle();
    cleanup();
    await renderDashboard();
    await settle();
    expect(screen.getByRole("button", { name: "Move" })).toBeTruthy();
  });

  it("does not offer default projects", async () => {
    browserProject("d1", "Welcome");
    localStorage.setItem(
      "abodeo-default-projects",
      JSON.stringify({ hash: "h", ids: ["d1"] }),
    );
    refreshProjects();
    fakeServer({ session: ada });
    await renderDashboard();
    await settle();

    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
  });

  it("says the projects cannot be loaded, showing none of the browser's", async () => {
    browserProject("b1", "Browser shed");
    refreshProjects();
    fakeServer({ session: ada, projectsStatus: 503 });
    await renderDashboard();
    await settle();

    expect(screen.getByRole("alert").textContent).toBe(
      "Your projects cannot be loaded right now. Please try again later.",
    );
    expect(screen.queryByRole("button", { name: /Browser shed/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Add project" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: /Signed in as/ })).toBeTruthy();
  });

  it("opens the latest saved copy, which can be changed once it has loaded", async () => {
    const server = fakeServer({ session: ada });
    await server.projects.store.create("ada", "a1", {
      title: "Old",
      ...fields,
    });
    await renderDashboard();
    await settle();
    await server.projects.store.saveChanges(
      "ada",
      "a1",
      { notes: "" },
      { notes: "Changed on another device" },
    );

    await openProject("Old");

    expect(
      (screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Changed on another device");
    expect(titleField().closest("[inert]")).toBeNull();
  });

  it("cannot change a project whose latest copy cannot be loaded", async () => {
    const server = fakeServer({ session: ada });
    await server.projects.store.create("ada", "a1", {
      title: "Old",
      ...fields,
    });
    await renderDashboard();
    await settle();
    server.projectsStatus = 503;

    await openProject("Old");

    expect(
      screen.getByText("This project cannot be loaded right now."),
    ).toBeTruthy();
    expect(titleField().closest("[inert]")).not.toBeNull();
  });

  it("closes an open project when the account's projects stop loading", async () => {
    const server = fakeServer({ session: ada });
    await server.projects.store.create("ada", "a1", {
      title: "Shed",
      ...fields,
    });
    await renderDashboard();
    await settle();
    await openProject("Shed");
    server.projectsStatus = 503;

    const later = Date.now() + 11_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await act(async () => {
      fireEvent.focus(window);
    });
    await settle();

    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(
      screen.getByText(
        "Your projects cannot be loaded right now. Please try again later.",
      ),
    ).toBeTruthy();
  });

  it("keeps a field changed elsewhere when saving another", async () => {
    const server = fakeServer({ session: ada });
    await server.projects.store.create("ada", "a1", {
      title: "Shed",
      ...fields,
    });
    await renderDashboard();
    await settle();
    await openProject("Shed");
    await server.projects.store.saveChanges(
      "ada",
      "a1",
      { notes: "" },
      { notes: "From the other device" },
    );

    await typeTitle("Shed, painted");

    expect(accountProject(server, "a1")).toMatchObject({
      title: "Shed, painted",
      notes: "From the other device",
    });
  });

  describe("when a field was changed on another device", () => {
    async function openConflict() {
      const server = fakeServer({ session: ada });
      await server.projects.store.create("ada", "a1", {
        title: "Shed",
        ...fields,
      });
      await renderDashboard();
      await settle();
      await openProject("Shed");
      await server.projects.store.saveChanges(
        "ada",
        "a1",
        { title: "Shed" },
        { title: "Theirs" },
      );
      await typeTitle("Mine");
      return server;
    }

    it("does not save over it, and says so", async () => {
      const server = await openConflict();

      expect(
        screen.getByText("This project was changed on another device.")
          .className,
      ).toBe("project-form-error");
      expect(accountProject(server, "a1")?.title).toBe("Theirs");
    });

    it("saves over it on Keep mine", async () => {
      const server = await openConflict();

      await click(screen.getByRole("button", { name: "Keep mine" }));
      await settle();

      expect(accountProject(server, "a1")?.title).toBe("Mine");
      expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    });

    it("shows the saved version on Use saved version", async () => {
      const server = await openConflict();

      await click(screen.getByRole("button", { name: "Use saved version" }));
      await settle();

      expect(titleField().value).toBe("Theirs");
      expect(accountProject(server, "a1")?.title).toBe("Theirs");
      expect(
        screen.queryByText("This project was changed on another device."),
      ).toBeNull();
    });
  });

  it("chooses the welcome screen by the account's projects, until signed out", async () => {
    const server = fakeServer({ session: ada });
    await renderDashboard();
    await settle();
    const hint = () =>
      JSON.parse(localStorage.getItem("abodeo-account-has-projects") ?? "null");
    expect(hint()).toEqual({ accountId: "ada", hasProjects: false });

    await addProject("Paint the fence");
    await settle();
    expect(hint()).toEqual({ accountId: "ada", hasProjects: true });

    server.session = null;
    cleanup();
    await renderDashboard();
    await settle();
    expect(hint()).toBeNull();
  });

  it("resets only the browser's projects to the defaults while signed in", async () => {
    const server = fakeServer({ session: ada });
    await server.projects.store.create("ada", "a1", {
      title: "Shed",
      ...fields,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderDashboard();
    await settle();

    expect(
      screen.getByText("Acts on this browser's signed-out projects"),
    ).toBeTruthy();
    await click(screen.getByRole("button", { name: "Reset to defaults" }));
    await settle();

    expect(accountProject(server, "a1")?.title).toBe("Shed");
    expect(screen.getByRole("button", { name: /Shed/ })).toBeTruthy();
  });
});
