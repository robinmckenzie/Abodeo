import { describe, expect, it } from "vitest";

import { identifyUnsupportedFormat } from "./image-sniff";
import { gifBytes, makeJpeg, makePng } from "./test-images";

function bytesOf(...parts: (string | number[])[]) {
  return Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );
}

// An ISO base media file starts with the size of its ftyp box, then its brand.
function isoFile(brand: string) {
  return bytesOf([0, 0, 0, 0x1c], "ftyp", brand, [0, 0, 0, 0], "mif1");
}

describe("identifyUnsupportedFormat", () => {
  it("names WebP, GIF, BMP, HEIC, HEIF, AVIF and TIFF files", () => {
    expect(
      identifyUnsupportedFormat(bytesOf("RIFF", [1, 2, 3, 4], "WEBPVP8 ")),
    ).toBe("WebP");
    expect(identifyUnsupportedFormat(gifBytes)).toBe("GIF");
    expect(identifyUnsupportedFormat(bytesOf("GIF87a", [1, 0, 1, 0]))).toBe(
      "GIF",
    );
    expect(
      identifyUnsupportedFormat(
        bytesOf("BM", [0x46, 0, 0, 0], [0, 0, 0, 0], [0x36, 0, 0, 0]),
      ),
    ).toBe("BMP");
    expect(identifyUnsupportedFormat(isoFile("heic"))).toBe("HEIC");
    expect(identifyUnsupportedFormat(isoFile("heix"))).toBe("HEIC");
    expect(identifyUnsupportedFormat(isoFile("mif1"))).toBe("HEIF");
    expect(identifyUnsupportedFormat(isoFile("avif"))).toBe("AVIF");
    expect(
      identifyUnsupportedFormat(bytesOf([0x49, 0x49, 0x2a, 0], [8, 0, 0, 0])),
    ).toBe("TIFF");
    expect(
      identifyUnsupportedFormat(bytesOf([0x4d, 0x4d, 0, 0x2a], [0, 0, 0, 8])),
    ).toBe("TIFF");
  });

  it("names nothing for JPEG, PNG and unknown bytes", () => {
    expect(identifyUnsupportedFormat(makeJpeg().subarray(0, 16))).toBeNull();
    expect(identifyUnsupportedFormat(makePng().subarray(0, 16))).toBeNull();
    expect(identifyUnsupportedFormat(bytesOf("<svg></svg>"))).toBeNull();
    expect(identifyUnsupportedFormat(bytesOf("BMW owners manual"))).toBeNull();
    expect(identifyUnsupportedFormat(isoFile("mp42"))).toBeNull();
    expect(identifyUnsupportedFormat(new Uint8Array(0))).toBeNull();
  });
});
