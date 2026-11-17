import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeSeed,
  seedFailedMessage,
  seedTooLargeMessage,
  useDemoSeed,
} from "./use-demo-seed";

afterEach(() => vi.unstubAllGlobals());

const savedSeed = {
  savedAt: "2026-11-13T10:00:00.000Z",
  projectCount: 2,
  peopleCount: 3,
  imageCount: 4,
  appointmentCount: 0,
};

function stubFetch(
  status: { canSave: boolean; seed: typeof savedSeed | null },
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
    const fetchMock = stubFetch({ canSave: false, seed: null });
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.canSave).toBe(false);
  });

  it("shows what the saved seed holds when the panel opens", async () => {
    stubFetch({ canSave: true, seed: savedSeed });
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(result.current.seed).toEqual(savedSeed));
  });

  it("saves, then shows what the new seed holds", async () => {
    const fetchMock = stubFetch({ canSave: true, seed: null }, savedSeed);
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(result.current.seed).toEqual(savedSeed);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/seed",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("says so when saving fails", async () => {
    stubFetch({ canSave: true, seed: null });
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
          : new Response(JSON.stringify({ canSave: true, seed: null })),
      ),
    );
    const { result } = renderHook(() => useDemoSeed(async () => true));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(result.current.message).toBe(seedTooLargeMessage);
  });

  it("does not save when the page is not ready to be left", async () => {
    const fetchMock = stubFetch({ canSave: true, seed: null });
    const { result } = renderHook(() => useDemoSeed(async () => false));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(() => result.current.save());
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });
});

describe("describeSeed", () => {
  it("says what the seed holds, so that a save with no appointments shows", () => {
    expect(describeSeed(savedSeed)).toContain(
      ": 2 projects, 3 people, 4 images, 0 appointments.",
    );
    expect(
      describeSeed({
        ...savedSeed,
        projectCount: 1,
        peopleCount: 1,
        imageCount: 1,
        appointmentCount: 1,
      }),
    ).toContain(": 1 project, 1 person, 1 image, 1 appointment.");
  });
});
