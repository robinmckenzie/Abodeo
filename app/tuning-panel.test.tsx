import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildSpringEasing } from "./spring-easing";
import { defaultValues, TuningPanel } from "./tuning-panel";

function pressT() {
  fireEvent.keyDown(window, { key: "t" });
}

function readStyle() {
  return document.getElementById("tuning-panel-css")?.textContent ?? "";
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
    render(<TuningPanel />);
    const css = readStyle();
    expect(css).toContain("transform: scale(1.05)");
    expect(css).toContain(buildSpringEasing(defaultValues.hoverSpring));
    expect(css).toContain("transform: scale(0.95)");
  });

  it("updates the button's movement when a slider moves", () => {
    render(<TuningPanel />);
    pressT();
    const [hoverSize] = screen.getAllByRole("slider", { name: /Size/ });
    fireEvent.change(hoverSize, { target: { value: "1.1" } });
    expect(readStyle()).toContain("transform: scale(1.1)");
    fireEvent.change(hoverSize, { target: { value: "1.05" } });
  });

  it("keeps the tuned values after the welcome screen is removed", () => {
    const { unmount } = render(<TuningPanel />);
    unmount();
    expect(readStyle()).toContain("tune-release");
  });

  it("starts from the same movements as app.css", () => {
    // Tests run from the repository root.
    const css = readFileSync("app/app.css", "utf8");
    const readVariable = (name: string) =>
      css.match(new RegExp(`--${name}:\\s*(linear\\([^)]*\\))`))?.[1];
    const normalise = (easing = "") => easing.replace(/\s+/g, "");
    for (const [name, spring] of [
      ["spring-hover", defaultValues.hoverSpring],
      ["spring-press", defaultValues.pressSpring],
      ["spring-release", defaultValues.releaseSpring],
    ] as const) {
      expect(normalise(readVariable(name))).toBe(
        normalise(buildSpringEasing(spring)),
      );
    }
  });

  it("ignores T pressed with Ctrl, so browser shortcuts still work", () => {
    render(<TuningPanel />);
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.queryByText("Current values")).toBeNull();
  });
});
