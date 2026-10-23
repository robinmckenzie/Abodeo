import { describe, expect, it } from "vitest";

import { areAllTypesUnsupported, describeFileSize } from "./image-messages";

describe("describeFileSize", () => {
  it("uses bytes, KB or MB", () => {
    expect(describeFileSize(0)).toBe("0 B");
    expect(describeFileSize(1023)).toBe("1023 B");
    expect(describeFileSize(230 * 1024)).toBe("230 KB");
    expect(describeFileSize(1.44 * 1024 * 1024)).toBe("1.4 MB");
  });
});

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
