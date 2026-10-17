import { describe, expect, it } from "vitest";

import { calculateDragScroll } from "./drag-scroll";

describe("calculateDragScroll", () => {
  it("does not scroll in the middle of the list", () => {
    expect(calculateDragScroll(200, 100, 300)).toBe(0);
  });

  it("scrolls up near the top edge and anywhere above the list", () => {
    expect(calculateDragScroll(120, 100, 300)).toBeLessThan(0);
    expect(calculateDragScroll(-500, 100, 300)).toBeLessThan(0);
  });

  it("scrolls down near the bottom edge and anywhere below the list", () => {
    expect(calculateDragScroll(280, 100, 300)).toBeGreaterThan(0);
    expect(calculateDragScroll(900, 100, 300)).toBeGreaterThan(0);
  });

  it("scrolls faster the further the pointer goes, up to a limit", () => {
    const near = Math.abs(calculateDragScroll(145, 100, 300));
    const far = Math.abs(calculateDragScroll(60, 100, 300));
    const farther = Math.abs(calculateDragScroll(-900, 100, 300));
    expect(far).toBeGreaterThan(near);
    expect(farther).toBe(Math.abs(calculateDragScroll(-9000, 100, 300)));
  });
});
