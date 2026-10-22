import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBarThumbnails } from "./use-bar-thumbnails";

let revoked: string[] = [];

beforeEach(() => {
  revoked = [];
  let made = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${made++}`);
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
});

afterEach(cleanup);

const answerWithImage = () =>
  vi.fn<typeof fetch>(
    async () => new Response(new Blob(["x"]), { status: 200 }),
  );

describe("useBarThumbnails (AD #48)", () => {
  it("fetches each project's newest thumbnail once, and gives its blob URL", async () => {
    const fetchFn = answerWithImage();
    const { result, rerender } = renderHook(
      ({ ids }) => useBarThumbnails("ada", ids, undefined, fetchFn),
      { initialProps: { ids: { p1: "i1", p2: "i9" } } },
    );
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2));
    expect(result.current.p1).toMatch(/^blob:/);
    expect(fetchFn.mock.calls.map(([path]) => path)).toEqual([
      "/api/projects/p1/images/i1/thumbnail",
      "/api/projects/p2/images/i9/thumbnail",
    ]);

    rerender({ ids: { p1: "i1", p2: "i10" } });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3));
    expect(fetchFn.mock.calls[2][0]).toBe(
      "/api/projects/p2/images/i10/thumbnail",
    );
  });

  it("shows no thumbnail for a project whose newest image was removed", async () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useBarThumbnails("ada", ids, undefined, answerWithImage()),
      { initialProps: { ids: { p1: "i1" } as Record<string, string> } },
    );
    await waitFor(() => expect(result.current.p1).toBeDefined());
    rerender({ ids: {} });
    expect(result.current).toEqual({});
  });

  it("lets the blob URLs go when unmounted, and fetches nothing signed out", async () => {
    const fetchFn = answerWithImage();
    const signedOut = renderHook(() =>
      useBarThumbnails(null, { p1: "i1" }, undefined, fetchFn),
    );
    expect(signedOut.result.current).toEqual({});
    expect(fetchFn).not.toHaveBeenCalled();

    const { result, unmount } = renderHook(() =>
      useBarThumbnails("ada", { p1: "i1" }, undefined, fetchFn),
    );
    await waitFor(() => expect(result.current.p1).toBeDefined());
    const url = result.current.p1;
    unmount();
    expect(revoked).toContain(url);
  });
});
