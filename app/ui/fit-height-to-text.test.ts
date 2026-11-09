import { describe, expect, it } from "vitest";

import { fitHeightToText } from "./fit-height-to-text";

// jsdom has no layout, so the box's measurements are stood in for.
function createMeasuredBox({
  offsetHeight,
  clientHeight,
  scrollHeight,
}: {
  offsetHeight: number;
  clientHeight: number;
  scrollHeight: number;
}) {
  const box = document.createElement("textarea");
  Object.defineProperty(box, "offsetHeight", { value: offsetHeight });
  Object.defineProperty(box, "clientHeight", { value: clientHeight });
  Object.defineProperty(box, "scrollHeight", { value: scrollHeight });
  return box;
}

describe("fitHeightToText", () => {
  it("sets the height to the text's height plus the borders", () => {
    const box = createMeasuredBox({
      offsetHeight: 42,
      clientHeight: 40,
      scrollHeight: 96,
    });
    box.style.height = "20px";
    fitHeightToText(box);
    expect(box.style.height).toBe("98px");
  });

  it("measures with the height reset, so that the box can shrink", () => {
    const box = document.createElement("textarea");
    let heightWhenMeasured = "";
    Object.defineProperty(box, "scrollHeight", {
      get() {
        heightWhenMeasured = box.style.height;
        return 30;
      },
    });
    box.style.height = "200px";
    fitHeightToText(box);
    expect(heightWhenMeasured).toBe("auto");
    expect(box.style.height).toBe("30px");
  });
});
