import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { defaultSizes } from "./size-sliders";

// Only what visitors see is tested here: the size sliders are a tool for
// Robin.
describe("SizeSliders", () => {
  it("starts from the same sizes as app.css", () => {
    // Tests run from the repository root.
    const css = readFileSync("app/app.css", "utf8");
    const readFallbacks = (name: string) =>
      [...css.matchAll(new RegExp(`var\\(--${name}, ([\\d.]+)\\)`, "g"))].map(
        (match) => Number(match[1]),
      );
    expect(readFallbacks("logo-size")).toEqual([
      defaultSizes.logo,
      defaultSizes.logo,
    ]);
    expect(readFallbacks("button-size")).toEqual([
      defaultSizes.button,
      defaultSizes.button,
    ]);
  });
});
