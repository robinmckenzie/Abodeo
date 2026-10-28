// The layout every screen shares (AD #99 Layout and Style Tidy): the left-hand
// column and the account are looked up once and stay while moving between
// screens, and the current screen is the one that gets ready to be left.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScreenLeave } from "../screen-context";
import { withAppLayout } from "../test-routes";

const sessionPath = "/api/auth/get-session";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      switch (path) {
        case "/api/account/status":
          return Response.json({ configured: true });
        case sessionPath:
          return Response.json({
            user: { id: "ada", name: "Ada Lovelace", email: "ada@example.com" },
            session: { expiresAt: new Date(Date.now() + 86_400_000) },
          });
        case "/api/account/profile":
          return Response.json({ preferredName: null });
        case "/api/auth/sign-out":
          return new Response("{}", { status: 503 });
      }
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Screen({
  name,
  leave,
}: {
  name: string;
  leave?: Parameters<typeof useScreenLeave>[0];
}) {
  useScreenLeave(leave ?? {});
  return <h2>{name} screen</h2>;
}

async function renderLayout(
  screens: Record<string, Parameters<typeof useScreenLeave>[0] | undefined>,
  initialPath: string,
) {
  const Stub = createRoutesStub(
    withAppLayout(
      Object.entries(screens).map(([path, leave]) => ({
        path: `/${path}`,
        Component: () => <Screen name={path} leave={leave} />,
      })),
    ),
  );
  render(<Stub initialEntries={[initialPath]} />);
  await act(async () => {});
}

const click = (element: HTMLElement) =>
  act(async () => {
    fireEvent.click(element);
  });

const menuLink = (name: string) =>
  screen.getByRole("link", { name });

describe("the shared layout", () => {
  it("looks the account up once and keeps the column while moving between screens", async () => {
    await renderLayout(
      { dashboard: undefined, people: undefined, bin: undefined },
      "/dashboard",
    );
    const column = document.querySelector("header");
    const lookups = () =>
      vi.mocked(fetch).mock.calls.filter(([path]) => path === sessionPath);
    expect(lookups()).toHaveLength(1);

    await click(menuLink("People"));
    expect(screen.getByText("people screen")).toBeTruthy();
    await click(menuLink("Bin"));
    expect(screen.getByText("bin screen")).toBeTruthy();

    expect(document.querySelector("header")).toBe(column);
    expect(lookups()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Signed in as/ })).toBeTruthy();
  });

  it("lets the current screen get ready when signing out, and tells it if that fails", async () => {
    const people = {
      onBeforeLeave: vi.fn(async () => true),
      onLeaveFailed: vi.fn(),
    };
    await renderLayout({ dashboard: undefined, people }, "/people");

    await click(screen.getByRole("button", { name: /Signed in as/ }));
    await click(screen.getByRole("button", { name: "Sign out" }));

    expect(people.onBeforeLeave).toHaveBeenCalledOnce();
    expect(people.onLeaveFailed).toHaveBeenCalledOnce();
  });

  it("uses the handlers of the screen shown now, not the one left", async () => {
    const dashboard = { onBeforeLeave: vi.fn(async () => true) };
    const people = { onBeforeLeave: vi.fn(async () => true) };
    await renderLayout({ dashboard, people }, "/dashboard");

    await click(menuLink("People"));
    expect(dashboard.onBeforeLeave).toHaveBeenCalledOnce();
    expect(people.onBeforeLeave).not.toHaveBeenCalled();

    await click(screen.getByRole("button", { name: /Signed in as/ }));
    await click(screen.getByRole("button", { name: "Sign out" }));
    expect(people.onBeforeLeave).toHaveBeenCalledOnce();
    expect(dashboard.onBeforeLeave).toHaveBeenCalledOnce();
  });

  it("stays on the screen when it is not ready to be left", async () => {
    const dashboard = { onBeforeLeave: vi.fn(async () => false) };
    await renderLayout({ dashboard, people: undefined }, "/dashboard");

    await click(menuLink("People"));

    expect(screen.getByText("dashboard screen")).toBeTruthy();
  });

  it("makes the logo a link that leaves the screen first, and does nothing on Projects", async () => {
    const people = { onBeforeLeave: vi.fn(async () => true) };
    await renderLayout({ dashboard: undefined, people }, "/people");

    await click(screen.getByRole("link", { name: /Abodeo - Your home/ }));
    expect(people.onBeforeLeave).toHaveBeenCalledOnce();
    expect(screen.getByText("dashboard screen")).toBeTruthy();

    await click(screen.getByRole("link", { name: /Abodeo - Your home/ }));
    expect(screen.getByText("dashboard screen")).toBeTruthy();
  });
});
