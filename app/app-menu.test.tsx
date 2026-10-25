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
});
