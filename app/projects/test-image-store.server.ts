// Helpers for the images tests: an image store that keeps each account's
// images in memory, with the same rules as the database's (an account sees
// only its own, a retry with the same id gives the image already added, and
// the allowance is 100 MB), and records which account each call was for.
import { createHash } from "node:crypto";

import type { ImageStore } from "./image-store.server";
import { accountImageBytes, listPageSize, type ImageInfo } from "./images-api";

type Stored = {
  image: ImageInfo;
  projectId: string;
  hash: string;
  original: Buffer;
  thumbnail: Buffer;
};

export function createMemoryImageStore({
  hasProject = () => true,
}: {
  hasProject?: (userId: string, projectId: string) => boolean;
} = {}) {
  const accounts = new Map<string, Stored[]>();
  const calls: string[] = [];
  let clock = 0;
  const imagesOf = (userId: string) => {
    if (!accounts.has(userId)) accounts.set(userId, []);
    return accounts.get(userId)!;
  };
  const used = (userId: string) =>
    imagesOf(userId).reduce(
      (sum, { original, thumbnail }) =>
        sum + original.length + thumbnail.length,
      0,
    );
  const find = (userId: string, projectId: string, imageId: string) =>
    imagesOf(userId).find(
      (entry) => entry.projectId === projectId && entry.image.id === imageId,
    );

  const store: ImageStore = {
    async list(userId, projectId, before) {
      calls.push(userId);
      if (!hasProject(userId, projectId)) return null;
      const all = imagesOf(userId)
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => entry.image)
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        )
        .filter(
          (image) =>
            !before ||
            image.createdAt < before.createdAt ||
            (image.createdAt === before.createdAt && image.id < before.id),
        );
      return {
        images: all.slice(0, listPageSize).reverse(),
        hasOlder: all.length > listPageSize,
        usedBytes: used(userId),
        limitBytes: accountImageBytes,
      };
    },
    async upload(userId, projectId, imageId, contentType, original, thumbnail) {
      calls.push(userId);
      if (!hasProject(userId, projectId)) return { kind: "not-found" };
      const hash = createHash("sha256")
        .update(original)
        .update(thumbnail)
        .digest("hex");
      const existing = find(userId, projectId, imageId);
      if (existing) {
        return existing.hash === hash
          ? {
              kind: "existing",
              image: existing.image,
              usedBytes: used(userId),
            }
          : { kind: "conflict" };
      }
      if (
        used(userId) + original.length + thumbnail.length >
        accountImageBytes
      ) {
        return { kind: "no-space" };
      }
      const image: ImageInfo = {
        id: imageId,
        createdAt: `2026-10-22T10:00:00.${String(++clock).padStart(6, "0")}Z`,
        contentType,
        originalSize: original.length,
        caption: "",
      };
      imagesOf(userId).push({ image, projectId, hash, original, thumbnail });
      return { kind: "added", image, usedBytes: used(userId) };
    },
    async read(userId, projectId, imageId, kind) {
      calls.push(userId);
      const entry = find(userId, projectId, imageId);
      if (!entry) return null;
      return kind === "thumbnail"
        ? { contentType: "image/jpeg", bytes: entry.thumbnail }
        : { contentType: entry.image.contentType, bytes: entry.original };
    },
    async setCaption(userId, projectId, imageId, base, caption) {
      calls.push(userId);
      const entry = find(userId, projectId, imageId);
      if (!entry) return { kind: "not-found" };
      if (entry.image.caption !== base && entry.image.caption !== caption) {
        return { kind: "conflict", image: entry.image };
      }
      entry.image = { ...entry.image, caption };
      return { kind: "saved", image: entry.image };
    },
    async remove(userId, projectId, imageId) {
      calls.push(userId);
      const entry = find(userId, projectId, imageId);
      if (!entry) return null;
      imagesOf(userId).splice(imagesOf(userId).indexOf(entry), 1);
      return { usedBytes: used(userId) };
    },
  };
  return { store, accounts, calls };
}
