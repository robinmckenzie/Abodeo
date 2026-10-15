import { describe, expect, it } from "vitest";

import { buildSpringEasing, calculateSpringProgress } from "./spring-easing";

const spring = { first: 0.8, dip: 0.3, second: 0.15, peakAt: 0.3 };

describe("calculateSpringProgress", () => {
  it("starts at 0 and ends at the target", () => {
    expect(calculateSpringProgress(spring, 0)).toBe(0);
    expect(calculateSpringProgress(spring, 1)).toBe(1);
  });

  it("peaks at the first bounce, dips, then peaks again by less", () => {
    const step = (1 - spring.peakAt) / 3;
    expect(calculateSpringProgress(spring, 0.3)).toBeCloseTo(1.8);
    expect(calculateSpringProgress(spring, 0.3 + step)).toBeCloseTo(0.7);
    expect(calculateSpringProgress(spring, 0.3 + 2 * step)).toBeCloseTo(1.15);
  });

  it("settles without a dip or second bounce when they are 0", () => {
    const single = { ...spring, dip: 0, second: 0 };
    expect(calculateSpringProgress(single, 0.8)).toBeGreaterThanOrEqual(1);
    expect(calculateSpringProgress(single, 0.8)).toBeLessThan(1.8);
  });
});

describe("buildSpringEasing", () => {
  it("writes a CSS linear() function from 0 to 1", () => {
    const easing = buildSpringEasing(spring, 4);
    expect(easing).toMatch(/^linear\(0, .+, 1\)$/);
    expect(easing).toContain(" 25%");
  });
});
