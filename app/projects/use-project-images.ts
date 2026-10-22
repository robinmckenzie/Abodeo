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
  // Why images were refused in the last add, one line each.
  notices: string[];
  isAdding: boolean;
  // The image just added, which the timeline scrolls into view.
  lastAddedId: string | null;
};

type Session = {
  isCurrent: boolean;
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
  fetchFn?: typeof fetch;
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
  notices: [],
  isAdding: false,
  lastAddedId: null,
};

export function useProjectImages({
  accountId,
  projectId,
  onFailure,
  fetchFn = fetch,
  thumbnailEnvironment = browserThumbnailEnvironment,
  createId = () => crypto.randomUUID(),
}: ImagesOptions) {
  const [state, setState] = useState<ProjectImagesState>(initialState);
  const [reloads, setReloads] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const stateRef = useRef(state);
  const optionsRef = useRef({
    onFailure,
    fetchFn,
    thumbnailEnvironment,
    createId,
  });
  useEffect(() => {
    stateRef.current = state;
    optionsRef.current = { onFailure, fetchFn, thumbnailEnvironment, createId };
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
      update(session, (current) => ({
        ...current,
        notices: [describeImageFailure(result.reason)],
      }));
      return null;
    }
    return keepUrl(session, `original:${imageId}`, result.blob);
  };

  const loadOlder = async () => {
    const session = sessionRef.current;
    const first = stateRef.current.images[0];
    if (!session || !first) return;
    const result = await loadImages(
      accountId,
      projectId,
      first,
      optionsRef.current.fetchFn,
    );
    if (!session.isCurrent) return;
    if (!result.ok) {
      fail(result.reason);
      update(session, (current) => ({
        ...current,
        notices: [describeImageFailure(result.reason)],
      }));
      return;
    }
    update(session, (current) => ({
      ...current,
      images: [...result.page.images, ...current.images],
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
  ) => {
    for (let attempt = 0; ; attempt++) {
      const result = await uploadImage(
        accountId,
        projectId,
        id,
        thumbnail,
        original,
        optionsRef.current.fetchFn,
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

  const addFiles = async (files: File[]) => {
    const session = sessionRef.current;
    if (!session || files.length === 0) return;
    update(session, (current) => ({ ...current, isAdding: true, notices: [] }));
    const refused: RefusedImage[] = [];
    let usedBytes = stateRef.current.usedBytes;
    for (const file of files) {
      if (!session.isCurrent) return;
      const refuse = (reason: ImageFailure) => {
        refused.push({ name: file.name, reason });
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
          break;
        }
        continue;
      }
      usedBytes = result.usedBytes;
      const { image } = result;
      const url = keepUrl(session, `thumbnail:${image.id}`, thumbnail);
      update(session, (current) => ({
        ...current,
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
    update(session, (current) => ({
      ...current,
      isAdding: false,
      notices: describeRefusals(refused),
    }));
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
      update(session, (current) => ({
        ...current,
        notices: [describeImageFailure(result.reason)],
      }));
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

  const clearNotices = () =>
    setState((current) => ({ ...current, notices: [] }));

  return {
    state,
    addFiles,
    loadOlder,
    requestThumbnail,
    openOriginal,
    changeCaption,
    remove,
    reload,
    clearNotices,
  };
}
