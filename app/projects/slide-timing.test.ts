import { describe, expect, it } from "vitest";

import { calculateSlideStagger, slideTiming } from "./slide-timing";

// From the first slide starting to the moved task's slide ending.
const total = (places: number) =>
  places * calculateSlideStagger(places) + slideTiming.duration;

describe("slide stagger", () => {
  it("takes 310 ms for one place and about 370 ms for two", () => {
    expect(total(1)).toBeCloseTo(310);
    expect(total(2)).toBeCloseTo(369, 0);
  });

  it("takes longer the further a task moves, but never twice as long as one place", () => {
    const totals = [1, 2, 3, 5, 10, 50].map(total);
    totals
      .slice(1)
      .forEach((time, i) => expect(time).toBeGreaterThan(totals[i]));
    expect(total(50)).toBeLessThan(620);
    expect(total(1000)).toBeCloseTo(620);
  });

  it("does not wait when nothing makes way", () => {
    expect(calculateSlideStagger(0)).toBe(0);
  });
});
