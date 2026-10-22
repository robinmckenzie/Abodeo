// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createImageStore } from "./image-store.server";
import { accountImageBytes, listPageSize } from "./images-api";
import type { TransactionalDatabase } from "./project-store.server";

type ImageRow = {
  user_id: string;
  project_id: string;
  id: string;
  content_type: string;
  original_size: number;
  thumbnail_size: number;
  content_hash: string;
  caption: string;
  created_at: string;
};
type BytesRow = {
  user_id: string;
  project_id: string;
  image_id: string;
  kind: string;
  data: Buffer;
};

// Stands in for Postgres, understanding only the store's own statements,
// recording each one, and undoing a transaction's changes on rollback.
function createFakeDatabase() {
  const state = {
    projects: [] as { user_id: string; id: string }[],
    images: [] as ImageRow[],
    bytes: [] as BytesRow[],
  };
  const statements: { text: string; values: unknown[] }[] = [];
  let clock = 0;
  let failOn: { pattern: RegExp; error: unknown } | null = null;

  const clone = () => structuredClone(state);

  const run = async (text: string, values: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    statements.push({ text: sql, values });
    if (failOn?.pattern.test(sql)) throw failOn.error;
    const [userId, projectId, imageId] = values as string[];
    if (/^(begin|commit|rollback|set local)/.test(sql)) return { rows: [] };
    if (sql.startsWith("select id from auth_user")) return { rows: [] };
    if (sql.startsWith("select 1 as found from project ")) {
      const found = state.projects.some(
        (row) => row.user_id === userId && row.id === projectId,
      );
      return { rows: found ? [{ found: 1 }] : [] };
    }
    if (sql.includes("as used from project_image")) {
      const used = state.images
        .filter((row) => row.user_id === userId)
        .reduce((sum, row) => sum + row.original_size + row.thumbnail_size, 0);
      return { rows: [{ used: String(used) }] };
    }
    if (
      sql.startsWith("select id, content_type") &&
      sql.includes("content_hash")
    ) {
      return {
        rows: state.images.filter(
          (row) =>
            row.user_id === userId &&
            row.project_id === projectId &&
            row.id === imageId,
        ),
      };
    }
    if (sql.startsWith("select id, content_type")) {
      const mine = state.images
        .filter((row) => row.user_id === userId && row.project_id === projectId)
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        );
      const limit = Number(values.at(-1));
      const before =
        values.length === 5 ? { at: values[2], id: values[3] } : null;
      const page = mine.filter(
        (row) =>
          !before ||
          row.created_at < String(before.at) ||
          (row.created_at === before.at && row.id < String(before.id)),
      );
      return { rows: page.slice(0, limit) };
    }
    if (sql.startsWith("select content_type from project_image")) {
      return {
        rows: state.images.filter(
          (row) =>
            row.user_id === userId &&
            row.project_id === projectId &&
            row.id === imageId,
        ),
      };
    }
    if (sql.startsWith("insert into project_image (")) {
      if (
        !state.projects.some((p) => p.user_id === userId && p.id === projectId)
      ) {
        throw new Error("foreign key");
      }
      const row: ImageRow = {
        user_id: userId,
        project_id: projectId,
        id: imageId,
        content_type: String(values[3]),
        original_size: Number(values[4]),
        thumbnail_size: Number(values[5]),
        content_hash: String(values[6]),
        caption: "",
        created_at: `2026-10-22T10:00:00.${String(++clock).padStart(6, "0")}Z`,
      };
      state.images.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith("insert into project_image_bytes")) {
      state.bytes.push(
        {
          user_id: userId,
          project_id: projectId,
          image_id: imageId,
          kind: "original",
          data: values[3] as Buffer,
        },
        {
          user_id: userId,
          project_id: projectId,
          image_id: imageId,
          kind: "thumbnail",
          data: values[4] as Buffer,
        },
      );
      return { rows: [] };
    }
    if (sql.startsWith("select encode(data")) {
      const row = state.bytes.find(
        (entry) =>
          entry.user_id === userId &&
          entry.project_id === projectId &&
          entry.image_id === imageId &&
          entry.kind === values[3],
      );
      return { rows: row ? [{ data: row.data.toString("base64") }] : [] };
    }
    if (sql.startsWith("update project_image set caption")) {
      const row = state.images.find(
        (entry) =>
          entry.user_id === userId &&
          entry.project_id === projectId &&
          entry.id === imageId &&
          entry.caption === values[4],
      );
      if (row) row.caption = String(values[3]);
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("delete from project_image ")) {
      const index = state.images.findIndex(
        (row) =>
          row.user_id === userId &&
          row.project_id === projectId &&
          row.id === imageId,
      );
      if (index < 0) return { rows: [] };
      state.images.splice(index, 1);
      state.bytes = state.bytes.filter(
        (row) =>
          !(
            row.user_id === userId &&
            row.project_id === projectId &&
            row.image_id === imageId
          ),
      );
      return { rows: [{ id: imageId }] };
    }
    throw new Error(`unexpected statement: ${sql}`);
  };

  const database: TransactionalDatabase = {
    query: run,
    async connect() {
      let snapshot: ReturnType<typeof clone> | null = null;
      return {
        async query(text, values) {
          if (text === "begin") snapshot = clone();
          if (text === "rollback" && snapshot) {
            Object.assign(state, structuredClone(snapshot));
          }
          return run(text, values);
        },
        release() {},
      };
    },
  };

  return {
    database,
    state,
    statements,
    addProject(userId: string, id: string) {
      state.projects.push({ user_id: userId, id });
    },
    failOn(pattern: RegExp, error: unknown) {
      failOn = { pattern, error };
    },
  };
}

const original = Buffer.from("original");
const thumbnail = Buffer.from("thumb");

function setup() {
  const fake = createFakeDatabase();
  fake.addProject("ada", "shed");
  fake.addProject("bob", "shed");
  return { ...fake, store: createImageStore(fake.database) };
}

describe("uploading", () => {
  it("adds an image with the server's own sizes, and counts it", async () => {
    const { store, state } = setup();
    const outcome = await store.upload(
      "ada",
      "shed",
      "one",
      "image/png",
      original,
      thumbnail,
    );
    expect(outcome).toMatchObject({
      kind: "added",
      usedBytes: original.length + thumbnail.length,
      image: {
        id: "one",
        contentType: "image/png",
        originalSize: 8,
        caption: "",
      },
    });
    expect(state.images[0]).toMatchObject({
      original_size: 8,
      thumbnail_size: 5,
    });
    expect(state.bytes.map((row) => row.kind).sort()).toEqual([
      "original",
      "thumbnail",
    ]);
  });

  it("takes the account's lock before checking the allowance", async () => {
    const { store, statements } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    const texts = statements.map(({ text }) => text);
    const lock = texts.findIndex((text) => text.includes("for no key update"));
    const used = texts.findIndex((text) => text.includes("as used"));
    expect(lock).toBeGreaterThan(texts.indexOf("begin"));
    expect(used).toBeGreaterThan(lock);
    expect(texts.at(-1)).toBe("commit");
  });

  it("answers a retry with the image already added, using no more allowance", async () => {
    const { store, state } = setup();
    const first = await store.upload(
      "ada",
      "shed",
      "one",
      "image/png",
      original,
      thumbnail,
    );
    const second = await store.upload(
      "ada",
      "shed",
      "one",
      "image/png",
      original,
      thumbnail,
    );
    expect(second.kind).toBe("existing");
    expect(second).toMatchObject({ image: { id: "one" }, usedBytes: 13 });
    expect(first).toMatchObject({ kind: "added" });
    expect(state.images).toHaveLength(1);
  });

  it("refuses an id already used for different content", async () => {
    const { store, state } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    const outcome = await store.upload(
      "ada",
      "shed",
      "one",
      "image/png",
      Buffer.from("other"),
      thumbnail,
    );
    expect(outcome).toEqual({ kind: "conflict" });
    expect(state.images).toHaveLength(1);
  });

  it("refuses an upload that would pass the allowance, and keeps the room when removed", async () => {
    const { store, state } = setup();
    state.images.push({
      user_id: "ada",
      project_id: "shed",
      id: "big",
      content_type: "image/png",
      original_size: accountImageBytes - 20,
      thumbnail_size: 10,
      content_hash: "x",
      caption: "",
      created_at: "2026-10-22T09:00:00.000000Z",
    });
    expect(
      await store.upload(
        "ada",
        "shed",
        "two",
        "image/png",
        Buffer.alloc(11),
        Buffer.alloc(0),
      ),
    ).toEqual({ kind: "no-space" });
    // Exactly to the limit is allowed.
    expect(
      await store.upload(
        "ada",
        "shed",
        "two",
        "image/png",
        Buffer.alloc(5),
        Buffer.alloc(5),
      ),
    ).toMatchObject({ kind: "added", usedBytes: accountImageBytes });
    expect(await store.remove("ada", "shed", "big")).toEqual({ usedBytes: 10 });
  });

  it("does not count another account's images", async () => {
    const { store, state } = setup();
    state.images.push({
      user_id: "bob",
      project_id: "shed",
      id: "big",
      content_type: "image/png",
      original_size: accountImageBytes,
      thumbnail_size: 0,
      content_hash: "x",
      caption: "",
      created_at: "2026-10-22T09:00:00.000000Z",
    });
    expect(
      await store.upload(
        "ada",
        "shed",
        "one",
        "image/png",
        original,
        thumbnail,
      ),
    ).toMatchObject({ kind: "added" });
  });

  it("stores nothing when the bytes fail to save", async () => {
    const { store, state, failOn } = setup();
    failOn(/^insert into project_image_bytes/, new Error("down"));
    await expect(
      store.upload("ada", "shed", "one", "image/png", original, thumbnail),
    ).rejects.toThrow("down");
    expect(state.images).toHaveLength(0);
    expect(state.bytes).toHaveLength(0);
  });

  it("reports a full database, and stores nothing", async () => {
    const { store, state, failOn } = setup();
    failOn(
      /^insert into project_image_bytes/,
      Object.assign(new Error("full"), { code: "53100" }),
    );
    expect(
      await store.upload(
        "ada",
        "shed",
        "one",
        "image/png",
        original,
        thumbnail,
      ),
    ).toEqual({ kind: "storage-full" });
    expect(state.images).toHaveLength(0);
  });

  it("does not add to a project the account does not have", async () => {
    const { store, state } = setup();
    expect(
      await store.upload(
        "ada",
        "nope",
        "one",
        "image/png",
        original,
        thumbnail,
      ),
    ).toEqual({ kind: "not-found" });
    expect(state.images).toHaveLength(0);
  });
});

describe("two accounts with a project of the same id", () => {
  async function addOne() {
    const context = setup();
    await context.store.upload(
      "ada",
      "shed",
      "one",
      "image/png",
      original,
      thumbnail,
    );
    return context;
  }

  it("keeps each account's images from the other", async () => {
    const { store } = await addOne();
    expect((await store.list("bob", "shed"))?.images).toEqual([]);
    expect(await store.read("bob", "shed", "one", "original")).toBeNull();
    expect(await store.read("bob", "shed", "one", "thumbnail")).toBeNull();
    expect(await store.setCaption("bob", "shed", "one", "", "mine")).toEqual({
      kind: "not-found",
    });
    expect(await store.remove("bob", "shed", "one")).toBeNull();
    expect((await store.list("ada", "shed"))?.images).toHaveLength(1);
    expect((await store.read("ada", "shed", "one", "original"))?.bytes).toEqual(
      original,
    );
  });

  it("always scopes every statement to the account it is given", async () => {
    const { store, statements } = await addOne();
    statements.length = 0;
    await store.list("bob", "shed");
    await store.read("bob", "shed", "one", "original");
    await store.setCaption("bob", "shed", "one", "", "x");
    await store.remove("bob", "shed", "one");
    expect(statements.length).toBeGreaterThan(0);
    for (const { text, values } of statements) {
      expect(values[0]).toBe("bob");
      expect(text).toMatch(/user_id = \$1/);
    }
  });
});

describe("reading", () => {
  it("gives the stored type for an original, and JPEG for a thumbnail", async () => {
    const { store } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    expect(await store.read("ada", "shed", "one", "original")).toEqual({
      contentType: "image/png",
      bytes: original,
    });
    expect(await store.read("ada", "shed", "one", "thumbnail")).toEqual({
      contentType: "image/jpeg",
      bytes: thumbnail,
    });
  });

  it("gives nothing for an image that is not there", async () => {
    const { store } = setup();
    expect(await store.read("ada", "shed", "none", "original")).toBeNull();
    expect(await store.list("ada", "nope")).toBeNull();
  });
});

describe("listing", () => {
  async function addMany(count: number) {
    const context = setup();
    for (let index = 0; index < count; index++) {
      await context.store.upload(
        "ada",
        "shed",
        `i${String(index).padStart(3, "0")}`,
        "image/png",
        Buffer.from([index]),
        Buffer.from([1]),
      );
    }
    return context;
  }

  it("gives the newest page oldest first, with a way to the older ones", async () => {
    const { store } = await addMany(listPageSize + 5);
    const page = await store.list("ada", "shed");
    expect(page?.images).toHaveLength(listPageSize);
    expect(page?.hasOlder).toBe(true);
    expect(page?.images[0].id).toBe("i005");
    expect(page?.images.at(-1)?.id).toBe(
      `i${listPageSize + 4}`.replace("i", "i"),
    );
    expect(page).toMatchObject({ limitBytes: accountImageBytes });
    const older = await store.list("ada", "shed", {
      createdAt: page!.images[0].createdAt,
      id: page!.images[0].id,
    });
    expect(older?.images.map((image) => image.id)).toEqual([
      "i000",
      "i001",
      "i002",
      "i003",
      "i004",
    ]);
    expect(older?.hasOlder).toBe(false);
  });
});

describe("captions", () => {
  it("saves a change made from the saved caption, and clears it", async () => {
    const { store } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    expect(
      await store.setCaption("ada", "shed", "one", "", "Before"),
    ).toMatchObject({
      kind: "saved",
      image: { caption: "Before" },
    });
    expect(
      await store.setCaption("ada", "shed", "one", "Before", ""),
    ).toMatchObject({
      kind: "saved",
      image: { caption: "" },
    });
  });

  it("gives the saved caption when it is not the one the change was made from", async () => {
    const { store } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    await store.setCaption("ada", "shed", "one", "", "Theirs");
    expect(
      await store.setCaption("ada", "shed", "one", "", "Mine"),
    ).toMatchObject({
      kind: "conflict",
      image: { caption: "Theirs" },
    });
  });

  it("counts saving what is already saved as saved", async () => {
    const { store } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    await store.setCaption("ada", "shed", "one", "", "Same");
    expect(
      await store.setCaption("ada", "shed", "one", "", "Same"),
    ).toMatchObject({
      kind: "saved",
    });
  });

  it("does not make two images conflict", async () => {
    const { store } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    await store.upload(
      "ada",
      "shed",
      "two",
      "image/png",
      Buffer.from("b"),
      thumbnail,
    );
    await store.setCaption("ada", "shed", "one", "", "One");
    expect(
      await store.setCaption("ada", "shed", "two", "", "Two"),
    ).toMatchObject({
      kind: "saved",
    });
  });
});

describe("removing", () => {
  it("removes the image and its bytes by the table's cascade, and gives the allowance back", async () => {
    const { store, state, statements } = setup();
    await store.upload("ada", "shed", "one", "image/png", original, thumbnail);
    expect(await store.remove("ada", "shed", "one")).toEqual({ usedBytes: 0 });
    expect(state.bytes).toHaveLength(0);
    // Only the details are deleted; the bytes follow by the foreign key.
    const deletes = statements.filter(({ text }) => text.startsWith("delete"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].text).toContain("delete from project_image ");
    expect(await store.remove("ada", "shed", "one")).toBeNull();
  });
});
