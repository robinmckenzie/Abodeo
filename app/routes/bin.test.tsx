// The Bin page (AD #62 Delete Projects), with the account and projects
// endpoints stood in for by a fake fetch over a memory store.
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

import Bin from "./bin";
import { binPeriodMs } from "../projects/projects-api";
import { handleProjectsRequest } from "../projects/project-handler.server";
import { newProjectFields } from "../projects/projects";
import { createMemoryProjectStore } from "../projects/test-projects.server";
import { withAppLayout } from "../test-routes";

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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ada = { name: "Ada Lovelace", email: "ada@example.com" };

function fakeServer({ isSignedIn = true } = {}) {
  const projects = createMemoryProjectStore();
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? "GET"} ${path}`);
      if (path.startsWith("/api/projects")) {
        return handleProjectsRequest(
          new Request(`http://localhost${path}`, {
            method: init.method,
            headers: init.headers,
            body: init.body,
          }),
          {
            readSessionUserId: async () => (isSignedIn ? "ada" : undefined),
            store: projects.store,
            reportFailure: () => {},
            defaultIds: [],
          },
        );
      }
      switch (path) {
        case "/api/account/status":
          return Response.json({ configured: true });
        case "/api/auth/get-session":
          return Response.json(
            isSignedIn
              ? {
                  user: { id: "ada", ...ada },
                  session: { expiresAt: new Date(Date.now() + 86_400_000) },
                }
              : null,
          );
        case "/api/account/profile":
          return Response.json({ preferredName: null });
        case "/api/account/activity":
          return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    }),
  );
  return { projects, calls };
}

async function renderBin() {
  const Stub = createRoutesStub(
    withAppLayout([
      { path: "/bin", Component: Bin },
      { path: "/dashboard", Component: () => <p>Dashboard</p> },
    ]),
  );
  render(<Stub initialEntries={["/bin"]} />);
  for (let i = 0; i < 5; i++) await act(async () => {});
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
}

const row = (title: string) =>
  screen.getByText(title).closest("li") as HTMLElement;

async function binProject(
  server: ReturnType<typeof fakeServer>,
  id: string,
  title: string,
  ago = 0,
) {
  await server.projects.store.create("ada", id, {
    ...newProjectFields,
    title,
  });
  await server.projects.store.remove("ada", id);
  server.projects.bins.get("ada")!.get(id)!.at = new Date(
    Date.now() - ago,
  ).toISOString();
}

describe("the Bin page", () => {
  it("lists deleted projects with the time left, and a note once the period has passed", async () => {
    const server = fakeServer();
    await binProject(server, "a1", "Shed", 60_000);
    await binProject(server, "a2", "Fence", binPeriodMs + 1000);
    await renderBin();

    expect(within(row("Shed")).getByText("1 day left")).toBeTruthy();
    expect(
      within(row("Fence")).getByText(/^Past the cooling-off period/),
    ).toBeTruthy();
    expect(
      within(row("Shed")).getByRole("button", { name: "Restore" }),
    ).toBeTruthy();
    expect(
      within(row("Shed")).getByRole("button", { name: "Delete permanently" }),
    ).toBeTruthy();
  });

  it("restores a project, even one past the period, without reading the dashboard's list", async () => {
    const server = fakeServer();
    await binProject(server, "a1", "Fence", binPeriodMs + 1000);
    await renderBin();
    await click(within(row("Fence")).getByRole("button", { name: "Restore" }));

    expect(server.projects.accounts.get("ada")?.get("a1")?.title).toBe("Fence");
    expect(screen.getByText("The Bin is empty.")).toBeTruthy();
    expect(server.calls).not.toContain("GET /api/projects");
  });

  it("deletes permanently only after confirmation, at once", async () => {
    const server = fakeServer();
    await binProject(server, "a1", "Shed", 60_000);
    await renderBin();
    await click(
      within(row("Shed")).getByRole("button", { name: "Delete permanently" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Delete “Shed” permanently?",
    });
    expect(within(dialog).getByText("This cannot be undone.")).toBeTruthy();
    expect(server.projects.bins.get("ada")?.has("a1")).toBe(true);
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(server.projects.bins.get("ada")?.has("a1")).toBe(true);

    await click(
      within(row("Shed")).getByRole("button", { name: "Delete permanently" }),
    );
    await click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete permanently",
      }),
    );
    expect(server.projects.bins.get("ada")?.has("a1")).toBe(false);
    expect(screen.getByText("The Bin is empty.")).toBeTruthy();
  });

  it("says when the Bin is empty", async () => {
    fakeServer();
    await renderBin();
    expect(screen.getByText("The Bin is empty.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Bin" })).toBeTruthy();
  });

  it("asks a signed-out visitor to sign in, and reads no Bin", async () => {
    const server = fakeServer({ isSignedIn: false });
    await renderBin();
    expect(screen.getByText(/Sign in to use the Bin/)).toBeTruthy();
    expect(server.calls.some((call) => call.includes("/api/projects"))).toBe(
      false,
    );
  });
});
