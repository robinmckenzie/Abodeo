import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
