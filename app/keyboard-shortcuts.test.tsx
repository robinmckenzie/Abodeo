import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcuts } from "./keyboard-shortcuts";

afterEach(cleanup);

const rows = () =>
  within(
    screen.getByRole("complementary", { name: "Keyboard shortcuts" }),
  ).queryAllByRole("listitem");

describe("KeyboardShortcuts", () => {
  it("lists each key as a keycap followed by what it does", () => {
    render(
      <KeyboardShortcuts
        shortcuts={[
          { key: "T", action: "Toggle tuning panel" },
          { key: "Esc", action: "Close open project" },
        ]}
      />,
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      "TToggle tuning panel",
      "EscClose open project",
    ]);
    expect(rows()[1].querySelector("kbd")?.textContent).toBe("Esc");
  });

  it("presses a keycap's key when it is clicked, or calls its own action", () => {
    const keys: string[] = [];
    const recordKey = (event: KeyboardEvent) => keys.push(event.key);
    window.addEventListener("keydown", recordKey);
    const onPress = vi.fn();
    render(
      <KeyboardShortcuts
        shortcuts={[
          { key: "T", action: "Toggle tuning panel" },
          { key: "Esc", action: "Close open project", onPress },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "T" }));
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    window.removeEventListener("keydown", recordKey);
    expect(keys).toEqual(["t"]);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("keeps the space of a shortcut that is not shown", () => {
    const { container } = render(
      <KeyboardShortcuts
        shortcuts={[
          { key: "T", action: "Toggle tuning panel" },
          { key: "Esc", action: "Close open project", isShown: false },
        ]}
      />,
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      "TToggle tuning panel",
    ]);
    const hidden = container.querySelectorAll("li")[1];
    expect(hidden.textContent).toBe("EscClose open project");
    expect(hidden.style.visibility).toBe("hidden");
  });
});
