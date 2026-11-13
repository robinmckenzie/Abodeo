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
  function readPath(cookie: string) {
    return cookie.match(/; Path=([^;]*)/)?.[1] ?? "";
  }

  // The browser's rule: the cookie goes with a request whose path is the
  // cookie's path or lies below it.
  function isSentTo(cookiePath: string, requestPath: string) {
    return (
      requestPath === cookiePath ||
      requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`)
    );
  }

  it("keeps the word for a year and out of scripts' reach", () => {
    expect(formatVisitorWordCookie("qwertyui", false)).toBe(
      "abodeo_visitor=qwertyui; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(formatVisitorWordCookie("qwertyui", true)).toMatch(/; Secure$/);
  });

  it("is sent to /demo, where the word is read, as well as to /api", () => {
    const path = readPath(formatVisitorWordCookie("qwertyui", false));
    expect(isSentTo(path, "/demo")).toBe(true);
    expect(isSentTo(path, "/api/account/activity")).toBe(true);
  });
});
