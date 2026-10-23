import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLabelRequest, useUsageLabel } from "./use-usage-label";

describe("applyLabelRequest", () => {
  const http = { protocol: "http:" };

  it("sets the cookie for a valid label", () => {
    const setCookie = vi.fn();
    expect(
      applyLabelRequest({ ...http, search: "?label=Andrew" }, setCookie),
    ).toBe(true);
    expect(setCookie).toHaveBeenCalledWith(
      "abodeo_label=Andrew; Max-Age=31536000; Path=/api; SameSite=Lax",
    );
  });

  it("clears the cookie for PUBLIC", () => {
    const setCookie = vi.fn();
    applyLabelRequest({ ...http, search: "?label=public" }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      "abodeo_label=; Max-Age=0; Path=/api; SameSite=Lax",
    );
  });

  it("marks the cookie Secure on https", () => {
    const setCookie = vi.fn();
    applyLabelRequest(
      { protocol: "https:", search: "?label=Andrew" },
      setCookie,
    );
    expect(setCookie.mock.calls[0][0]).toMatch(/; Secure$/);
  });

  it("keeps the previous label for an invalid or empty one", () => {
    const setCookie = vi.fn();
    expect(applyLabelRequest({ ...http, search: "?label=" }, setCookie)).toBe(
      false,
    );
    expect(
      applyLabelRequest({ ...http, search: "?label=a%3Cb" }, setCookie),
    ).toBe(false);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("carries on when the cookie cannot be written", () => {
    const setCookie = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(() =>
      applyLabelRequest({ ...http, search: "?label=Andrew" }, setCookie),
    ).not.toThrow();
  });
});

describe("useUsageLabel", () => {
  afterEach(() => {
    document.cookie = "abodeo_label=; Max-Age=0; Path=/api";
    window.history.replaceState(null, "", "/");
  });

  it("removes label from the address and keeps other parameters", () => {
    window.history.replaceState(null, "", "/?label=Andrew&x=1#top");
    renderHook(() => useUsageLabel());
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#top");
  });

  it("removes an invalid label from the address", () => {
    window.history.replaceState(null, "", "/?label=");
    renderHook(() => useUsageLabel());
    expect(window.location.search).toBe("");
  });

  it("leaves an address without a label alone", () => {
    window.history.replaceState(null, "", "/?x=1");
    renderHook(() => useUsageLabel());
    expect(window.location.search).toBe("?x=1");
  });
});
