import { readFileSync } from "node:fs";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildSpringEasing } from "./spring-easing";
import { defaultValues, TuningPanel } from "./tuning-panel";

// Only what visitors see is tested here: the T panel is a tool for Robin,
// but its CSS applies to every visitor's button, even while it is hidden.
describe("TuningPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("applies the agreed values to the button while hidden", () => {
    render(<TuningPanel />);
    const css = document.getElementById("tuning-panel-css")?.textContent ?? "";
    expect(css).toContain("transform: scale(1.05)");
    expect(css).toContain(buildSpringEasing(defaultValues.hoverSpring));
    expect(css).toContain("transform: scale(0.95)");
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

  it("shrinks the button back with the hover's movement in app.css", () => {
    // Tests run from the repository root.
    const css = readFileSync("app/app.css", "utf8");
    const rule = css.match(/\n\.get-started \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain(
      `transition: transform ${defaultValues.hoverDuration}s var(--spring-hover)`,
    );
  });
});
