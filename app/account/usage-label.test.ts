import { describe, expect, it } from "vitest";

import {
  formatLabelCookie,
  normaliseLabel,
  readLabelRequest,
} from "./usage-label";

describe("normaliseLabel", () => {
  it("trims and accepts letters, digits, space, hyphen, apostrophe and full stop", () => {
    expect(normaliseLabel("  Andrew  ")).toBe("Andrew");
    expect(normaliseLabel("Zoë O'Neil-Smith Jr. 2")).toBe(
      "Zoë O'Neil-Smith Jr. 2",
    );
    expect(normaliseLabel("李雷")).toBe("李雷");
  });

  it("accepts 30 characters and refuses 31", () => {
    expect(normaliseLabel("a".repeat(30))).toBe("a".repeat(30));
    expect(normaliseLabel("a".repeat(31))).toBeUndefined();
  });

  it("refuses empty, blank, other characters and non-text", () => {
    expect(normaliseLabel("")).toBeUndefined();
    expect(normaliseLabel("   ")).toBeUndefined();
    expect(normaliseLabel("a<b")).toBeUndefined();
    expect(normaliseLabel("a;b")).toBeUndefined();
    expect(normaliseLabel("a\nb")).toBeUndefined();
    expect(normaliseLabel(null)).toBeUndefined();
    expect(normaliseLabel(5)).toBeUndefined();
  });
});

describe("readLabelRequest", () => {
  it("sets a valid label", () => {
    expect(readLabelRequest("?label=Andrew%20B")).toEqual({
      kind: "set",
      label: "Andrew B",
    });
  });

  it("clears on PUBLIC in any case", () => {
    for (const word of ["PUBLIC", "public", "Public"]) {
      expect(readLabelRequest(`?label=${word}`)).toEqual({ kind: "clear" });
    }
  });

  it("asks for nothing without a label, or with an empty or invalid one", () => {
    expect(readLabelRequest("")).toEqual({ kind: "none" });
    expect(readLabelRequest("?other=1")).toEqual({ kind: "none" });
    expect(readLabelRequest("?label=")).toEqual({ kind: "none" });
    expect(readLabelRequest("?label=a%3Cb")).toEqual({ kind: "none" });
    expect(readLabelRequest(`?label=${"a".repeat(31)}`)).toEqual({
      kind: "none",
    });
  });
});

describe("formatLabelCookie", () => {
  it("keeps a label for a year on /api", () => {
    expect(formatLabelCookie("Andrew B", false)).toBe(
      "abodeo_label=Andrew%20B; Max-Age=31536000; Path=/api; SameSite=Lax",
    );
  });

  it("adds Secure on https", () => {
    expect(formatLabelCookie("Andrew", true)).toMatch(/; Secure$/);
  });

  it("expires the cookie to clear it", () => {
    expect(formatLabelCookie(null, false)).toBe(
      "abodeo_label=; Max-Age=0; Path=/api; SameSite=Lax",
    );
  });
});
