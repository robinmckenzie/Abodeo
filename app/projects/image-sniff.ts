// What an image is, from its first bytes, never from its name or the type
// the browser declared. Both sides use it, so it uses no Node or browser API.
import type { ImageContentType } from "./images-api";

export const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, pngSignature)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

// The ISO base media file brands that name a HEIC, HEIF or AVIF picture.
const isoBrandFormats: Record<string, string> = {
  heic: "HEIC",
  heix: "HEIC",
  heim: "HEIC",
  heis: "HEIC",
  hevc: "HEIC",
  hevx: "HEIC",
  mif1: "HEIF",
  msf1: "HEIF",
  avif: "AVIF",
  avis: "AVIF",
};

function readText(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

// The name of a recognised image format other than JPEG or PNG, from the
// file's first 16 bytes, so that a refusal can say what the file is (AD #53).
// Null for JPEG, PNG and anything not recognised.
export function identifyUnsupportedFormat(bytes: Uint8Array): string | null {
  if (bytes.length >= 12) {
    if (readText(bytes, 0, 4) === "RIFF" && readText(bytes, 8, 12) === "WEBP")
      return "WebP";
    if (readText(bytes, 4, 8) === "ftyp") {
      const format = isoBrandFormats[readText(bytes, 8, 12)];
      if (format) return format;
    }
  }
  const signature = readText(bytes, 0, 6);
  if (signature === "GIF87a" || signature === "GIF89a") return "GIF";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00])) return "TIFF";
  if (startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "TIFF";
  // "BM" alone is too common in other files, so the reserved bytes, which are
  // zero, are checked too.
  if (startsWith(bytes, [0x42, 0x4d]) && bytes.length >= 14) {
    if (startsWith(bytes.subarray(6, 10), [0, 0, 0, 0])) return "BMP";
  }
  return null;
}
