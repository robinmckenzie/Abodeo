import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  seedFailedMessage,
  seedTooLargeMessage,
  useDemoSeed,
} from "./use-demo-seed";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(
  status: { canSave: boolean; savedAt: string | null },
  put?: unknown,
) {
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === "PUT"
      ? new Response(JSON.stringify(put), { status: put ? 200 : 503 })
      : new Response(JSON.stringify(status)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useDemoSeed", () => {
  it("shows the control only when the server says it can save", async () => {
    const fetchMock = stubFetch({ canSave: false, savedAt: null });
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.canSave).toBe(false);
  });

  it("saves, then shows the new time", async () => {
    const fetchMock = stubFetch(
      { canSave: true, savedAt: null },
      {
        savedAt: "2026-11-13T10:00:00.000Z",
        projectCount: 2,
        peopleCount: 3,
        imageCount: 4,
      },
    );
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(result.current.savedAt).toBe("2026-11-13T10:00:00.000Z");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/seed",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("says so when saving fails", async () => {
    stubFetch({ canSave: true, savedAt: null });
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(result.current.message).toBe(seedFailedMessage);
  });

  it("says so when the images are too big", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? new Response("{}", { status: 413 })
          : new Response(JSON.stringify({ canSave: true, savedAt: null })),
      ),
    );
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(result.current.message).toBe(seedTooLargeMessage);
  });

  it("does not save when the page is not ready to be left", async () => {
    const fetchMock = stubFetch({ canSave: true, savedAt: null });
    const { result } = renderHook(() => useDemoSeed(async () => false));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });
});
