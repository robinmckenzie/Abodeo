// Makes an image's thumbnail in the browser, before it is sent (AD #48 Add
// Images To Projects), so that the server needs no image library. Decoding
// the file is also what proves that it is a picture the browser can read.
import { maxThumbnailBytes } from "./images-api";

export type DecodedImage = {
  width: number;
  height: number;
  source: unknown;
  close(): void;
};

// What making a thumbnail needs of the browser, so that tests can stand in
// for it.
export type ThumbnailEnvironment = {
  // Null if the browser cannot read the file as a picture.
  decode(file: Blob): Promise<DecodedImage | null>;
  // A JPEG of the picture at this size, drawn on white so that transparency
  // does not turn black, or null.
  encode(
    image: DecodedImage,
    width: number,
    height: number,
    quality: number,
  ): Promise<Blob | null>;
};

// Each try's longest side in pixels and JPEG quality, until one fits. A
// typical photo fits at the first, at about 20 to 40 KB.
export const thumbnailSteps = [
  { longEdge: 320, quality: 0.8 },
  { longEdge: 320, quality: 0.6 },
  { longEdge: 256, quality: 0.6 },
  { longEdge: 192, quality: 0.5 },
  { longEdge: 128, quality: 0.5 },
  { longEdge: 96, quality: 0.4 },
] as const;

export function fitSize(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export const browserThumbnailEnvironment: ThumbnailEnvironment = {
  async decode(file) {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width === 0 || bitmap.height === 0) {
        bitmap.close();
        return null;
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    } catch {
      return null;
    }
  },
  async encode(image, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image.source as CanvasImageSource, 0, 0, width, height);
    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality),
    );
  },
};

// The thumbnail of a file, or null if the browser cannot read it as a
// picture or no step makes one within the size the server accepts.
export async function makeThumbnail(
  file: Blob,
  environment: ThumbnailEnvironment = browserThumbnailEnvironment,
): Promise<Blob | null> {
  const image = await environment.decode(file);
  if (!image) return null;
  try {
    for (const { longEdge, quality } of thumbnailSteps) {
      const { width, height } = fitSize(image.width, image.height, longEdge);
      const blob = await environment.encode(image, width, height, quality);
      if (
        blob &&
        blob.type === "image/jpeg" &&
        blob.size > 0 &&
        blob.size <= maxThumbnailBytes
      ) {
        return blob;
      }
    }
    return null;
  } finally {
    image.close();
  }
}
