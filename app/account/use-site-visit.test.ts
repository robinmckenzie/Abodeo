import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reportVisitOnce,
  useSiteVisit,
  visitReportedKey,
} from "./use-site-visit";

function createStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("reportVisitOnce", () => {
  it("reports the first visit of a tab, without welcome", () => {
    const report = vi.fn(async () => {});
    reportVisitOnce("", createStorage(), report);
    expect(report).toHaveBeenCalledWith(false);
  });

  it("says when the address asks for the welcome screen", () => {
    const report = vi.fn(async () => {});
    reportVisitOnce("?welcome", createStorage(), report);
    expect(report).toHaveBeenCalledWith(true);
  });

  it("does not report again in the same tab", () => {
    const report = vi.fn(async () => {});
    const storage = createStorage();
    reportVisitOnce("", storage, report);
    reportVisitOnce("", storage, report);
    expect(report).toHaveBeenCalledOnce();
    expect(storage.getItem(visitReportedKey)).toBe("1");
  });

  it("still reports when storage is blocked", () => {
    const report = vi.fn(async () => {});
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    reportVisitOnce("", blocked, report);
    expect(report).toHaveBeenCalledOnce();
  });

  it("drops a failed report", async () => {
    const report = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(() => reportVisitOnce("", createStorage(), report)).not.toThrow();
    await Promise.resolve();
  });
});

describe("useSiteVisit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("reports one visit to /api/visit when the app opens", () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchFn);
    window.history.replaceState(null, "", "/?welcome");

    renderHook(() => useSiteVisit());
    renderHook(() => useSiteVisit());

    expect(fetchFn).toHaveBeenCalledOnce();
    const [path, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe("/api/visit");
    expect(JSON.parse(init.body as string)).toEqual({ welcome: true });
  });
});
