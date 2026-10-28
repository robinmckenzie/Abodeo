import { describe, expect, it } from "vitest";

import { calculateBarScrollEnd, calculateBarTopLimit } from "./bar-scroll";

const view = {
  start: 0,
  viewportHeight: 800,
  pageEnd: 2000,
  scrollsToPageEnd: false,
  margin: 16,
};

describe("calculateBarTopLimit", () => {
  it("keeps the bar's top a margin below the top of the window", () => {
    expect(
      calculateBarTopLimit({ barTop: 1000, stickyOffset: 0, margin: 16 }),
    ).toBe(984);
  });

  it("keeps the bar's top below a sticky title as well", () => {
    expect(
      calculateBarTopLimit({ barTop: 1000, stickyOffset: 100, margin: 16 }),
    ).toBe(884);
  });
});

describe("calculateBarScrollEnd", () => {
  it("leaves the page alone when the bar already fits", () => {
    expect(
      calculateBarScrollEnd({
        ...view,
        barTop: 100,
        height: 300,
        stickyOffset: 0,
      }),
    ).toBe(0);
  });

  it("scrolls just far enough to show the foot of a short bar", () => {
    expect(
      calculateBarScrollEnd({
        ...view,
        barTop: 700,
        height: 300,
        stickyOffset: 0,
      }),
    ).toBe(216);
  });

  it("shows the foot of a short bar the same with a sticky title", () => {
    expect(
      calculateBarScrollEnd({
        ...view,
        barTop: 700,
        height: 300,
        stickyOffset: 100,
      }),
    ).toBe(216);
  });

  it("stops a tall bar with its top at the window's top", () => {
    expect(
      calculateBarScrollEnd({
        ...view,
        barTop: 700,
        height: 1200,
        stickyOffset: 0,
      }),
    ).toBe(684);
  });

  it("stops a tall bar with its top below a sticky title", () => {
    expect(
      calculateBarScrollEnd({
        ...view,
        barTop: 700,
        height: 1200,
        stickyOffset: 100,
      }),
    ).toBe(584);
  });

  it("scrolls to the end of the page for a new project, but not past its top", () => {
    const bar = { ...view, scrollsToPageEnd: true, height: 300 };
    expect(
      calculateBarScrollEnd({ ...bar, barTop: 2500, stickyOffset: 100 }),
    ).toBe(2000);
    expect(
      calculateBarScrollEnd({ ...bar, barTop: 1500, stickyOffset: 100 }),
    ).toBe(1384);
  });
});
