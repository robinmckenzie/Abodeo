import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskImageSummaries } from "./use-task-image-summaries";

let revoked: string[] = [];

beforeEach(() => {
  revoked = [];
  let made = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${made++}`);
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
});

afterEach(cleanup);

// Answers the summary with two tasks' photos, and any thumbnail with bytes.
const fakeFetch = () =>
  vi.fn<typeof fetch>(async (path) =>
    String(path).endsWith("/task-images")
      ? Response.json({
          tasks: {
            t1: { count: 2, latestImageId: "i2" },
            t2: { count: 1, latestImageId: "i5" },
          },
        })
      : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  );

describe("useTaskImageSummaries (AD #67)", () => {
  it("gives each task's count, total and newest thumbnail", async () => {
    const fetchFn = fakeFetch();
    const { result } = renderHook(() =>
      useTaskImageSummaries("ada", "p1", undefined, fetchFn),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.thumbnails)).toHaveLength(2),
    );
    expect(result.current.summaries.t1).toEqual({
      count: 2,
      latestImageId: "i2",
    });
    expect(result.current.total).toBe(3);
    expect(fetchFn.mock.calls.map(([path]) => path).sort()).toEqual([
      "/api/projects/p1/images/i2/thumbnail",
      "/api/projects/p1/images/i5/thumbnail",
      "/api/projects/p1/task-images",
    ]);
  });

  it("takes what a task's photos dialog reports, and forgets a task", async () => {
    const fetchFn = fakeFetch();
    const { result } = renderHook(() =>
      useTaskImageSummaries("ada", "p1", undefined, fetchFn),
    );
    await waitFor(() => expect(result.current.total).toBe(3));
    act(() => result.current.report("t3", 1, "i9"));
    expect(result.current.total).toBe(4);
    await waitFor(() => expect(result.current.thumbnails.t3).toBeDefined());
    act(() => result.current.report("t1", 0, null));
    act(() => result.current.forget("t2"));
    expect(Object.keys(result.current.summaries)).toEqual(["t3"]);
    expect(result.current.total).toBe(1);
  });

  it("fetches nothing signed out, and lets everything go on a change of account", async () => {
    const fetchFn = fakeFetch();
    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useTaskImageSummaries(accountId, "p1", undefined, fetchFn),
      { initialProps: { accountId: null as string | null } },
    );
    expect(result.current.total).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();

    rerender({ accountId: "ada" });
    await waitFor(() =>
      expect(Object.keys(result.current.thumbnails)).toHaveLength(2),
    );
    rerender({ accountId: "cy" });
    expect(result.current.summaries).toEqual({});
    expect(result.current.thumbnails).toEqual({});
    expect(revoked).toHaveLength(2);
  });
});
