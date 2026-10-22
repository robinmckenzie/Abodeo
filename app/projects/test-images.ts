// Helpers for the images tests: small files with a sound structure, of an
// exact size where one is asked for. Only the server's structural checks
// read them, so the JPEGs have no real picture in them.
import { crc32, deflateSync } from "node:zlib";

import { pngSignature } from "./image-sniff";

function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

function join(parts: Uint8Array[]) {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

// A one-pixel PNG, padded with a text chunk to totalSize bytes if given.
export function makePng(totalSize?: number) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(pngSignature),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Uint8Array.from([0, 255, 0, 0]))),
  ];
  const end = chunk("IEND", new Uint8Array(0));
  const size = join([...parts, end]).length;
  if (totalSize !== undefined) {
    // A chunk adds 12 bytes of its own.
    parts.push(chunk("tEXt", new Uint8Array(totalSize - size - 12)));
  }
  return join([...parts, end]);
}

// A JPEG with a frame and a scan and no real picture, whose scan is padded
// to totalSize bytes if given.
export function makeJpeg(totalSize?: number) {
  const start = [0xff, 0xd8];
  const frame = [0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0];
  const scanHeader = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0];
  const end = [0xff, 0xd9];
  const fixed = start.length + frame.length + scanHeader.length + end.length;
  const scan = new Uint8Array(Math.max(4, (totalSize ?? fixed + 4) - fixed));
  scan.fill(0x2a);
  return join([
    Uint8Array.from([...start, ...frame, ...scanHeader]),
    scan,
    Uint8Array.from(end),
  ]);
}

export const gifBytes = new TextEncoder().encode(
  "GIF89a\u0001\u0000\u0001\u0000",
);
