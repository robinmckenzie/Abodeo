// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normaliseLabel } from "./usage-label";
import {
  formatVisitorWordCookie,
  makeVisitorWord,
  readVisitorWord,
} from "./visitor-word.server";

const headersWith = (cookie?: string) =>
  new Headers(cookie ? { Cookie: cookie } : {});

describe("makeVisitorWord", () => {
  it("makes eight lower-case letters that are also a valid label", () => {
    const word = makeVisitorWord();
    expect(word).toMatch(/^[a-z]{8}$/);
    expect(normaliseLabel(word)).toBe(word);
  });

  it("makes a different word each time", () => {
    expect(makeVisitorWord()).not.toBe(makeVisitorWord());
  });
});

describe("readVisitorWord", () => {
  it("reads the word from the Cookie header", () => {
    expect(readVisitorWord(headersWith("a=1; abodeo_visitor=qwertyui"))).toBe(
      "qwertyui",
    );
  });

  it("gives an empty word when absent or not a word", () => {
    expect(readVisitorWord(headersWith())).toBe("");
    expect(readVisitorWord(undefined)).toBe("");
    expect(readVisitorWord(headersWith("abodeo_visitor=Qwerty1!"))).toBe("");
    expect(readVisitorWord(headersWith("x_abodeo_visitor=qwertyui"))).toBe("");
  });
});

describe("formatVisitorWordCookie", () => {
  it("keeps the word for a year, for /api only and out of scripts' reach", () => {
    expect(formatVisitorWordCookie("qwertyui", false)).toBe(
      "abodeo_visitor=qwertyui; Max-Age=31536000; Path=/api; HttpOnly; SameSite=Lax",
    );
    expect(formatVisitorWordCookie("qwertyui", true)).toMatch(/; Secure$/);
  });
});
