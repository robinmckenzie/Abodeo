import { describe, expect, it, vi } from "vitest";

import { maxThumbnailBytes } from "./images-api";
import {
  fitSize,
  makeThumbnail,
  thumbnailSteps,
  type DecodedImage,
  type ThumbnailEnvironment,
} from "./thumbnail";

function jpeg(size: number) {
  return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
}

function createEnvironment(
  sizes: (step: number) => number,
  image: Pick<DecodedImage, "width" | "height"> = { width: 4000, height: 3000 },
) {
  const close = vi.fn();
  let step = 0;
  const encoded: { width: number; height: number; quality: number }[] = [];
  const environment: ThumbnailEnvironment = {
    decode: async () => ({ ...image, source: {}, close }),
    encode: async (_image, width, height, quality) => {
      encoded.push({ width, height, quality });
      return jpeg(sizes(step++));
    },
  };
  return { environment, encoded, close };
}

describe("fitSize", () => {
  it("scales the longer side to the limit, keeping the proportions", () => {
    expect(fitSize(4000, 3000, 320)).toEqual({ width: 320, height: 240 });
    expect(fitSize(3000, 4000, 320)).toEqual({ width: 240, height: 320 });
  });

  it("does not enlarge a small image, or make a side zero", () => {
    expect(fitSize(100, 50, 320)).toEqual({ width: 100, height: 50 });
    expect(fitSize(10000, 1, 320)).toEqual({ width: 320, height: 1 });
  });
});

describe("makeThumbnail", () => {
  it("uses the first step when it fits, and lets go of the picture", async () => {
    const { environment, encoded, close } = createEnvironment(() => 30_000);
    const blob = await makeThumbnail(new Blob(["x"]), environment);
    expect(blob?.size).toBe(30_000);
    expect(encoded).toEqual([{ width: 320, height: 240, quality: 0.8 }]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("tries smaller and lower quality steps until one is within the limit", async () => {
    const { environment, encoded } = createEnvironment((step) =>
      step < 3 ? maxThumbnailBytes + 1 : maxThumbnailBytes,
    );
    const blob = await makeThumbnail(new Blob(["x"]), environment);
    expect(blob?.size).toBe(maxThumbnailBytes);
    expect(encoded).toHaveLength(4);
    expect(encoded[3].width).toBeLessThan(encoded[0].width);
  });

  it("gives up after the last step", async () => {
    const { environment, encoded, close } = createEnvironment(
      () => maxThumbnailBytes + 1,
    );
    expect(await makeThumbnail(new Blob(["x"]), environment)).toBeNull();
    expect(encoded).toHaveLength(thumbnailSteps.length);
    expect(close).toHaveBeenCalledOnce();
  });

  it("gives nothing for a file the browser cannot read", async () => {
    const environment: ThumbnailEnvironment = {
      decode: async () => null,
      encode: async () => jpeg(1),
    };
    expect(await makeThumbnail(new Blob(["x"]), environment)).toBeNull();
  });

  it("refuses an empty result or one that is not a JPEG", async () => {
    const empty = createEnvironment(() => 0);
    expect(await makeThumbnail(new Blob(["x"]), empty.environment)).toBeNull();
    const png: ThumbnailEnvironment = {
      decode: async () => ({ width: 1, height: 1, source: {}, close() {} }),
      encode: async () => new Blob(["x"], { type: "image/png" }),
    };
    expect(await makeThumbnail(new Blob(["x"]), png)).toBeNull();
  });
});
