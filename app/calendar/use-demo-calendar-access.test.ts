import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accessNotStoredMessage,
  useDemoCalendarAccess,
} from "./use-demo-calendar-access";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(savedAt: string | null, start?: { url: string }) {
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(JSON.stringify(start ?? {}), {
          status: start ? 200 : 403,
        })
      : new Response(JSON.stringify({ savedAt })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useDemoCalendarAccess", () => {
  it("shows when access was stored", async () => {
    stubFetch("2026-11-13T10:00:00.000Z");
    const { result } = renderHook(() =>
      useDemoCalendarAccess(async () => true, vi.fn()),
    );
    await waitFor(() =>
      expect(result.current.savedAt).toBe("2026-11-13T10:00:00.000Z"),
    );
  });

  it("leaves for Google's address to store access", async () => {
    const fetchMock = stubFetch(null, { url: "https://accounts.google.com/x" });
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useDemoCalendarAccess(async () => true, navigate),
    );
    await act(() => result.current.store());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/calendar/demo-access",
      expect.objectContaining({ method: "POST" }),
    );
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/x");
    expect(result.current.message).toBeNull();
  });

  it("says so when the grant cannot start, and stays", async () => {
    stubFetch(null);
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useDemoCalendarAccess(async () => true, navigate),
    );
    await act(() => result.current.store());

    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.message).toBe(accessNotStoredMessage);
  });

  it("does not leave when the page is not ready to be left", async () => {
    const fetchMock = stubFetch(null, { url: "https://accounts.google.com/x" });
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useDemoCalendarAccess(async () => false, navigate),
    );
    await act(() => result.current.store());

    expect(navigate).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });
});
