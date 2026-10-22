// The images API between the server and the browser, for the images added to
// a signed-in account's projects (AD #48 Add Images To Projects). Both sides
// import it, so it uses neither Node nor browser APIs.
import { projectsPath } from "./projects-api";

// The most an image, its thumbnail and an account's images may be, in bytes.
// Provisional. The most a request may be is below Vercel's body limit of
// 4.5 MB, which a test checks.
export const maxImageBytes = 4 * 1024 * 1024;
export const maxThumbnailBytes = 100 * 1024;
export const accountImageBytes = 100 * 1024 * 1024;
// In characters as people count them, so an emoji is one.
export const maxCaptionLength = 500;
// How many images one answer lists, to stay under Vercel's response limit.
export const listPageSize = 100;

export const imageIdHeader = "X-Abodeo-Image-Id";
export const uploadContentType = "application/octet-stream";
export const uploadFrameHeaderBytes = 4;
export const maxUploadBytes =
  uploadFrameHeaderBytes + maxThumbnailBytes + maxImageBytes;

export type ImageContentType = "image/jpeg" | "image/png";
export type ImageKind = "original" | "thumbnail";

export type ImageInfo = {
  id: string;
  createdAt: string;
  contentType: ImageContentType;
  originalSize: number;
  caption: string;
};

export type ImageListResponse = {
  images: ImageInfo[];
  hasOlder: boolean;
  usedBytes: number;
  limitBytes: number;
};

export type ImageResponse = { image: ImageInfo; usedBytes: number };
export type ImageCaptionResponse = { image: ImageInfo };
export type ImageRemoveResponse = { usedBytes: number };
export type ImageConflictResponse = { error: "conflict"; image: ImageInfo };

export type ImageErrorCode =
  | "not_signed_in"
  | "invalid_request"
  | "method_not_allowed"
  | "unavailable"
  | "not_found"
  | "conflict"
  | "account_changed"
  | "too_large"
  | "thumbnail_too_large"
  | "unsupported_format"
  | "no_space"
  | "shared_storage_full"
  | "caption_too_long"
  | "forbidden";

export function buildImagesPath(projectId: string) {
  return `${projectsPath}/${encodeURIComponent(projectId)}/images`;
}

export function buildImagePath(projectId: string, imageId: string) {
  return `${buildImagesPath(projectId)}/${encodeURIComponent(imageId)}`;
}

export function buildImageBytesPath(
  projectId: string,
  imageId: string,
  kind: ImageKind,
) {
  return `${buildImagePath(projectId, imageId)}/${kind}`;
}

// An image id made by the browser.
export function isImageId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
}

export function countCharacters(text: string) {
  return [...text].length;
}

// The page of images before one, from its time as the server gave it and
// its id. Times have no underscore, so the first one divides the two.
export function buildCursor(image: Pick<ImageInfo, "createdAt" | "id">) {
  return `${image.createdAt}_${image.id}`;
}

export function readCursor(value: string) {
  const split = value.indexOf("_");
  if (split < 1) return undefined;
  const createdAt = value.slice(0, split);
  const id = value.slice(split + 1);
  if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(createdAt) || !isImageId(id)) {
    return undefined;
  }
  return { createdAt, id };
}

// An upload's body: the thumbnail's length in 4 bytes, big-endian, the
// thumbnail, then the original.
export function buildUploadFrame(
  thumbnail: Uint8Array,
  original: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(
    uploadFrameHeaderBytes + thumbnail.length + original.length,
  );
  new DataView(frame.buffer).setUint32(0, thumbnail.length);
  frame.set(thumbnail, uploadFrameHeaderBytes);
  frame.set(original, uploadFrameHeaderBytes + thumbnail.length);
  return frame;
}

export type UploadFrame =
  | { kind: "frame"; thumbnail: Uint8Array; original: Uint8Array }
  | { kind: "invalid" }
  | { kind: "too-large" | "thumbnail-too-large" };

export function readUploadFrame(bytes: Uint8Array): UploadFrame {
  if (bytes.length < uploadFrameHeaderBytes) return { kind: "invalid" };
  const thumbnailLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0);
  const originalLength =
    bytes.length - uploadFrameHeaderBytes - thumbnailLength;
  if (originalLength < 0) return { kind: "invalid" };
  if (thumbnailLength > maxThumbnailBytes) {
    return { kind: "thumbnail-too-large" };
  }
  if (originalLength > maxImageBytes) return { kind: "too-large" };
  if (thumbnailLength === 0 || originalLength === 0) {
    return { kind: "invalid" };
  }
  const thumbnailEnd = uploadFrameHeaderBytes + thumbnailLength;
  return {
    kind: "frame",
    thumbnail: bytes.subarray(uploadFrameHeaderBytes, thumbnailEnd),
    original: bytes.subarray(thumbnailEnd),
  };
}
