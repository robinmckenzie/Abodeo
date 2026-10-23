// The images of one account project, for as long as the project is open
// (AD #48 Add Images To Projects). Mount it for one account and project, and
// with a key that changes with either: when it unmounts, everything of it is
// let go. Images and their blob URLs are only ever held in memory, never in
// browser storage, so that signing out or changing account leaves nothing of
// them behind. Anything that arrives after that is dropped, and no blob URL
// is made for it.
import { useCallback, useEffect, useRef, useState } from "react";

import { sniffImageType } from "./image-sniff";
import {
  describeImageFailure,
  describeRefusals,
  type RefusedImage,
} from "./image-messages";
import {
  countCharacters,
  maxCaptionLength,
  maxImageBytes,
  type ImageInfo,
} from "./images-api";
import {
  fetchImageFile,
  loadImages,
  removeImage,
  saveCaption,
  type CaptionResult,
  uploadImage,
  type ImageFailure,
  type UploadTransport,
} from "./images-client";
import {
  browserThumbnailEnvironment,
  makeThumbnail,
  type ThumbnailEnvironment,
} from "./thumbnail";

// How many thumbnails are fetched at once.
export const thumbnailConcurrency = 4;

// How many times an upload is sent after the first, when no answer came.
const resendAttempts = 1;

export type ProjectImagesState = {
  status: "loading" | "ready" | "unavailable";
  images: ImageInfo[];
  hasOlder: boolean;
  usedBytes: number;
  limitBytes: number;
  // Blob URLs of the thumbnails fetched or made so far, by image id.
  thumbnails: Record<string, string>;
  // The files being added, in drop order, each shown as a placeholder until
  // it is replaced by its image or removed.
  pending: PendingImage[];
  isAdding: boolean;
  // The image just added, which the timeline scrolls into view.
  lastAddedId: string | null;
};

export type PendingImage = {
  key: string;
  name: string;
  // How much of the upload has gone, from 0 to 1, or null where unknown.
  progress: number | null;
};

type Session = {
  isCurrent: boolean;
  // The batches of files added run one after another, so that images and
  // their placeholders keep their order.
  batches: Promise<void>;
  batchCount: number;
  nextPendingKey: number;
  // Blob URLs made in this session, by "thumbnail:id" or "original:id".
  urls: Map<string, string>;
  queued: string[];
  requested: Set<string>;
  active: number;
};

export type ImagesOptions = {
  accountId: string;
  projectId: string;
  // A failure that means the sign-in has changed, for the dashboard to check.
  onFailure?: (reason: ImageFailure) => void;
  // Says something to the person, for the floating messages.
  onMessage?: (text: string) => void;
  fetchFn?: typeof fetch;
  uploadFn?: UploadTransport;
  thumbnailEnvironment?: ThumbnailEnvironment;
  createId?: () => string;
};

const initialState: ProjectImagesState = {
  status: "loading",
  images: [],
  hasOlder: false,
  usedBytes: 0,
  limitBytes: 0,
  thumbnails: {},
  pending: [],
  isAdding: false,
  lastAddedId: null,
};

export function useProjectImages({
  accountId,
  projectId,
  onFailure,
  onMessage,
  fetchFn = fetch,
  uploadFn,
  thumbnailEnvironment = browserThumbnailEnvironment,
  createId = () => crypto.randomUUID(),
}: ImagesOptions) {
  const [state, setState] = useState<ProjectImagesState>(initialState);
  const [reloads, setReloads] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const stateRef = useRef(state);
  const optionsRef = useRef({
    onFailure,
    onMessage,
    fetchFn,
    uploadFn,
    thumbnailEnvironment,
    createId,
  });
  useEffect(() => {
    stateRef.current = state;
    optionsRef.current = {
      onFailure,
      onMessage,
      fetchFn,
      uploadFn,
      thumbnailEnvironment,
      createId,
    };
  });

  const update = useCallback(
    (
      session: Session,
      change: (state: ProjectImagesState) => ProjectImagesState,
    ) => {
      if (session.isCurrent) setState(change);
    },
    [],
  );

  // A blob URL for the bytes, kept until the session ends, or null if the
  // session has ended, in which case none is made.
  const keepUrl = (session: Session, key: string, blob: Blob) => {
    if (!session.isCurrent) return null;
    const existing = session.urls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    session.urls.set(key, url);
    return url;
  };

  const forgetUrls = (session: Session, imageId: string) => {
    for (const kind of ["thumbnail", "original"]) {
      const key = `${kind}:${imageId}`;
      const url = session.urls.get(key);
      if (url) URL.revokeObjectURL(url);
      session.urls.delete(key);
    }
    session.requested.delete(imageId);
  };

  useEffect(() => {
    const session: Session = {
      isCurrent: true,
      batches: Promise.resolve(),
      batchCount: 0,
      nextPendingKey: 0,
      urls: new Map(),
      queued: [],
      requested: new Set(),
      active: 0,
    };
    sessionRef.current = session;
    void loadImages(
      accountId,
      projectId,
      null,
      optionsRef.current.fetchFn,
    ).then((result) => {
      if (!session.isCurrent) return;
      if (!result.ok) {
        optionsRef.current.onFailure?.(result.reason);
        setState((current) => ({ ...current, status: "unavailable" }));
        return;
      }
      setState((current) => ({
        ...current,
        status: "ready",
        images: result.page.images,
        hasOlder: result.page.hasOlder,
        usedBytes: result.page.usedBytes,
        limitBytes: result.page.limitBytes,
      }));
    });
    return () => {
      session.isCurrent = false;
      session.urls.forEach((url) => URL.revokeObjectURL(url));
      session.urls.clear();
      session.queued = [];
      sessionRef.current = null;
    };
  }, [accountId, projectId, reloads]);

  const fail = (reason: ImageFailure) => optionsRef.current.onFailure?.(reason);
  const say = (text: string) => optionsRef.current.onMessage?.(text);

  const pumpThumbnails = (session: Session) => {
    while (session.active < thumbnailConcurrency && session.queued.length > 0) {
      // The newest first, as the timeline opens at the bottom.
      const imageId = session.queued.pop()!;
      session.active++;
      void fetchImageFile(
        accountId,
        projectId,
        imageId,
        "thumbnail",
        optionsRef.current.fetchFn,
      ).then((result) => {
        session.active--;
        if (!session.isCurrent) return;
        if (result.ok) {
          const url = keepUrl(session, `thumbnail:${imageId}`, result.blob);
          if (url) {
            update(session, (current) => ({
              ...current,
              thumbnails: { ...current.thumbnails, [imageId]: url },
            }));
          }
        } else {
          session.requested.delete(imageId);
          fail(result.reason);
        }
        pumpThumbnails(session);
      });
    }
  };

  const requestThumbnail = useCallback(
    (imageId: string) => {
      const session = sessionRef.current;
      if (!session || session.requested.has(imageId)) return;
      session.requested.add(imageId);
      session.queued.push(imageId);
      pumpThumbnails(session);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId, projectId],
  );

  // The full-size image as a blob URL, or null with a notice.
  const openOriginal = async (imageId: string) => {
    const session = sessionRef.current;
    if (!session) return null;
    const known = session.urls.get(`original:${imageId}`);
    if (known) return known;
    const result = await fetchImageFile(
      accountId,
      projectId,
      imageId,
      "original",
      optionsRef.current.fetchFn,
    );
    if (!session.isCurrent) return null;
    if (!result.ok) {
      fail(result.reason);
      say(describeImageFailure(result.reason));
      return null;
    }
    return keepUrl(session, `original:${imageId}`, result.blob);
  };

  const isLoadingOlderRef = useRef(false);

  const loadOlder = async () => {
    const session = sessionRef.current;
    const first = stateRef.current.images[0];
    if (!session || !first || isLoadingOlderRef.current) return;
    isLoadingOlderRef.current = true;
    const result = await loadImages(
      accountId,
      projectId,
      first,
      optionsRef.current.fetchFn,
    ).finally(() => {
      isLoadingOlderRef.current = false;
    });
    if (!session.isCurrent) return;
    if (!result.ok) {
      fail(result.reason);
      say(describeImageFailure(result.reason));
      return;
    }
    update(session, (current) => ({
      ...current,
      images: [
        ...result.page.images.filter(
          ({ id }) => !current.images.some((image) => image.id === id),
        ),
        ...current.images,
      ],
      hasOlder: result.page.hasOlder,
      usedBytes: result.page.usedBytes,
    }));
  };

  // Sends one image, finding out whether an upload with no answer arrived
  // before sending it again with the same id.
  const sendOne = async (
    session: Session,
    id: string,
    thumbnail: Uint8Array,
    original: Uint8Array,
    onProgress: (fraction: number | null) => void,
  ) => {
    for (let attempt = 0; ; attempt++) {
      // A resend starts again from the beginning.
      onProgress(null);
      const result = await uploadImage(
        accountId,
        projectId,
        id,
        thumbnail,
        original,
        optionsRef.current.uploadFn,
        onProgress,
      );
      if (result.ok) return result;
      if (result.reason !== "unreachable" || !session.isCurrent) return result;
      const list = await loadImages(
        accountId,
        projectId,
        null,
        optionsRef.current.fetchFn,
      );
      const found =
        list.ok && list.page.images.find((image) => image.id === id);
      if (list.ok && found) {
        return {
          ok: true as const,
          image: found,
          usedBytes: list.page.usedBytes,
        };
      }
      if (attempt >= resendAttempts) return result;
    }
  };

  // Adds the files one after another. Each shows as a placeholder from the
  // start, and loses it when it is refused or fails, or gives it up to its
  // image. What was refused is said when the batch ends.
  const runBatch = async (
    session: Session,
    files: File[],
    entries: PendingImage[],
  ) => {
    const refused: RefusedImage[] = [];
    const removeEntries = (removed: PendingImage[]) =>
      update(session, (current) => ({
        ...current,
        pending: current.pending.filter(
          ({ key }) => !removed.some((entry) => entry.key === key),
        ),
      }));
    let usedBytes = stateRef.current.usedBytes;
    for (const [position, file] of files.entries()) {
      if (!session.isCurrent) return;
      const entry = entries[position];
      const refuse = (reason: ImageFailure) => {
        refused.push({ name: file.name, reason });
        removeEntries([entry]);
      };
      // A folder, or a file that cannot be read, is not an image.
      const head = await file
        .slice(0, 16)
        .arrayBuffer()
        .then((buffer) => new Uint8Array(buffer))
        .catch(() => null);
      if (!head || sniffImageType(head) === null) {
        refuse("unsupported-format");
        continue;
      }
      if (file.size > maxImageBytes) {
        refuse("too-large");
        continue;
      }
      const limit = stateRef.current.limitBytes;
      if (limit > 0 && usedBytes + file.size > limit) {
        refuse("no-space");
        continue;
      }
      const thumbnail = await makeThumbnail(
        file,
        optionsRef.current.thumbnailEnvironment,
      );
      if (!thumbnail) {
        refuse("unsupported-format");
        continue;
      }
      const result = await sendOne(
        session,
        optionsRef.current.createId(),
        new Uint8Array(await thumbnail.arrayBuffer()),
        new Uint8Array(await file.arrayBuffer()),
        (progress) =>
          update(session, (current) => ({
            ...current,
            pending: current.pending.map((other) =>
              other.key === entry.key ? { ...other, progress } : other,
            ),
          })),
      );
      if (!session.isCurrent) return;
      if (!result.ok) {
        fail(result.reason);
        refuse(result.reason);
        // Anything else would meet the same problem.
        if (
          result.reason === "signed-out" ||
          result.reason === "account-changed" ||
          result.reason === "unreachable"
        ) {
          // Name the files that were not tried, rather than skip them.
          for (const skipped of files.slice(position + 1)) {
            refused.push({ name: skipped.name, reason: result.reason });
          }
          removeEntries(entries.slice(position + 1));
          break;
        }
        continue;
      }
      usedBytes = result.usedBytes;
      const { image } = result;
      const url = keepUrl(session, `thumbnail:${image.id}`, thumbnail);
      update(session, (current) => ({
        ...current,
        pending: current.pending.filter(({ key }) => key !== entry.key),
        images: current.images.some(({ id }) => id === image.id)
          ? current.images
          : [...current.images, image],
        usedBytes: result.usedBytes,
        thumbnails: url
          ? { ...current.thumbnails, [image.id]: url }
          : current.thumbnails,
        lastAddedId: image.id,
      }));
      session.requested.add(image.id);
    }
    if (session.isCurrent) describeRefusals(refused).forEach(say);
  };

  const addFiles = async (files: File[]) => {
    const session = sessionRef.current;
    if (!session || files.length === 0) return;
    const entries: PendingImage[] = files.map((file) => ({
      key: String(session.nextPendingKey++),
      name: file.name,
      progress: null,
    }));
    session.batchCount++;
    update(session, (current) => ({
      ...current,
      isAdding: true,
      pending: [...current.pending, ...entries],
    }));
    const batch = session.batches.then(() => runBatch(session, files, entries));
    session.batches = batch.catch(() => {});
    try {
      await batch;
    } catch {
      // Something unexpected, such as a file that could not be read: the
      // files not yet added are not added.
      if (session.isCurrent) say(describeImageFailure("unreachable"));
    } finally {
      session.batchCount--;
      update(session, (current) => ({
        ...current,
        isAdding: session.batchCount > 0,
        pending: current.pending.filter(
          ({ key }) => !entries.some((entry) => entry.key === key),
        ),
      }));
    }
  };

  const changeCaption = async (
    image: ImageInfo,
    caption: string,
  ): Promise<CaptionResult> => {
    const session = sessionRef.current;
    if (!session) return { ok: false, reason: "unreachable" };
    if (countCharacters(caption) > maxCaptionLength) {
      return { ok: false, reason: "caption-too-long" };
    }
    const result = await saveCaption(
      accountId,
      projectId,
      image.id,
      image.caption,
      caption,
      optionsRef.current.fetchFn,
    );
    if (!session.isCurrent) return { ok: false, reason: "account-changed" };
    const saved =
      result.ok || result.reason === "conflict" ? result.image : null;
    if (saved) {
      update(session, (current) => ({
        ...current,
        images: current.images.map((entry) =>
          entry.id === saved.id ? saved : entry,
        ),
      }));
    } else if (!result.ok) {
      fail(result.reason);
    }
    return result;
  };

  const remove = async (imageId: string) => {
    const session = sessionRef.current;
    if (!session) return false;
    const result = await removeImage(
      accountId,
      projectId,
      imageId,
      optionsRef.current.fetchFn,
    );
    if (!session.isCurrent) return false;
    // Already gone counts as removed.
    if (!result.ok && result.reason !== "not-found") {
      fail(result.reason);
      say(describeImageFailure(result.reason));
      return false;
    }
    forgetUrls(session, imageId);
    update(session, (current) => {
      const { [imageId]: _removed, ...thumbnails } = current.thumbnails;
      void _removed;
      return {
        ...current,
        images: current.images.filter(({ id }) => id !== imageId),
        thumbnails,
        usedBytes: result.ok ? result.usedBytes : current.usedBytes,
      };
    });
    return true;
  };

  const reload = () => {
    setState(initialState);
    setReloads((count) => count + 1);
  };

  return {
    state,
    addFiles,
    loadOlder,
    requestThumbnail,
    openOriginal,
    changeCaption,
    remove,
    reload,
  };
}
