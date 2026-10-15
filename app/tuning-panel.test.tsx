import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildSpringEasing } from "./spring-easing";
import { defaultValues, parseValues, TuningPanel } from "./tuning-panel";

function pressT() {
  fireEvent.keyDown(window, { key: "t" });
}

function readStyle() {
  return document.getElementById("tuning-panel-css")?.textContent ?? "";
}

describe("TuningPanel", () => {
  afterEach(() => {
    // The panel remembers its values and whether it is shown, so leave it
    // hidden with the defaults.
    if (screen.queryByText("Current values")) {
      fireEvent.click(
        screen.getByRole("button", { name: "Reset to defaults" }),
      );
      pressT();
    }
    cleanup();
    localStorage.clear();
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

  it("shrinks the button back with the hover's tuned movement", () => {
    render(<TuningPanel />);
    pressT();
    const [hoverDuration] = screen.getAllByRole("slider", {
      name: /Duration/,
    });
    fireEvent.change(hoverDuration, { target: { value: "0.5" } });
    const unhover = readStyle().match(/\.get-started \{([^}]*)\}/)?.[1] ?? "";
    expect(unhover).toContain("transition-duration: 0.5s");
    expect(unhover).toContain(buildSpringEasing(defaultValues.hoverSpring));
  });

  it("shrinks the button back with the hover's movement in app.css", () => {
    // Tests run from the repository root.
    const css = readFileSync("app/app.css", "utf8");
    const rule = css.match(/\n\.get-started \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain(
      `transition: transform ${defaultValues.hoverDuration}s var(--spring-hover)`,
    );
  });

  it("ignores T pressed with Ctrl, so browser shortcuts still work", () => {
    render(<TuningPanel />);
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.queryByText("Current values")).toBeNull();
  });

  it("keeps tuned values in local storage, until Reset to defaults", () => {
    render(<TuningPanel />);
    pressT();
    const [hoverSize] = screen.getAllByRole("slider", { name: /Size/ });
    fireEvent.change(hoverSize, { target: { value: "1.1" } });
    const stored = parseValues(localStorage.getItem("abodeo-button-tuning"));
    expect(stored.hoverScale).toBe(1.1);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(localStorage.getItem("abodeo-button-tuning")).toBeNull();
    expect(readStyle()).toContain("transform: scale(1.05)");
  });

  it("uses the default for each saved value that is missing or out of range", () => {
    const values = parseValues(
      JSON.stringify({
        hoverScale: 1.1,
        pressScale: 5,
        hoverSpring: { first: 1, dip: "0.2" },
      }),
    );
    expect(values.hoverScale).toBe(1.1);
    expect(values.pressScale).toBe(defaultValues.pressScale);
    expect(values.hoverSpring).toEqual({
      ...defaultValues.hoverSpring,
      first: 1,
    });
    expect(values.releaseDuration).toBe(defaultValues.releaseDuration);
  });

  it("uses the defaults when the saved data cannot be read", () => {
    expect(parseValues("not json")).toEqual(defaultValues);
    expect(parseValues(null)).toEqual(defaultValues);
  });
});
