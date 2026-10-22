// Where an image's bytes are kept (AD #48 Add Images To Projects). Neon holds
// them in project_image_bytes, in the same transaction as the image's
// details. The interface is all the rest of the code knows of it, so that
// the bytes can move to a file store later: the details, caption and sizes
// stay in project_image either way. Removing an image needs no method here,
// as its bytes go with its details.
import type { Queryable } from "../account/account-profile.server";
import type { ImageKind } from "./images-api";

export type ImageKey = {
  userId: string;
  projectId: string;
  imageId: string;
};

export type ImageBytesStore = {
  // Keeps both files, as part of the transaction that adds the details.
  put(
    transaction: Queryable,
    key: ImageKey,
    original: Buffer,
    thumbnail: Buffer,
  ): Promise<void>;
  get(key: ImageKey, kind: ImageKind): Promise<Buffer | null>;
};

export function createNeonImageBytesStore(
  database: Queryable,
): ImageBytesStore {
  return {
    async put(
      transaction,
      { userId, projectId, imageId },
      original,
      thumbnail,
    ) {
      await transaction.query(
        `insert into project_image_bytes
           (user_id, project_id, image_id, kind, data)
         values ($1, $2, $3, 'original', $4), ($1, $2, $3, 'thumbnail', $5)`,
        [userId, projectId, imageId, original, thumbnail],
      );
    },

    // Read as base64 and decoded here: the driver would give bytea as
    // hexadecimal text, twice the size, and Neon limits what it sends.
    async get({ userId, projectId, imageId }, kind) {
      const { rows } = await database.query(
        `select encode(data, 'base64') as data from project_image_bytes
         where user_id = $1 and project_id = $2 and image_id = $3
         and kind = $4`,
        [userId, projectId, imageId, kind],
      );
      const data = rows[0]?.data;
      return typeof data === "string" ? Buffer.from(data, "base64") : null;
    },
  };
}
