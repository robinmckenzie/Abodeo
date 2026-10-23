import { describe, expect, it } from "vitest";

import { areAllTypesUnsupported } from "./image-messages";

describe("areAllTypesUnsupported", () => {
  it("is true only when every file is known to be neither a JPEG nor a PNG", () => {
    expect(areAllTypesUnsupported(["text/plain"])).toBe(true);
    expect(
      areAllTypesUnsupported(["application/x-msdownload", "image/gif"]),
    ).toBe(true);
    expect(areAllTypesUnsupported(["text/plain", "image/png"])).toBe(false);
    expect(areAllTypesUnsupported(["text/plain", ""])).toBe(false);
    expect(areAllTypesUnsupported([""])).toBe(false);
    expect(areAllTypesUnsupported([])).toBe(false);
  });
});
