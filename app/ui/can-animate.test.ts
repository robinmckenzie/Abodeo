import { afterEach, describe, expect, it, vi } from "vitest";

import { canAnimate } from "./can-animate";

function stubReducedMotion(isReduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: isReduced && query === "(prefers-reduced-motion: reduce)",
    })),
  );
}

function createAnimatableElement() {
  const element = document.createElement("div");
  element.animate = vi.fn();
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canAnimate", () => {
  it("allows animation where it is supported and motion is not reduced", () => {
    stubReducedMotion(false);
    expect(canAnimate(createAnimatableElement())).toBe(true);
  });

  it("refuses animation where the browser has no element animations", () => {
    stubReducedMotion(false);
    const element = document.createElement("div");
    Object.defineProperty(element, "animate", { value: undefined });
    expect(canAnimate(element)).toBe(false);
  });

  it("refuses animation where the person prefers reduced motion", () => {
    stubReducedMotion(true);
    expect(canAnimate(createAnimatableElement())).toBe(false);
  });

  it("allows animation where matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(canAnimate(createAnimatableElement())).toBe(true);
  });
});
