import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoAccountEmail } from "./account/account-api";
import { AppMenu } from "./app-menu";
import type { Account } from "./account/use-account";

const account: Account = {
  view: { kind: "signed-out" },
  message: null,
  isLeaving: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  recheck: vi.fn(),
  savePreferredName: vi.fn(),
};

describe("AppMenu", () => {
  afterEach(cleanup);

  it("leaves a click that opens another tab to the browser", () => {
    const onBeforeLeave = vi.fn().mockResolvedValue(true);
    render(
      <MemoryRouter>
        <AppMenu
          current="/dashboard"
          account={account}
          onBeforeLeave={onBeforeLeave}
        />
      </MemoryRouter>,
    );
    const notPrevented = fireEvent.click(
      screen.getByRole("link", { name: "People" }),
      { ctrlKey: true },
    );
    expect(notPrevented).toBe(true);
    expect(onBeforeLeave).not.toHaveBeenCalled();
  });

  it("names each menu link by its screen, whatever its icon", () => {
    render(
      <MemoryRouter>
        <AppMenu
          current="/dashboard"
          account={account}
          onBeforeLeave={vi.fn()}
        />
      </MemoryRouter>,
    );
    for (const name of ["Projects", "People"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
  });

  it("puts the number of projects in the Bin after its name, unless it is empty", () => {
    const signedIn: Account = {
      ...account,
      view: {
        kind: "signed-in",
        id: "ada",
        name: "Ada",
        email: "a@b.c",
        preferredName: null,
        profile: "ready",
      },
    };
    const show = (binCount: number) => (
      <MemoryRouter>
        <AppMenu
          current="/dashboard"
          account={signedIn}
          binCount={binCount}
          onBeforeLeave={vi.fn()}
        />
      </MemoryRouter>
    );
    const { rerender } = render(show(3));
    expect(screen.getByRole("link", { name: "Bin (3)" })).toBeTruthy();
    rerender(show(0));
    expect(screen.getByRole("link", { name: "Bin" })).toBeTruthy();
  });

  describe("Restart tour", () => {
    const signedInAs = (email: string): Account => ({
      ...account,
      view: {
        kind: "signed-in",
        id: "demo",
        name: "Demo",
        email,
        preferredName: null,
        profile: "ready",
      },
    });

    function ShowRequest() {
      const location = useLocation();
      return <p>Projects: {JSON.stringify(location.state)}</p>;
    }

    const show = (email: string, onBeforeLeave: () => Promise<boolean>) =>
      render(
        <MemoryRouter initialEntries={["/people"]}>
          <Routes>
            <Route
              path="/people"
              element={
                <AppMenu
                  current="/people"
                  account={signedInAs(email)}
                  onBeforeLeave={onBeforeLeave}
                />
              }
            />
            <Route path="/dashboard" element={<ShowRequest />} />
          </Routes>
        </MemoryRouter>,
      );

    it("is offered only in the demo account", () => {
      show("a@b.c", vi.fn());
      expect(screen.queryByRole("button", { name: "Restart tour" })).toBeNull();
      cleanup();
      show(demoAccountEmail, vi.fn());
      expect(screen.getByRole("button", { name: "Restart tour" })).toBeTruthy();
    });

    it("lets the screen save, then asks the projects screen to restart the tour", async () => {
      const onBeforeLeave = vi.fn().mockResolvedValue(true);
      show(demoAccountEmail, onBeforeLeave);
      fireEvent.click(screen.getByRole("button", { name: "Restart tour" }));
      expect(
        await screen.findByText('Projects: {"restartTour":true}'),
      ).toBeTruthy();
      expect(onBeforeLeave).toHaveBeenCalledTimes(1);
    });

    it("stays if the screen asks to", async () => {
      const onBeforeLeave = vi.fn().mockResolvedValue(false);
      show(demoAccountEmail, onBeforeLeave);
      fireEvent.click(screen.getByRole("button", { name: "Restart tour" }));
      await waitFor(() => expect(onBeforeLeave).toHaveBeenCalled());
      expect(screen.queryByText(/^Projects:/)).toBeNull();
    });
  });
});
