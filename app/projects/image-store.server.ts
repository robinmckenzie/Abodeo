// A signed-in account's images, in the project_image and project_image_bytes
// tables of db/account-tables.sql (AD #48 Add Images To Projects). Every
// query is limited to the account it is given, which only the handler
// decides, from the sign-in. Sizes are the ones measured here, never the
// browser's.
import { createHash } from "node:crypto";

import type { Queryable } from "../account/account-profile.server";
import {
  createNeonImageBytesStore,
  type ImageBytesStore,
} from "./image-bytes-store.server";
import {
  accountImageBytes,
  listPageSize,
  type ImageContentType,
  type ImageInfo,
  type ImageKind,
  type ImageListResponse,
} from "./images-api";
import type { TransactionalDatabase } from "./project-store.server";

export type UploadOutcome =
  | { kind: "added" | "existing"; image: ImageInfo; usedBytes: number }
  | { kind: "not-found" }
  // The id is already used for a different image.
  | { kind: "conflict" }
  | { kind: "no-space" }
  // The database as a whole has no room left.
  | { kind: "storage-full" };

export type CaptionOutcome =
  | { kind: "saved"; image: ImageInfo }
  | { kind: "not-found" }
  | { kind: "conflict"; image: ImageInfo };

export type ImageStore = {
  // The newest listPageSize images, or the page before a cursor, oldest
  // first. Null if the account has no such project.
  list(
    userId: string,
    projectId: string,
    before?: { createdAt: string; id: string },
  ): Promise<ImageListResponse | null>;
  // A retry with the same id gives the image already added.
  upload(
    userId: string,
    projectId: string,
    imageId: string,
    contentType: ImageContentType,
    original: Buffer,
    thumbnail: Buffer,
  ): Promise<UploadOutcome>;
  read(
    userId: string,
    projectId: string,
    imageId: string,
    kind: ImageKind,
  ): Promise<{ contentType: ImageContentType; bytes: Buffer } | null>;
  setCaption(
    userId: string,
    projectId: string,
    imageId: string,
    base: string,
    caption: string,
  ): Promise<CaptionOutcome>;
  // The account's used bytes after the removal, or null if there is no such
  // image.
  remove(
    userId: string,
    projectId: string,
    imageId: string,
  ): Promise<{ usedBytes: number } | null>;
};

// How long each statement of an upload may run, and wait for the account's
// other uploads. A 4 MiB insert takes seconds on Neon's free plan.
const uploadTimeout = "30s";

// The time at the database's full precision, so that a page's cursor, built
// from it, never skips an image added in the same millisecond.
const imageColumns = `id, content_type, original_size, caption,
  to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  as created_at`;

// Limits a query on project_image to a project that is not in the Bin
// (AD #62 Delete Projects).
const isShown = `exists (select 1 from project
  where project.user_id = project_image.user_id
  and project.id = project_image.project_id and project.deleted_at is null)`;

const usedBytesQuery = `select coalesce(sum(original_size + thumbnail_size), 0)
  as used from project_image where user_id = $1`;

function readImage(row: Record<string, unknown>): ImageInfo {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    contentType: row.content_type as ImageContentType,
    originalSize: Number(row.original_size),
    caption: String(row.caption),
  };
}

async function readUsedBytes(query: Queryable, userId: string) {
  const { rows } = await query.query(usedBytesQuery, [userId]);
  return Number(rows[0]?.used ?? 0);
}

// Postgres's resource errors, such as a full disk, come in class 53.
function isDatabaseFull(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("53");
}

function hashImage(original: Buffer, thumbnail: Buffer) {
  return createHash("sha256").update(original).update(thumbnail).digest("hex");
}

export function createImageStore(
  database: TransactionalDatabase,
  bytes: ImageBytesStore = createNeonImageBytesStore(database),
): ImageStore {
  const hasProject = async (
    query: Queryable,
    userId: string,
    projectId: string,
  ) => {
    const { rows } = await query.query(
      "select 1 as found from project where user_id = $1 and id = $2 and deleted_at is null",
      [userId, projectId],
    );
    return rows.length > 0;
  };

  const findImage = async (
    query: Queryable,
    userId: string,
    projectId: string,
    imageId: string,
  ) => {
    const { rows } = await query.query(
      `select ${imageColumns}, content_hash from project_image
       where user_id = $1 and project_id = $2 and id = $3`,
      [userId, projectId, imageId],
    );
    return rows[0];
  };

  return {
    async list(userId, projectId, before) {
      if (!(await hasProject(database, userId, projectId))) return null;
      const { rows } = before
        ? await database.query(
            `select ${imageColumns} from project_image
             where user_id = $1 and project_id = $2
             and (created_at, id) < ($3::timestamptz, $4)
             order by created_at desc, id desc limit $5`,
            [userId, projectId, before.createdAt, before.id, listPageSize + 1],
          )
        : await database.query(
            `select ${imageColumns} from project_image
             where user_id = $1 and project_id = $2
             order by created_at desc, id desc limit $3`,
            [userId, projectId, listPageSize + 1],
          );
      const images = rows.slice(0, listPageSize).map(readImage).reverse();
      return {
        images,
        hasOlder: rows.length > listPageSize,
        usedBytes: await readUsedBytes(database, userId),
        limitBytes: accountImageBytes,
      };
    },

    async upload(userId, projectId, imageId, contentType, original, thumbnail) {
      const hash = hashImage(original, thumbnail);
      const client = await database.connect();
      try {
        await client.query("begin", []);
        await client.query(
          `set local statement_timeout = '${uploadTimeout}'`,
          [],
        );
        await client.query(`set local lock_timeout = '${uploadTimeout}'`, []);
        // Held to the end, so that two uploads of one account are not both
        // checked against the allowance before either is added. It does not
        // stop the account's sign-in or project saves.
        await client.query(
          "select id from auth_user where id = $1 for no key update",
          [userId],
        );
        if (!(await hasProject(client, userId, projectId))) {
          await client.query("rollback", []);
          return { kind: "not-found" };
        }
        const existing = await findImage(client, userId, projectId, imageId);
        if (existing) {
          const usedBytes = await readUsedBytes(client, userId);
          await client.query("rollback", []);
          return existing.content_hash === hash
            ? { kind: "existing", image: readImage(existing), usedBytes }
            : { kind: "conflict" };
        }
        const used = await readUsedBytes(client, userId);
        if (used + original.length + thumbnail.length > accountImageBytes) {
          await client.query("rollback", []);
          return { kind: "no-space" };
        }
        const inserted = await client.query(
          `insert into project_image
             (user_id, project_id, id, content_type, original_size,
              thumbnail_size, content_hash)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning ${imageColumns}`,
          [
            userId,
            projectId,
            imageId,
            contentType,
            original.length,
            thumbnail.length,
            hash,
          ],
        );
        await bytes.put(
          client,
          { userId, projectId, imageId },
          original,
          thumbnail,
        );
        await client.query("commit", []);
        return {
          kind: "added",
          image: readImage(inserted.rows[0]),
          usedBytes: used + original.length + thumbnail.length,
        };
      } catch (error) {
        await client.query("rollback", []).catch(() => undefined);
        if (isDatabaseFull(error)) return { kind: "storage-full" };
        throw error;
      } finally {
        client.release();
      }
    },

    async read(userId, projectId, imageId, kind) {
      const { rows } = await database.query(
        `select content_type from project_image
         where user_id = $1 and project_id = $2 and id = $3
         and ${isShown}`,
        [userId, projectId, imageId],
      );
      if (rows.length === 0) return null;
      const data = await bytes.get({ userId, projectId, imageId }, kind);
      if (!data) return null;
      return {
        contentType:
          kind === "thumbnail"
            ? "image/jpeg"
            : (rows[0].content_type as ImageContentType),
        bytes: data,
      };
    },

    async setCaption(userId, projectId, imageId, base, caption) {
      const updated = await database.query(
        `update project_image set caption = $4
         where user_id = $1 and project_id = $2 and id = $3 and caption = $5
         and ${isShown}
         returning ${imageColumns}`,
        [userId, projectId, imageId, caption, base],
      );
      if (updated.rows.length > 0) {
        return { kind: "saved", image: readImage(updated.rows[0]) };
      }
      if (!(await hasProject(database, userId, projectId))) {
        return { kind: "not-found" };
      }
      const current = await findImage(database, userId, projectId, imageId);
      if (!current) return { kind: "not-found" };
      const image = readImage(current);
      // Already what was asked for, as when another device saved it too.
      return image.caption === caption
        ? { kind: "saved", image }
        : { kind: "conflict", image };
    },

    async remove(userId, projectId, imageId) {
      const { rows } = await database.query(
        `delete from project_image
         where user_id = $1 and project_id = $2 and id = $3
         and ${isShown} returning id`,
        [userId, projectId, imageId],
      );
      if (rows.length === 0) return null;
      return { usedBytes: await readUsedBytes(database, userId) };
    },
  };
}
