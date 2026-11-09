import { describe, expect, it } from "vitest";

import {
  loadImages,
  loadTaskImageSummaries,
  removeTaskImages,
  uploadImage,
} from "./images-client";
import { accountHeader } from "./projects-api";

const image = {
  id: "one",
  createdAt: "2026-10-22T10:00:00.000001Z",
  contentType: "image/png",
  originalSize: 8,
  caption: "",
};

// Answers every request with the body and status given, recording each.
function createFetch(body: unknown, status = 200) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

describe("a task's photos (AD #67 Add Photos To Tasks)", () => {
  it("are listed and added on the task's path, and project images on the project's", async () => {
    const page = {
      images: [image],
      hasOlder: false,
      usedBytes: 1,
      limitBytes: 2,
    };
    const { fetchFn, requests } = createFetch(page);
    await loadImages("ada", "shed", null, fetchFn);
    await loadImages("ada", "shed", null, fetchFn, "t1");
    await loadImages("ada", "shed", image as never, fetchFn, "t1");
    expect(requests.map(({ url }) => url.split("?")[0])).toEqual([
      "/api/projects/shed/images",
      "/api/projects/shed/tasks/t1/images",
      "/api/projects/shed/tasks/t1/images",
    ]);
    expect(requests[2].url).toContain("?before=");

    const uploaded = createFetch({ image, usedBytes: 13 });
    const result = await uploadImage(
      "ada",
      "shed",
      "one",
      new Uint8Array([1]),
      new Uint8Array([2]),
      uploaded.fetchFn,
      "t1",
    );
    expect(result).toMatchObject({ ok: true, usedBytes: 13 });
    expect(uploaded.requests[0].url).toBe("/api/projects/shed/tasks/t1/images");
    expect(uploaded.requests[0].init.method).toBe("POST");
  });

  it("are counted per task, naming the account the page is working for", async () => {
    const tasks = { t1: { count: 2, latestImageId: "b" } };
    const { fetchFn, requests } = createFetch({ tasks });
    expect(await loadTaskImageSummaries("ada", "shed", fetchFn)).toEqual({
      ok: true,
      tasks,
    });
    expect(requests[0].url).toBe("/api/projects/shed/task-images");
    expect(
      (requests[0].init.headers as Record<string, string>)[accountHeader],
    ).toBe("ada");
  });

  it("treat a summary of the wrong shape as unreachable", async () => {
    for (const body of [{}, { tasks: [] }, { tasks: { t1: { count: "2" } } }]) {
      const { fetchFn } = createFetch(body);
      expect(await loadTaskImageSummaries("ada", "shed", fetchFn)).toEqual({
        ok: false,
        reason: "unreachable",
      });
    }
  });

  it("are removed for a deleted task, and kept with a conflict for one saved again", async () => {
    const removed = createFetch({ usedBytes: 0 });
    expect(
      await removeTaskImages("ada", "shed", "t1", removed.fetchFn),
    ).toEqual({ ok: true, usedBytes: 0 });
    expect(removed.requests[0].init.method).toBe("DELETE");
    expect(removed.requests[0].url).toBe("/api/projects/shed/tasks/t1/images");

    const kept = createFetch({ error: "conflict" }, 409);
    expect(await removeTaskImages("ada", "shed", "t1", kept.fetchFn)).toEqual({
      ok: false,
      reason: "conflict",
    });
  });
});
