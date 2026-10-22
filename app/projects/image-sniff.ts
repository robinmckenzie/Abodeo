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
