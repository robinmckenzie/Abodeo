// The images endpoints, for the images added to a signed-in account's
// projects (AD #48 Add Images To Projects). Whose images are read or changed
// comes only from the session cookie, never from anything in the request. An
// image has no public address: every file is fetched through these routes,
// by the account that owns it. The page also names the account it is working
// for, and a request naming another is refused without changing anything.
import {
  accountStoreTimeout,
  readErrorCode,
  respondWithJson,
  withTimeout,
  type ReadSessionUserId,
} from "../account/account-profile.server";
import type { ImageStore } from "./image-store.server";
import { validateImage } from "./image-validation";
import {
  countCharacters,
  imageIdHeader,
  isImageId,
  maxCaptionLength,
  maxUploadBytes,
  readCursor,
  readUploadFrame,
  uploadContentType,
  type ImageErrorCode,
  type ImageKind,
} from "./images-api";
import { readRequestAccount } from "./request-account.server";
import { isProjectId, projectsPath } from "./projects-api";

// The most a caption request may be: 500 characters of up to 4 bytes each,
// with the JSON around them and the caption it was made from.
const captionBodyLimit = 16 * 1024;

// How long an upload may take. A 4 MiB insert takes seconds on Neon's free
// plan.
export const imageUploadTimeout = 45_000;

const imagesPathPattern = /^\/api\/projects\/[^/]+\/images(\/|$)/;

export function isImagesPath(pathname: string) {
  return (
    pathname.startsWith(`${projectsPath}/`) && imagesPathPattern.test(pathname)
  );
}

export type ImageRequestDependencies = {
  readSessionUserId: ReadSessionUserId;
  store: ImageStore;
  timeout?: number;
  uploadTimeout?: number;
  reportFailure?: (code: string | undefined) => void;
};

function respondWithImageError(status: number, error: ImageErrorCode) {
  return respondWithJson(status, { error });
}

function reportImageFailure(code: string | undefined) {
  console.error(JSON.stringify({ type: "account_images_failed", code }));
}

type Route =
  | { kind: "list"; projectId: string }
  | { kind: "upload"; projectId: string }
  | { kind: "read"; projectId: string; imageId: string; file: ImageKind }
  | { kind: "caption"; projectId: string; imageId: string }
  | { kind: "remove"; projectId: string; imageId: string };

function findRoute(request: Request): Route | Response {
  const { pathname } = new URL(request.url);
  const { method } = request;
  const notFound = () => respondWithImageError(404, "not_found");
  const notAllowed = () => respondWithImageError(405, "method_not_allowed");
  let parts: string[];
  try {
    parts = pathname
      .slice(projectsPath.length + 1)
      .split("/")
      .map(decodeURIComponent);
  } catch {
    return notFound();
  }
  const [projectId, images, imageId, file, extra] = parts;
  if (images !== "images" || extra !== undefined || !isProjectId(projectId)) {
    return notFound();
  }
  if (imageId === undefined) {
    if (method === "GET") return { kind: "list", projectId };
    if (method === "POST") return { kind: "upload", projectId };
    return notAllowed();
  }
  if (!isImageId(imageId)) return notFound();
  if (file === undefined) {
    if (method === "PATCH") return { kind: "caption", projectId, imageId };
    if (method === "DELETE") return { kind: "remove", projectId, imageId };
    return notAllowed();
  }
  if (file !== "original" && file !== "thumbnail") return notFound();
  return method === "GET"
    ? { kind: "read", projectId, imageId, file }
    : notAllowed();
}

// The body's bytes, or "too-large" as soon as it passes the limit, whatever
// its declared length, so that a request cannot make the server hold more.
async function readBytes(request: Request, limit: number) {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > limit) return "too-large" as const;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return "too-large" as const;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks, total);
}

function readCaptionRequest(bytes: Uint8Array) {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  const { base, caption } = (body ?? {}) as {
    base?: unknown;
    caption?: unknown;
  };
  // Postgres text cannot hold a NUL character.
  if (typeof base !== "string" || typeof caption !== "string") return undefined;
  if (base.includes("\u0000") || caption.includes("\u0000")) return undefined;
  return { base, caption };
}

function respondWithFile(contentType: string, bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleImagesRequest(
  request: Request,
  {
    readSessionUserId,
    store,
    timeout = accountStoreTimeout,
    uploadTimeout = imageUploadTimeout,
    reportFailure = reportImageFailure,
  }: ImageRequestDependencies,
): Promise<Response> {
  const route = findRoute(request);
  if (route instanceof Response) return route;
  const isWrite = request.method !== "GET";
  if (isWrite) {
    // A page on another site cannot send these types, or the account header,
    // without the browser first asking permission, which these endpoints
    // never give. A request that says it comes from another site is also
    // refused outright.
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== new URL(request.url).origin) {
      return respondWithImageError(403, "forbidden");
    }
    const contentType = request.headers.get("Content-Type") ?? "";
    const needed =
      route.kind === "upload"
        ? uploadContentType
        : route.kind === "caption"
          ? "application/json"
          : null;
    if (needed !== null && !contentType.startsWith(needed)) {
      return respondWithImageError(400, "invalid_request");
    }
  }
  try {
    const account = await readRequestAccount(
      request,
      readSessionUserId,
      timeout,
    );
    if (account.kind === "refused") {
      return respondWithImageError(account.status, account.error);
    }
    const { userId } = account;
    const run = <Result>(work: Promise<Result>, limit = timeout) =>
      withTimeout(work, limit);

    switch (route.kind) {
      case "list": {
        const parameter = new URL(request.url).searchParams.get("before");
        const before = parameter === null ? undefined : readCursor(parameter);
        if (parameter !== null && !before) {
          return respondWithImageError(400, "invalid_request");
        }
        const page = await run(store.list(userId, route.projectId, before));
        return page
          ? respondWithJson(200, page)
          : respondWithImageError(404, "not_found");
      }

      case "read": {
        const file = await run(
          store.read(userId, route.projectId, route.imageId, route.file),
        );
        return file
          ? respondWithFile(file.contentType, file.bytes)
          : respondWithImageError(404, "not_found");
      }

      case "upload": {
        const imageId = request.headers.get(imageIdHeader);
        if (!isImageId(imageId)) {
          return respondWithImageError(400, "invalid_request");
        }
        const bytes = await readBytes(request, maxUploadBytes);
        if (bytes === "too-large") {
          return respondWithImageError(413, "too_large");
        }
        if (!bytes) return respondWithImageError(400, "invalid_request");
        const frame = readUploadFrame(bytes);
        switch (frame.kind) {
          case "invalid":
            return respondWithImageError(400, "invalid_request");
          case "too-large":
            return respondWithImageError(413, "too_large");
          case "thumbnail-too-large":
            return respondWithImageError(413, "thumbnail_too_large");
        }
        const contentType = validateImage(frame.original);
        if (!contentType || validateImage(frame.thumbnail) !== "image/jpeg") {
          return respondWithImageError(415, "unsupported_format");
        }
        const outcome = await run(
          store.upload(
            userId,
            route.projectId,
            imageId,
            contentType,
            Buffer.from(frame.original),
            Buffer.from(frame.thumbnail),
          ),
          uploadTimeout,
        );
        switch (outcome.kind) {
          case "added":
          case "existing":
            return respondWithJson(200, {
              image: outcome.image,
              usedBytes: outcome.usedBytes,
            });
          case "not-found":
            return respondWithImageError(404, "not_found");
          case "conflict":
            return respondWithImageError(409, "conflict");
          case "no-space":
            return respondWithImageError(409, "no_space");
          case "storage-full":
            return respondWithImageError(503, "shared_storage_full");
        }
        break;
      }

      case "caption": {
        const bytes = await readBytes(request, captionBodyLimit);
        if (bytes === "too-large") {
          return respondWithImageError(413, "too_large");
        }
        const update = bytes && readCaptionRequest(bytes);
        if (!update) return respondWithImageError(400, "invalid_request");
        if (countCharacters(update.caption) > maxCaptionLength) {
          return respondWithImageError(400, "caption_too_long");
        }
        const outcome = await run(
          store.setCaption(
            userId,
            route.projectId,
            route.imageId,
            update.base,
            update.caption,
          ),
        );
        switch (outcome.kind) {
          case "saved":
            return respondWithJson(200, { image: outcome.image });
          case "not-found":
            return respondWithImageError(404, "not_found");
          case "conflict":
            return respondWithJson(409, {
              error: "conflict",
              image: outcome.image,
            });
        }
        break;
      }

      case "remove": {
        const outcome = await run(
          store.remove(userId, route.projectId, route.imageId),
        );
        return outcome
          ? respondWithJson(200, outcome)
          : respondWithImageError(404, "not_found");
      }
    }
    return respondWithImageError(400, "invalid_request");
  } catch (error) {
    reportFailure(readErrorCode(error));
    return respondWithImageError(503, "unavailable");
  }
}
