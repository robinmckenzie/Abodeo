// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readLabel } from "./usage-label.server";

function headersWith(cookie?: string) {
  return new Headers(cookie === undefined ? {} : { Cookie: cookie });
}

describe("readLabel", () => {
  it("reads the label among other cookies", () => {
    expect(
      readLabel(headersWith("a=1; abodeo_label=Andrew%20B; session=x")),
    ).toBe("Andrew B");
  });

  it("gives an empty label with no cookie or headers", () => {
    expect(readLabel(headersWith())).toBe("");
    expect(readLabel(headersWith("a=1"))).toBe("");
    expect(readLabel(undefined)).toBe("");
  });

  it("gives an empty label for an invalid one", () => {
    expect(readLabel(headersWith(`abodeo_label=${"a".repeat(31)}`))).toBe("");
    expect(readLabel(headersWith("abodeo_label=a%3Cb"))).toBe("");
    expect(readLabel(headersWith("abodeo_label="))).toBe("");
  });

  it("does not throw on malformed percent-encoding", () => {
    expect(readLabel(headersWith("abodeo_label=%E0%A4%A"))).toBe("");
  });

  it("ignores a cookie whose name only ends the same way", () => {
    expect(readLabel(headersWith("x_abodeo_label=Andrew"))).toBe("");
  });
});
