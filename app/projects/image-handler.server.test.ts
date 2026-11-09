// @vitest-environment node
import { describe, expect, it } from "vitest";

import { handleImagesRequest, isImagesPath } from "./image-handler.server";
import {
  accountImageBytes,
  buildImageBytesPath,
  buildImagePath,
  buildImagesPath,
  buildTaskImageSummaryPath,
  buildTaskImagesPath,
  buildUploadFrame,
  imageIdHeader,
  listPageSize,
  maxCaptionLength,
  maxImageBytes,
  maxThumbnailBytes,
  maxUploadBytes,
  type ImageInfo,
} from "./images-api";
import { accountHeader } from "./projects-api";
import { createMemoryImageStore } from "./test-image-store.server";
import { gifBytes, makeJpeg, makePng } from "./test-images";

const baseUrl = "http://localhost:5173";

// The session cookie is simply the account's id.
const readSessionUserId = async (headers: Headers) =>
  headers.get("cookie") ?? undefined;

function createHandler(
  overrides: Partial<Parameters<typeof handleImagesRequest>[1]> = {},
  storeOptions: Parameters<typeof createMemoryImageStore>[0] = {},
) {
  const memory = createMemoryImageStore(storeOptions);
  const handle = (request: Request) =>
    handleImagesRequest(request, {
      readSessionUserId,
      store: memory.store,
      reportFailure: () => {},
      ...overrides,
    });
  return { ...memory, handle };
}

type Options = {
  account?: string | null;
  pageAccount?: string | null;
  method?: string;
  body?: BodyInit;
  contentType?: string | null;
  origin?: string;
  headers?: Record<string, string>;
};

function request(
  path: string,
  {
    account = "ada",
    pageAccount = account,
    method = "GET",
    body,
    contentType,
    origin,
    headers = {},
  }: Options = {},
) {
  const all: Record<string, string> = { ...headers };
  if (account) all.cookie = account;
  if (pageAccount) all[accountHeader] = pageAccount;
  if (contentType) all["Content-Type"] = contentType;
  if (origin) all.Origin = origin;
  return new Request(`${baseUrl}${path}`, { method, headers: all, body });
}

const png = makePng();
const jpegThumbnail = makeJpeg();

function upload(
  projectId: string,
  imageId: string,
  options: Options & { original?: Uint8Array; thumbnail?: Uint8Array } = {},
) {
  const { original = png, thumbnail = jpegThumbnail, ...rest } = options;
  return request(buildImagesPath(projectId), {
    method: "POST",
    body: buildUploadFrame(thumbnail, original),
    contentType: "application/octet-stream",
    ...rest,
    headers: { [imageIdHeader]: imageId, ...rest.headers },
  });
}

function caption(
  projectId: string,
  imageId: string,
  body: unknown,
  options: Options = {},
) {
  return request(buildImagePath(projectId, imageId), {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    contentType: "application/json",
    ...options,
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("routing", () => {
  it("recognises only image paths", () => {
    expect(isImagesPath("/api/projects/shed/images")).toBe(true);
    expect(isImagesPath("/api/projects/shed/images/one/original")).toBe(true);
    expect(isImagesPath("/api/projects/shed")).toBe(false);
    expect(isImagesPath("/api/projects/images")).toBe(false);
    expect(isImagesPath("/api/projects/import")).toBe(false);
  });

  it("recognises a task's photo paths (AD #67), so the projects handler never answers them", () => {
    expect(isImagesPath("/api/projects/shed/tasks/t1/images")).toBe(true);
    expect(isImagesPath("/api/projects/shed/task-images")).toBe(true);
    expect(isImagesPath("/api/projects/shed/tasks")).toBe(false);
    expect(isImagesPath("/api/projects/shed/tasks/t1")).toBe(false);
  });

  it("refuses the wrong method and unknown paths", async () => {
    const { handle } = createHandler();
    expect(
      (await handle(request(buildImagesPath("shed"), { method: "PUT" })))
        .status,
    ).toBe(405);
    expect((await handle(request(buildImagePath("shed", "one")))).status).toBe(
      405,
    );
    expect(
      (await handle(request(`${buildImagePath("shed", "one")}/secret`))).status,
    ).toBe(404);
    expect(
      (await handle(request(`${buildImagePath("shed", "one")}/original/x`)))
        .status,
    ).toBe(404);
    expect(
      (await handle(request(buildImageBytesPath("sh%ed", "one", "original"))))
        .status,
    ).toBe(404);
  });
});

describe("who is asking", () => {
  const routes: [string, () => Request][] = [
    [
      "list",
      () =>
        request(buildImagesPath("shed"), { account: null, pageAccount: "ada" }),
    ],
    [
      "upload",
      () => upload("shed", "one", { account: null, pageAccount: "ada" }),
    ],
    [
      "thumbnail",
      () =>
        request(buildImageBytesPath("shed", "one", "thumbnail"), {
          account: null,
          pageAccount: "ada",
        }),
    ],
    [
      "original",
      () =>
        request(buildImageBytesPath("shed", "one", "original"), {
          account: null,
          pageAccount: "ada",
        }),
    ],
    [
      "caption",
      () =>
        caption(
          "shed",
          "one",
          { base: "", caption: "x" },
          { account: null, pageAccount: "ada" },
        ),
    ],
    [
      "remove",
      () =>
        request(buildImagePath("shed", "one"), {
          method: "DELETE",
          account: null,
          pageAccount: "ada",
        }),
    ],
  ];

  it.each(routes)("refuses %s without a sign-in", async (_name, build) => {
    const { handle, calls } = createHandler();
    const response = await handle(build());
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "not_signed_in" });
    expect(calls).toEqual([]);
  });

  it("refuses a request that does not name the account, or names another", async () => {
    const { handle, calls, accounts } = createHandler();
    expect(
      (await handle(request(buildImagesPath("shed"), { pageAccount: null })))
        .status,
    ).toBe(400);
    const response = await handle(
      upload("shed", "one", { pageAccount: "bob" }),
    );
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: "account_changed" });
    expect(calls).toEqual([]);
    expect(accounts.size).toBe(0);
  });

  it("takes the account from the sign-in alone", async () => {
    const { handle, calls } = createHandler();
    await handle(upload("shed", "one", { account: "ada" }));
    await handle(request(buildImagesPath("shed"), { account: "ada" }));
    expect(new Set(calls)).toEqual(new Set(["ada"]));
  });

  it("keeps two accounts with a project of the same id apart", async () => {
    const { handle } = createHandler();
    expect((await handle(upload("shed", "one"))).status).toBe(200);
    const asBob = (path: string, options: Options = {}) =>
      request(path, { account: "bob", ...options });
    const list = await json(await handle(asBob(buildImagesPath("shed"))));
    expect(list.images).toEqual([]);
    for (const kind of ["original", "thumbnail"] as const) {
      expect(
        (await handle(asBob(buildImageBytesPath("shed", "one", kind)))).status,
      ).toBe(404);
    }
    expect(
      (
        await handle(
          caption(
            "shed",
            "one",
            { base: "", caption: "mine" },
            { account: "bob" },
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      (await handle(asBob(buildImagePath("shed", "one"), { method: "DELETE" })))
        .status,
    ).toBe(404);
    const ada = await json(await handle(request(buildImagesPath("shed"))));
    expect((ada.images as ImageInfo[])[0]).toMatchObject({
      id: "one",
      caption: "",
    });
  });
});

describe("cross-site requests", () => {
  it("refuses a write that says it comes from another site", async () => {
    const { handle, accounts } = createHandler();
    const response = await handle(
      upload("shed", "one", { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(accounts.size).toBe(0);
    expect(
      (
        await handle(
          request(buildImagePath("shed", "one"), {
            method: "DELETE",
            origin: "https://evil.example",
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("accepts a write from its own site", async () => {
    const { handle } = createHandler();
    expect(
      (await handle(upload("shed", "one", { origin: baseUrl }))).status,
    ).toBe(200);
  });

  it("refuses an upload or a caption of the wrong content type", async () => {
    const { handle } = createHandler();
    expect(
      (await handle(upload("shed", "one", { contentType: "text/plain" })))
        .status,
    ).toBe(400);
    expect(
      (await handle(upload("shed", "one", { contentType: "image/png" })))
        .status,
    ).toBe(400);
    expect(
      (await handle(caption("shed", "one", "", { contentType: "text/plain" })))
        .status,
    ).toBe(400);
  });
});

describe("uploading", () => {
  it("adds a PNG and a JPEG and gives them back as stored", async () => {
    const { handle } = createHandler();
    const response = await handle(upload("shed", "one"));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      image: { id: "one", contentType: "image/png", caption: "" },
      usedBytes: png.length + jpegThumbnail.length,
    });
    const jpeg = makeJpeg(1000);
    expect(
      (await handle(upload("shed", "two", { original: jpeg }))).status,
    ).toBe(200);

    const original = await handle(
      request(buildImageBytesPath("shed", "one", "original")),
    );
    expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from(png));
    expect(original.headers.get("Content-Type")).toBe("image/png");
    const thumbnail = await handle(
      request(buildImageBytesPath("shed", "one", "thumbnail")),
    );
    expect(thumbnail.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Buffer.from(await thumbnail.arrayBuffer())).toEqual(
      Buffer.from(jpegThumbnail),
    );
  });

  it("stores a JPEG with data after its end unchanged (AD #53)", async () => {
    const { handle } = createHandler();
    const jpeg = Uint8Array.from([...makeJpeg(1000), ...makeJpeg(400), 1, 2]);
    const response = await handle(upload("shed", "phone", { original: jpeg }));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      image: { id: "phone", contentType: "image/jpeg" },
      usedBytes: jpeg.length + jpegThumbnail.length,
    });
    const original = await handle(
      request(buildImageBytesPath("shed", "phone", "original")),
    );
    expect(Buffer.from(await original.arrayBuffer())).toEqual(
      Buffer.from(jpeg),
    );
  });

  it("accepts an image of exactly 4 MiB with a thumbnail of exactly 100 KB", async () => {
    const { handle } = createHandler();
    const original = makePng(maxImageBytes);
    const thumbnail = makeJpeg(maxThumbnailBytes);
    const response = await handle(
      upload("shed", "big", { original, thumbnail }),
    );
    expect(response.status).toBe(200);
    const back = await handle(
      request(buildImageBytesPath("shed", "big", "original")),
    );
    expect(
      Buffer.from(await back.arrayBuffer()).equals(Buffer.from(original)),
    ).toBe(true);
  });

  it("keeps the largest request below Vercel's body limit", () => {
    expect(maxUploadBytes).toBe(4 + maxThumbnailBytes + maxImageBytes);
    expect(maxUploadBytes).toBeLessThan(4_500_000);
  });

  it("refuses an image 1 byte over 4 MiB, and a thumbnail 1 byte over 100 KB", async () => {
    const { handle, accounts } = createHandler();
    const tooBig = await handle(
      upload("shed", "big", { original: makeJpeg(maxImageBytes + 1) }),
    );
    expect(tooBig.status).toBe(413);
    expect(await json(tooBig)).toEqual({ error: "too_large" });
    const thumbnail = await handle(
      upload("shed", "big", { thumbnail: makeJpeg(maxThumbnailBytes + 1) }),
    );
    expect(thumbnail.status).toBe(413);
    expect(await json(thumbnail)).toEqual({ error: "thumbnail_too_large" });
    expect(accounts.get("ada") ?? []).toEqual([]);
  });

  it("stops reading a body that is longer than allowed, whatever its declared length", async () => {
    const { handle } = createHandler();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1_000_000;
        controller.enqueue(new Uint8Array(1_000_000));
        if (pulled > 20_000_000) controller.close();
      },
    });
    const response = await handle(
      new Request(`${baseUrl}${buildImagesPath("shed")}`, {
        method: "POST",
        headers: {
          cookie: "ada",
          [accountHeader]: "ada",
          [imageIdHeader]: "one",
          "Content-Type": "application/octet-stream",
        },
        body,
        // @ts-expect-error Node needs this for a streamed body.
        duplex: "half",
      }),
    );
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(10_000_000);
  });

  it("refuses files that are not sound JPEGs or PNGs, by their content", async () => {
    const { handle, accounts } = createHandler();
    const damaged = png.slice();
    damaged[20] ^= 0xff;
    const cases = [
      gifBytes,
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      png.subarray(0, png.length - 4),
      damaged,
      makeJpeg().subarray(0, 20),
    ];
    for (const original of cases) {
      const response = await handle(upload("shed", "one", { original }));
      expect(response.status).toBe(415);
      expect(await json(response)).toEqual({ error: "unsupported_format" });
    }
    // A thumbnail must be a JPEG.
    expect(
      (await handle(upload("shed", "one", { thumbnail: png }))).status,
    ).toBe(415);
    expect(accounts.get("ada") ?? []).toEqual([]);
  });

  it("refuses bodies that are not a frame, and a missing or bad image id", async () => {
    const { handle } = createHandler();
    const post = (body: BodyInit, id: string | null = "one") =>
      request(buildImagesPath("shed"), {
        method: "POST",
        body,
        contentType: "application/octet-stream",
        headers: id === null ? {} : { [imageIdHeader]: id },
      });
    expect((await handle(post(new Uint8Array(0)))).status).toBe(400);
    expect((await handle(post(new Uint8Array([0, 0, 1, 0, 1])))).status).toBe(
      400,
    );
    expect(
      (await handle(post(buildUploadFrame(new Uint8Array(0), png)))).status,
    ).toBe(400);
    expect(
      (await handle(post(buildUploadFrame(jpegThumbnail, png), null))).status,
    ).toBe(400);
    expect(
      (await handle(post(buildUploadFrame(jpegThumbnail, png), "bad id!")))
        .status,
    ).toBe(400);
  });

  it("answers a repeat of an upload with the one image, and refuses another file under its id", async () => {
    const { handle, accounts } = createHandler();
    const first = await json(await handle(upload("shed", "one")));
    const second = await handle(upload("shed", "one"));
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual(first);
    expect(accounts.get("ada")).toHaveLength(1);
    const clash = await handle(
      upload("shed", "one", { original: makeJpeg(500) }),
    );
    expect(clash.status).toBe(409);
  });

  it("refuses an upload that passes the allowance, with a message code", async () => {
    const { handle, store } = createHandler();
    await store.upload(
      "ada",
      "shed",
      "fill",
      "image/png",
      Buffer.alloc(accountImageBytes - 10),
      Buffer.alloc(0),
    );
    const response = await handle(upload("shed", "one"));
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: "no_space" });
  });

  it("refuses an upload to a project the account does not have", async () => {
    const { handle } = createHandler({}, { hasProject: () => false });
    expect((await handle(upload("shed", "one"))).status).toBe(404);
  });

  it("says the shared storage is full, and unavailable on other failures", async () => {
    const { handle } = createHandler({
      store: {
        ...createMemoryImageStore().store,
        upload: async () => ({ kind: "storage-full" }),
      },
    });
    const full = await handle(upload("shed", "one"));
    expect(full.status).toBe(503);
    expect(await json(full)).toEqual({ error: "shared_storage_full" });
    const failing = createHandler({
      store: {
        ...createMemoryImageStore().store,
        upload: async () => {
          throw new Error("down");
        },
      },
    });
    const response = await failing.handle(upload("shed", "one"));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ error: "unavailable" });
  });
});

describe("serving files", () => {
  it("never lets a file be cached, sniffed, or take another type", async () => {
    const { handle } = createHandler();
    await handle(upload("shed", "one"));
    for (const kind of ["original", "thumbnail"] as const) {
      const response = await handle(
        request(buildImageBytesPath("shed", "one", kind)),
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Content-Disposition")).toBe("inline");
      expect(response.headers.get("Content-Type")).toMatch(
        /^image\/(png|jpeg)$/,
      );
    }
    const list = await handle(request(buildImagesPath("shed")));
    expect(list.headers.get("Cache-Control")).toBe("no-store");
  });

  it("gives nothing for an image that is not there", async () => {
    const { handle } = createHandler();
    expect(
      (await handle(request(buildImageBytesPath("shed", "none", "original"))))
        .status,
    ).toBe(404);
  });
});

describe("listing", () => {
  it("gives a page of 100 with captions of the longest length well under Vercel's response limit", async () => {
    const { handle, store } = createHandler();
    for (let index = 0; index < listPageSize + 1; index++) {
      const id = `i${String(index).padStart(3, "0")}`;
      await store.upload(
        "ada",
        "shed",
        id,
        "image/png",
        Buffer.from([index]),
        Buffer.from([1]),
      );
      await store.setCaption(
        "ada",
        "shed",
        id,
        "",
        "😀".repeat(maxCaptionLength),
      );
    }
    const response = await handle(request(buildImagesPath("shed")));
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThan(1_000_000);
    const page = JSON.parse(text);
    expect(page.images).toHaveLength(listPageSize);
    expect(page.hasOlder).toBe(true);
  });

  it("pages back from a cursor, and refuses a bad one", async () => {
    const { handle, store } = createHandler();
    for (let index = 0; index < 3; index++) {
      await store.upload(
        "ada",
        "shed",
        `i${index}`,
        "image/png",
        Buffer.from([index]),
        Buffer.from([1]),
      );
    }
    const all = await json(await handle(request(buildImagesPath("shed"))));
    const second = (all.images as ImageInfo[])[1];
    const cursor = encodeURIComponent(`${second.createdAt}_${second.id}`);
    const older = await json(
      await handle(request(`${buildImagesPath("shed")}?before=${cursor}`)),
    );
    expect((older.images as ImageInfo[]).map(({ id }) => id)).toEqual(["i0"]);
    expect(
      (await handle(request(`${buildImagesPath("shed")}?before=garbage`)))
        .status,
    ).toBe(400);
  });
});

describe("captions", () => {
  it("accepts 500 characters counted as people count them, and refuses 501", async () => {
    const { handle } = createHandler();
    await handle(upload("shed", "one"));
    const full = "😀".repeat(maxCaptionLength);
    expect(
      (await handle(caption("shed", "one", { base: "", caption: full })))
        .status,
    ).toBe(200);
    const over = await handle(
      caption("shed", "one", { base: full, caption: full + "a" }),
    );
    expect(over.status).toBe(400);
    expect(await json(over)).toEqual({ error: "caption_too_long" });
  });

  it("clears a caption, and gives the saved one when it is out of date", async () => {
    const { handle } = createHandler();
    await handle(upload("shed", "one"));
    await handle(caption("shed", "one", { base: "", caption: "Theirs" }));
    const conflict = await handle(
      caption("shed", "one", { base: "", caption: "Mine" }),
    );
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toMatchObject({
      error: "conflict",
      image: { caption: "Theirs" },
    });
    const cleared = await handle(
      caption("shed", "one", { base: "Theirs", caption: "" }),
    );
    expect(await json(cleared)).toMatchObject({ image: { caption: "" } });
  });

  it("refuses a body that is not a caption", async () => {
    const { handle } = createHandler();
    await handle(upload("shed", "one"));
    for (const body of [
      "not json",
      {},
      { base: "", caption: 5 },
      { base: "", caption: "a\u0000b" },
    ]) {
      expect((await handle(caption("shed", "one", body))).status).toBe(400);
    }
  });
});

describe("removing", () => {
  it("removes an image and gives the allowance back", async () => {
    const { handle } = createHandler();
    await handle(upload("shed", "one"));
    const response = await handle(
      request(buildImagePath("shed", "one"), { method: "DELETE" }),
    );
    expect(await json(response)).toEqual({ usedBytes: 0 });
    expect(
      (await handle(request(buildImageBytesPath("shed", "one", "original"))))
        .status,
    ).toBe(404);
    expect(
      (
        await handle(
          request(buildImagePath("shed", "one"), { method: "DELETE" }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("a task's photos (AD #67 Add Photos To Tasks)", () => {
  const taskPath = buildTaskImagesPath("shed", "t1");

  function taskUpload(imageId: string, options: Options = {}) {
    return request(taskPath, {
      method: "POST",
      body: buildUploadFrame(jpegThumbnail, png),
      contentType: "application/octet-stream",
      ...options,
      headers: { [imageIdHeader]: imageId, ...options.headers },
    });
  }

  const removeTask = (options: Options = {}) =>
    request(taskPath, { method: "DELETE", ...options });

  it("adds, lists and counts a task's photos apart from the project's images", async () => {
    const { handle } = createHandler();
    expect((await handle(upload("shed", "project"))).status).toBe(200);
    expect((await handle(taskUpload("first"))).status).toBe(200);
    expect((await handle(taskUpload("second"))).status).toBe(200);

    const project = await json(await handle(request(buildImagesPath("shed"))));
    expect((project.images as ImageInfo[]).map((image) => image.id)).toEqual([
      "project",
    ]);
    const task = await json(await handle(request(taskPath)));
    expect((task.images as ImageInfo[]).map((image) => image.id)).toEqual([
      "first",
      "second",
    ]);
    const summary = await handle(request(buildTaskImageSummaryPath("shed")));
    expect(summary.status).toBe(200);
    expect(await json(summary)).toEqual({
      tasks: { t1: { count: 2, latestImageId: "second" } },
    });
  });

  it("serves, captions and removes a task photo through its project's image paths", async () => {
    const { handle } = createHandler();
    await handle(taskUpload("one"));
    expect(
      (await handle(request(buildImageBytesPath("shed", "one", "original"))))
        .status,
    ).toBe(200);
    expect(
      (await handle(caption("shed", "one", { base: "", caption: "Tap" })))
        .status,
    ).toBe(200);
    expect(
      (
        await handle(
          request(buildImagePath("shed", "one"), { method: "DELETE" }),
        )
      ).status,
    ).toBe(200);
  });

  it("refuses a photo for a task that is not saved", async () => {
    const { handle, accounts } = createHandler(
      {},
      { hasTask: (_user, _project, taskId) => taskId !== "t1" },
    );
    const response = await handle(taskUpload("one"));
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "not_found" });
    expect(accounts.get("ada") ?? []).toHaveLength(0);
  });

  it("removes a deleted task's photos, and keeps those of a task saved again", async () => {
    let isSaved = true;
    const { handle, accounts } = createHandler({}, { hasTask: () => isSaved });
    await handle(taskUpload("one"));
    const kept = await handle(removeTask());
    expect(kept.status).toBe(409);
    expect(await json(kept)).toEqual({ error: "conflict" });
    expect(accounts.get("ada")).toHaveLength(1);

    isSaved = false;
    const removed = await handle(removeTask());
    expect(removed.status).toBe(200);
    expect(await json(removed)).toEqual({ usedBytes: 0 });
    expect(accounts.get("ada")).toHaveLength(0);
  });

  it("answers not found for a project the account does not have", async () => {
    const { handle } = createHandler({}, { hasProject: () => false });
    for (const built of [
      request(taskPath),
      request(buildTaskImageSummaryPath("shed")),
      removeTask(),
    ]) {
      expect((await handle(built)).status).toBe(404);
    }
  });

  it("refuses unknown task paths and methods", async () => {
    const { handle } = createHandler();
    expect((await handle(request(taskPath, { method: "PATCH" }))).status).toBe(
      405,
    );
    expect(
      (
        await handle(
          request(buildTaskImageSummaryPath("shed"), { method: "DELETE" }),
        )
      ).status,
    ).toBe(405);
    expect((await handle(request(`${taskPath}/one`))).status).toBe(404);
    expect(
      (await handle(request("/api/projects/shed/tasks/bad%20id/images")))
        .status,
    ).toBe(404);
  });

  const routes: [string, (options: Options) => Request][] = [
    ["list", (options) => request(taskPath, options)],
    ["upload", (options) => taskUpload("one", options)],
    ["remove", (options) => removeTask(options)],
    [
      "summary",
      (options) => request(buildTaskImageSummaryPath("shed"), options),
    ],
  ];

  it.each(routes)("refuses %s without a sign-in", async (_name, build) => {
    const { handle, calls } = createHandler();
    const response = await handle(build({ account: null, pageAccount: "ada" }));
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each(routes)(
    "refuses %s from a page that expects another account",
    async (_name, build) => {
      const { handle, calls } = createHandler();
      const response = await handle(build({ pageAccount: "bob" }));
      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error: "account_changed" });
      expect(calls).toEqual([]);
    },
  );

  it.each(routes.filter(([name]) => name === "upload" || name === "remove"))(
    "refuses %s from another site",
    async (_name, build) => {
      const { handle, calls } = createHandler();
      const response = await handle(build({ origin: "https://evil.example" }));
      expect(response.status).toBe(403);
      expect(calls).toEqual([]);
    },
  );

  it("keeps each account's task photos from another, taking the account from the sign-in alone", async () => {
    const { handle, accounts } = createHandler();
    await handle(taskUpload("one"));
    const bob = { account: "bob", pageAccount: "bob" };
    const listed = await json(await handle(request(taskPath, bob)));
    expect(listed.images).toEqual([]);
    expect(
      await json(await handle(request(buildTaskImageSummaryPath("shed"), bob))),
    ).toEqual({ tasks: {} });
    expect(
      (
        await handle(
          request(buildImageBytesPath("shed", "one", "original"), bob),
        )
      ).status,
    ).toBe(404);
    await handle(removeTask(bob));
    expect(accounts.get("ada")).toHaveLength(1);
  });
});
