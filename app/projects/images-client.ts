// A signed-in account's images, fetched from the images endpoints (AD #48 Add
// Images To Projects). Every request names the account the page is working
// for, and gives up after requestTimeout, or uploadTimeout for an upload.
// What comes back is only ever held in memory.
import { requestTimeout } from "../account/account-client";
import {
  buildCursor,
  buildImageBytesPath,
  buildImagePath,
  buildImagesPath,
  buildUploadFrame,
  imageIdHeader,
  uploadContentType,
  type ImageContentType,
  type ImageInfo,
  type ImageKind,
  type ImageListResponse,
} from "./images-api";
import { accountHeader } from "./projects-api";

type Fetch = typeof fetch;

// How long an upload may take, as a large photo goes over a slow network.
export const uploadTimeout = 60_000;

export type ImageFailure =
  // The server or the account store did not answer.
  | "unreachable"
  | "signed-out"
  // Another tab signed in as someone else.
  | "account-changed"
  | "not-found"
  | "too-large"
  | "unsupported-format"
  | "no-space"
  | "shared-storage-full"
  | "caption-too-long"
  | "conflict"
  | "refused";

type Answer = { status: number; response: Response } | "unreachable";

async function send(
  fetchFn: Fetch,
  accountId: string,
  path: string,
  {
    method = "GET",
    headers = {},
    body,
    timeout = requestTimeout,
  }: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
    timeout?: number;
  } = {},
): Promise<Answer> {
  try {
    const response = await fetchFn(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
      headers: { [accountHeader]: accountId, ...headers },
      body,
    });
    return { status: response.status, response };
  } catch {
    return "unreachable";
  }
}

async function readJson(answer: Answer): Promise<unknown> {
  if (answer === "unreachable") return null;
  try {
    return await answer.response.json();
  } catch {
    return null;
  }
}

async function readFailure(answer: Answer): Promise<ImageFailure> {
  if (answer === "unreachable") return "unreachable";
  const error = ((await readJson(answer)) as { error?: unknown } | null)?.error;
  switch (answer.status) {
    case 401:
      return "signed-out";
    case 404:
      return "not-found";
    case 409:
      if (error === "account_changed") return "account-changed";
      return error === "no_space" ? "no-space" : "conflict";
    case 413:
      return "too-large";
    case 415:
      return "unsupported-format";
    case 400:
      return error === "caption_too_long" ? "caption-too-long" : "refused";
    case 503:
      return error === "shared_storage_full"
        ? "shared-storage-full"
        : "unreachable";
  }
  return "unreachable";
}

function isImageInfo(value: unknown): value is ImageInfo {
  const image = value as Partial<ImageInfo> | null;
  return (
    typeof image?.id === "string" &&
    typeof image.createdAt === "string" &&
    (image.contentType === "image/jpeg" || image.contentType === "image/png") &&
    typeof image.originalSize === "number" &&
    typeof image.caption === "string"
  );
}

export type Outcome<Value> =
  ({ ok: true } & Value) | { ok: false; reason: ImageFailure };

// The newest page of a project's images, or the page before one.
export async function loadImages(
  accountId: string,
  projectId: string,
  before: ImageInfo | null = null,
  fetchFn: Fetch = fetch,
): Promise<Outcome<{ page: ImageListResponse }>> {
  const query = before
    ? `?before=${encodeURIComponent(buildCursor(before))}`
    : "";
  const answer = await send(
    fetchFn,
    accountId,
    buildImagesPath(projectId) + query,
  );
  if (answer === "unreachable" || answer.status !== 200) {
    return { ok: false, reason: await readFailure(answer) };
  }
  const body = (await readJson(answer)) as Partial<ImageListResponse> | null;
  if (
    !Array.isArray(body?.images) ||
    !body.images.every(isImageInfo) ||
    typeof body.hasOlder !== "boolean" ||
    typeof body.usedBytes !== "number" ||
    typeof body.limitBytes !== "number"
  ) {
    return { ok: false, reason: "unreachable" };
  }
  return { ok: true, page: body as ImageListResponse };
}

// Sends one image with its thumbnail, in one binary request. The id is made
// by the caller, so that sending the same upload again, after a lost answer,
// gives the image already added.
export async function uploadImage(
  accountId: string,
  projectId: string,
  imageId: string,
  thumbnail: Uint8Array,
  original: Uint8Array,
  fetchFn: Fetch = fetch,
): Promise<Outcome<{ image: ImageInfo; usedBytes: number }>> {
  const answer = await send(fetchFn, accountId, buildImagesPath(projectId), {
    method: "POST",
    headers: {
      "Content-Type": uploadContentType,
      [imageIdHeader]: imageId,
    },
    body: buildUploadFrame(thumbnail, original),
    timeout: uploadTimeout,
  });
  if (answer === "unreachable" || answer.status !== 200) {
    return { ok: false, reason: await readFailure(answer) };
  }
  const body = (await readJson(answer)) as {
    image?: unknown;
    usedBytes?: unknown;
  } | null;
  if (!isImageInfo(body?.image) || typeof body.usedBytes !== "number") {
    return { ok: false, reason: "unreachable" };
  }
  return { ok: true, image: body.image, usedBytes: body.usedBytes };
}

// The bytes of an image's original or thumbnail.
export async function fetchImageFile(
  accountId: string,
  projectId: string,
  imageId: string,
  kind: ImageKind,
  fetchFn: Fetch = fetch,
): Promise<Outcome<{ blob: Blob }>> {
  const answer = await send(
    fetchFn,
    accountId,
    buildImageBytesPath(projectId, imageId, kind),
    { timeout: uploadTimeout },
  );
  if (answer === "unreachable" || answer.status !== 200) {
    return { ok: false, reason: await readFailure(answer) };
  }
  try {
    return { ok: true, blob: await answer.response.blob() };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

// A conflict, or a caption that was not saved, comes with the saved image
// where the server gave it.
export type CaptionResult =
  | { ok: true; image: ImageInfo }
  | { ok: false; reason: ImageFailure; image?: ImageInfo };

// Saves a caption changed from the one the page last had. A conflict gives
// the saved image.
export async function saveCaption(
  accountId: string,
  projectId: string,
  imageId: string,
  base: string,
  caption: string,
  fetchFn: Fetch = fetch,
): Promise<CaptionResult> {
  const answer = await send(
    fetchFn,
    accountId,
    buildImagePath(projectId, imageId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base, caption }),
    },
  );
  if (answer === "unreachable") return { ok: false, reason: "unreachable" };
  const body = (await readJson(answer)) as { image?: unknown } | null;
  if (answer.status === 200 && isImageInfo(body?.image)) {
    return { ok: true, image: body.image };
  }
  if (answer.status === 409 && isImageInfo(body?.image)) {
    return { ok: false, reason: "conflict", image: body.image };
  }
  const error = (body as { error?: unknown } | null)?.error;
  if (answer.status === 400 && error === "caption_too_long") {
    return { ok: false, reason: "caption-too-long" };
  }
  if (answer.status === 409 && error === "account_changed") {
    return { ok: false, reason: "account-changed" };
  }
  if (answer.status === 401) return { ok: false, reason: "signed-out" };
  if (answer.status === 404) return { ok: false, reason: "not-found" };
  return {
    ok: false,
    reason: answer.status === 400 ? "refused" : "unreachable",
  };
}

export async function removeImage(
  accountId: string,
  projectId: string,
  imageId: string,
  fetchFn: Fetch = fetch,
): Promise<Outcome<{ usedBytes: number }>> {
  const answer = await send(
    fetchFn,
    accountId,
    buildImagePath(projectId, imageId),
    {
      method: "DELETE",
    },
  );
  if (answer === "unreachable" || answer.status !== 200) {
    return { ok: false, reason: await readFailure(answer) };
  }
  const body = (await readJson(answer)) as { usedBytes?: unknown } | null;
  return typeof body?.usedBytes === "number"
    ? { ok: true, usedBytes: body.usedBytes }
    : { ok: false, reason: "unreachable" };
}

export type { ImageContentType };
