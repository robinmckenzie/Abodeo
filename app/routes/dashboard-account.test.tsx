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
import { recheckInterval } from "../account/use-account";
import { forgetPresentation } from "../projects/presentation";
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
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      server.calls.push(`${init.method ?? "GET"} ${path}`);
      if (server.hang) return new Promise(() => {});
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

  it("does not hold up the dashboard while the account service does not answer", async () => {
    fakeServer({ hang: true });
    await renderDashboard();

    await addProject("Paint the fence");
    expect(
      screen.getByRole("button", { name: /Paint the fence/ }),
    ).toBeTruthy();
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

  it("leaves projects and settings as they are when signing in or out", async () => {
    const server = fakeServer({
      session: { name: "Ada Lovelace", email: "ada@example.com" },
      signOutStatus: 503,
    });
    await renderDashboard();
    await addProject("Paint the fence");
    const before = { ...localStorage };

    await click(screen.getByRole("button", { name: /Signed in as/ }));
    await click(screen.getByRole("button", { name: "Sign out" }));
    server.session = null;
    cleanup();
    await renderDashboard();
    await click(signInButton());

    expect({ ...localStorage }).toEqual(before);
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

  it("shows the result Google's return brought, with a link once created", async () => {
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
    ).toBe("https://calendar.google.com/");
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
