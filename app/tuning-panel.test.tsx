import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TuningPanel } from "./tuning-panel";

function pressT() {
  fireEvent.keyDown(window, { key: "t" });
}

function readStyle(container: HTMLElement) {
  return container.querySelector("style")?.textContent ?? "";
}

describe("TuningPanel", () => {
  afterEach(() => {
    // The panel remembers whether it is shown, so leave it hidden.
    if (screen.queryByText("Current values")) pressT();
    cleanup();
  });

  it("is hidden until T is pressed, and hidden again by T", () => {
    render(<TuningPanel />);
    expect(screen.queryByText("Current values")).toBeNull();
    pressT();
    expect(screen.getByText("Current values")).toBeTruthy();
    pressT();
    expect(screen.queryByText("Current values")).toBeNull();
  });

  it("applies the agreed values to the button while hidden", () => {
    const { container } = render(<TuningPanel />);
    const css = readStyle(container);
    expect(css).toContain("transform: scale(1.05)");
    expect(css).toContain("cubic-bezier(0.3, 3.35, 0.6, 1)");
    expect(css).toContain("transform: scale(0.95)");
  });

  it("updates the button's movement when a slider moves", () => {
    const { container } = render(<TuningPanel />);
    pressT();
    const [hoverSize] = screen.getAllByRole("slider", { name: /Size/ });
    fireEvent.change(hoverSize, { target: { value: "1.1" } });
    expect(readStyle(container)).toContain("transform: scale(1.1)");
    fireEvent.change(hoverSize, { target: { value: "1.05" } });
  });

  it("ignores T pressed with Ctrl, so browser shortcuts still work", () => {
    render(<TuningPanel />);
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.queryByText("Current values")).toBeNull();
  });
});
