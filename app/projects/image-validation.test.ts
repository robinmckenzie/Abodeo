// @vitest-environment node
import { describe, expect, it } from "vitest";

import { areAllTypesUnsupported, validateImage } from "./image-validation";
import { gifBytes, makeJpeg, makePng } from "./test-images";

describe("areAllTypesUnsupported", () => {
  it("is true only when every file is known to be neither a JPEG nor a PNG", () => {
    expect(areAllTypesUnsupported(["text/plain"])).toBe(true);
    expect(
      areAllTypesUnsupported(["application/x-msdownload", "image/gif"]),
    ).toBe(true);
    expect(areAllTypesUnsupported(["text/plain", "image/png"])).toBe(false);
    expect(areAllTypesUnsupported(["text/plain", ""])).toBe(false);
    expect(areAllTypesUnsupported([""])).toBe(false);
    expect(areAllTypesUnsupported([])).toBe(false);
  });
});

describe("validateImage", () => {
  it("accepts a sound PNG and JPEG", () => {
    expect(validateImage(makePng())).toBe("image/png");
    expect(validateImage(makeJpeg())).toBe("image/jpeg");
  });

  it("accepts files of exactly 4 MiB", () => {
    const size = 4 * 1024 * 1024;
    expect(makePng(size).length).toBe(size);
    expect(makeJpeg(size).length).toBe(size);
    expect(validateImage(makePng(size))).toBe("image/png");
    expect(validateImage(makeJpeg(size))).toBe("image/jpeg");
  });

  it("accepts a JPEG with trailing zero bytes", () => {
    expect(validateImage(Uint8Array.from([...makeJpeg(), 0, 0, 0]))).toBe(
      "image/jpeg",
    );
  });

  it("refuses other formats and empty files, whatever they are called", () => {
    expect(validateImage(gifBytes)).toBeNull();
    expect(validateImage(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(validateImage(new TextEncoder().encode("RIFF....WEBP"))).toBeNull();
    expect(validateImage(new Uint8Array(0))).toBeNull();
  });

  it("refuses a truncated PNG", () => {
    const png = makePng();
    expect(validateImage(png.subarray(0, png.length - 5))).toBeNull();
    expect(validateImage(png.subarray(0, 20))).toBeNull();
  });

  it("refuses a PNG with a bad checksum", () => {
    const png = makePng().slice();
    png[20] ^= 0xff;
    expect(validateImage(png)).toBeNull();
  });

  it("refuses a PNG with bytes after the end chunk or no image data", () => {
    expect(validateImage(Uint8Array.from([...makePng(), 1]))).toBeNull();
    const png = makePng();
    const noData = Uint8Array.from([
      ...png.subarray(0, 33),
      ...png.subarray(-12),
    ]);
    expect(validateImage(noData)).toBeNull();
  });

  it("refuses a PNG that is zero pixels wide", () => {
    const png = makePng().slice();
    png.fill(0, 16, 20);
    expect(validateImage(png)).toBeNull();
  });

  it("refuses a JPEG with no scan, no frame or no end", () => {
    const jpeg = makeJpeg();
    // Without the scan: start, frame, end.
    expect(
      validateImage(Uint8Array.from([...jpeg.subarray(0, 15), 0xff, 0xd9])),
    ).toBeNull();
    // Without the end.
    expect(validateImage(jpeg.subarray(0, jpeg.length - 2))).toBeNull();
    // Without the frame.
    expect(
      validateImage(
        Uint8Array.from([...jpeg.subarray(0, 2), ...jpeg.subarray(15)]),
      ),
    ).toBeNull();
  });

  it("refuses a JPEG whose frame has no size or whose segment overruns", () => {
    const noSize = makeJpeg().slice();
    noSize[7] = 0;
    noSize[8] = 0;
    expect(validateImage(noSize)).toBeNull();
    const overrun = makeJpeg().slice();
    overrun[5] = 0xff;
    expect(validateImage(overrun)).toBeNull();
  });
});
