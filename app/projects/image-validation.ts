// Checks that a file is a JPEG or PNG whose structure is sound, on the
// server, whatever the browser says. It does not decode pixels: damaged pixel
// data inside a sound structure is stored, in the sender's own account only.
// The browser decodes every file to make its thumbnail, and refuses what it
// cannot decode.
import { crc32 } from "node:zlib";

import { sniffImageType, pngSignature } from "./image-sniff";
import type { ImageContentType } from "./images-api";

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset);
}

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

// Every chunk's length fits the file and its checksum is right, the header
// comes first and has a size, there is image data, and the end chunk is last.
function isSoundPng(bytes: Uint8Array) {
  let offset = pngSignature.length;
  let isFirst = true;
  let hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const checksum = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (checksum !== readUint32(bytes, offset + 8 + length)) return false;
    if (isFirst) {
      if (type !== "IHDR" || length !== 13) return false;
      if (readUint32(bytes, offset + 8) === 0) return false;
      if (readUint32(bytes, offset + 12) === 0) return false;
      isFirst = false;
    } else if (type === "IDAT") {
      hasData = true;
    } else if (type === "IEND") {
      return length === 0 && hasData && end === bytes.length;
    }
    offset = end;
  }
  return false;
}

const startOfImage = 0xd8;
const endOfImage = 0xd9;
const startOfScan = 0xda;

// A marker without a length: a restart, or the temporary marker.
function isStandaloneMarker(marker: number) {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

// A start-of-frame marker, which gives the size.
function isFrameMarker(marker: number) {
  return (
    marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

// Starts with the start of image, and its segments' lengths fit the file, with
// a frame that has a size, a scan, and the end of image last. Trailing zero
// bytes are allowed, as some cameras and editors leave them.
function isSoundJpeg(bytes: Uint8Array) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  while (offset < end) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff && offset < end) offset++;
    const marker = bytes[offset];
    offset++;
    if (marker === endOfImage) return hasFrame && hasScan && offset === end;
    if (marker === startOfImage || marker === 0x00) return false;
    if (isStandaloneMarker(marker)) continue;
    if (offset + 2 > end) return false;
    const length = readUint16(bytes, offset);
    if (length < 2 || offset + length > end) return false;
    if (isFrameMarker(marker)) {
      if (length < 8) return false;
      if (readUint16(bytes, offset + 3) === 0) return false;
      if (readUint16(bytes, offset + 5) === 0) return false;
      hasFrame = true;
    }
    offset += length;
    if (marker === startOfScan) {
      if (!hasFrame) return false;
      hasScan = true;
      // The scan's data runs to the next marker that is not a stuffed zero
      // or a restart.
      while (offset < end) {
        if (bytes[offset] === 0xff) {
          const next = bytes[offset + 1];
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
          offset++;
        }
        offset++;
      }
    }
  }
  return false;
}

// Whether every file is known not to be a JPEG or PNG, going by the media type
// the browser gives it. A file with no type is not known, and may be one.
export function areAllTypesUnsupported(fileTypes: string[]) {
  return (
    fileTypes.length > 0 &&
    fileTypes.every(
      (type) => type !== "" && type !== "image/jpeg" && type !== "image/png",
    )
  );
}

// The image's type if the file is a JPEG or PNG with a sound structure, or
// null.
export function validateImage(bytes: Uint8Array): ImageContentType | null {
  const type = sniffImageType(bytes);
  if (type === "image/png") return isSoundPng(bytes) ? type : null;
  if (type === "image/jpeg") return isSoundJpeg(bytes) ? type : null;
  return null;
}
