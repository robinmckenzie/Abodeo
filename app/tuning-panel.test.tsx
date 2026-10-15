import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSpringEasing } from "./spring-easing";
import { defaultValues } from "./tuning-panel";

// Only what visitors see is tested here: the T panel is a tool for Robin.
describe("TuningPanel", () => {
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
