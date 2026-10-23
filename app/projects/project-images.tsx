// An opened account project's images, as a journal-style timeline (AD #48
// Add Images To Projects): oldest at the top, newest at the bottom, each with
// the time it was added and a caption. Signed out, a project has none, and
// this says so in place of the button to add them.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { raiseFloatingMessages } from "./floating-messages";
import {
  captionChangedElsewhereMessage,
  captionTooLongMessage,
  describeImageFailure,
  signInToAddMessage,
} from "./image-messages";
import {
  countCharacters,
  maxCaptionLength,
  type ImageInfo,
} from "./images-api";
import type { ImageFailure, UploadTransport } from "./images-client";
import { fitHeightToText } from "./task-list";
import { useProjectImages, type PendingImage } from "./use-project-images";

// What the dashboard calls to add files dropped on the page.
export type AddFiles = (files: File[]) => void;

export function formatAddedTime(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProjectImages({
  accountId,
  projectId,
  onFailure,
  onMessage,
  uploadFn,
  addFilesRef,
  onLatestImageChange,
}: {
  // Null while signed out, when images are unavailable.
  accountId: string | null;
  projectId: string;
  onFailure?: (reason: ImageFailure) => void;
  // Says something to the person, as a floating message.
  onMessage?: (text: string) => void;
  uploadFn?: UploadTransport;
  addFilesRef?: RefObject<AddFiles | null>;
  // Given the newest image's id (null when none) once the images have
  // loaded, and again whenever it changes, for the project's bar.
  onLatestImageChange?: (imageId: string | null) => void;
}) {
  if (accountId === null) {
    return (
      <section className="project-images" aria-label="Images">
        <h3 className="task-heading">Images</h3>
        <p className="project-images-note">{signInToAddMessage}</p>
      </section>
    );
  }
  // Keyed, so that a change of account or project starts again, and nothing
  // of the earlier one is left.
  return (
    <SignedInImages
      key={`${accountId}/${projectId}`}
      accountId={accountId}
      projectId={projectId}
      onFailure={onFailure}
      onMessage={onMessage}
      uploadFn={uploadFn}
      addFilesRef={addFilesRef}
      onLatestImageChange={onLatestImageChange}
    />
  );
}

function SignedInImages({
  accountId,
  projectId,
  onFailure,
  onMessage,
  uploadFn,
  addFilesRef,
  onLatestImageChange,
}: {
  accountId: string;
  projectId: string;
  onFailure?: (reason: ImageFailure) => void;
  onMessage?: (text: string) => void;
  uploadFn?: UploadTransport;
  addFilesRef?: RefObject<AddFiles | null>;
  onLatestImageChange?: (imageId: string | null) => void;
}) {
  const images = useProjectImages({
    accountId,
    projectId,
    onFailure,
    onMessage,
    uploadFn,
  });
  const { state } = images;
  const onLatestRef = useRef(onLatestImageChange);
  useEffect(() => {
    onLatestRef.current = onLatestImageChange;
  });
  const latestImageId = state.images.at(-1)?.id ?? null;
  useEffect(() => {
    if (state.status === "ready") onLatestRef.current?.(latestImageId);
  }, [state.status, latestImageId]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [viewing, setViewing] = useState<{
    imageId: string;
    url: string;
    label: string;
    caption: string;
    createdAt: string;
  } | null>(null);

  const addFiles = images.addFiles;
  useEffect(() => {
    if (!addFilesRef) return;
    addFilesRef.current = (files) => void addFiles(files);
    return () => {
      addFilesRef.current = null;
    };
  });

  // Opens at the bottom, where the newest image is.
  const isScrolledRef = useRef(false);
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (state.status !== "ready" || isScrolledRef.current || !timeline) return;
    isScrolledRef.current = true;
    timeline.scrollTop = timeline.scrollHeight;
  }, [state.status]);

  useLayoutEffect(() => {
    if (!state.lastAddedId) return;
    timelineRef.current
      ?.querySelector(`[data-image-id="${state.lastAddedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [state.lastAddedId]);

  const showOlder = async () => {
    const timeline = timelineRef.current;
    const before = timeline?.scrollHeight ?? 0;
    await images.loadOlder();
    requestAnimationFrame(() => {
      if (timeline) timeline.scrollTop += timeline.scrollHeight - before;
    });
  };

  // Only the latest request may open the viewer, and dismissing it cancels
  // any still downloading.
  const viewRequestRef = useRef(0);
  const view = async (image: ImageInfo) => {
    const request = ++viewRequestRef.current;
    const url = await images.openOriginal(image.id);
    if (url && request === viewRequestRef.current) {
      setViewing({
        imageId: image.id,
        url,
        label: describeImage(image),
        caption: image.caption,
        createdAt: image.createdAt,
      });
    }
  };

  // With more than one image, the full-size view steps through them, oldest
  // to newest, as the timeline reads from top to bottom. It stops at the
  // ends of those loaded.
  const viewingIndex = viewing
    ? state.images.findIndex(({ id }) => id === viewing.imageId)
    : -1;
  const previousImage = state.images[viewingIndex - 1];
  const nextImage = state.images[viewingIndex + 1];

  return (
    <section className="project-images" aria-label="Images">
      <div className="project-images-header">
        <h3 className="task-heading">Images</h3>
        <button
          type="button"
          className="project-images-add"
          disabled={state.status !== "ready" || state.isAdding}
          aria-label={state.isAdding ? "Adding images" : "Add image"}
          title="Add image"
          onClick={() => inputRef.current?.click()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8.5" />
            <path d="M5.5 10h9M10 5.5v9" />
          </svg>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void images.addFiles(files);
          }}
        />
      </div>
      {state.status === "unavailable" && (
        <p className="project-images-note" role="alert">
          Abodeo cannot reach your images right now.{" "}
          <button type="button" onClick={images.reload}>
            Try again
          </button>
        </p>
      )}
      {state.status === "loading" && (
        <p className="project-images-note">Loading images…</p>
      )}
      {state.status === "ready" &&
        state.images.length === 0 &&
        state.pending.length === 0 && (
          <p className="project-images-note">
            No images yet. Choose Add image, or drop pictures here.
          </p>
        )}
      <div
        ref={timelineRef}
        className="image-timeline"
        hidden={state.images.length === 0 && state.pending.length === 0}
      >
        {state.hasOlder && (
          <button
            type="button"
            className="image-timeline-older"
            onClick={() => void showOlder()}
          >
            Show older images
          </button>
        )}
        {state.images.map((image) => (
          <ImageEntry
            key={image.id}
            image={image}
            thumbnailUrl={state.thumbnails[image.id]}
            onVisible={() => images.requestThumbnail(image.id)}
            onView={() => void view(image)}
            onRemove={() => {
              if (window.confirm("Remove this image? It cannot be undone.")) {
                void images.remove(image.id);
              }
            }}
            onCaption={images.changeCaption}
          />
        ))}
        {state.pending.map((entry) => (
          <PendingEntry key={entry.key} entry={entry} />
        ))}
      </div>
      {viewing &&
        createPortal(
          <ImageViewer
            url={viewing.url}
            label={viewing.label}
            caption={viewing.caption}
            createdAt={viewing.createdAt}
            navigation={
              state.images.length > 1 && viewingIndex >= 0
                ? {
                    onPrevious: previousImage
                      ? () => void view(previousImage)
                      : null,
                    onNext: nextImage ? () => void view(nextImage) : null,
                  }
                : undefined
            }
            onClose={() => {
              viewRequestRef.current++;
              setViewing(null);
            }}
          />,
          document.body,
        )}
    </section>
  );
}

// A file being added, where its image will be: a spinner, which fills as the
// upload goes where the browser can tell, and the file's name.
function PendingEntry({ entry }: { entry: PendingImage }) {
  const length = 2 * Math.PI * 14;
  return (
    <div
      className="image-pending-entry"
      role="status"
      aria-label={`Adding ${entry.name}`}
    >
      <div className="image-entry-thumbnail image-entry-pending-thumbnail">
        <svg
          viewBox="0 0 32 32"
          className={
            entry.progress === null
              ? "image-entry-spinner is-spinning"
              : "image-entry-spinner"
          }
          aria-hidden="true"
        >
          <circle
            className="image-entry-spinner-track"
            cx="16"
            cy="16"
            r="14"
          />
          <circle
            className="image-entry-spinner-arc"
            cx="16"
            cy="16"
            r="14"
            strokeDasharray={length}
            strokeDashoffset={length * (1 - (entry.progress ?? 0.25))}
          />
        </svg>
      </div>
      <div className="image-entry-details">
        <p className="image-entry-pending-name" title={entry.name}>
          {entry.name}
        </p>
      </div>
    </div>
  );
}

function describeImage(image: ImageInfo) {
  const time = formatAddedTime(image.createdAt);
  return image.caption || (time ? `Image added ${time}` : "Image");
}

function ImageEntry({
  image,
  thumbnailUrl,
  onVisible,
  onView,
  onRemove,
  onCaption,
}: {
  image: ImageInfo;
  thumbnailUrl: string | undefined;
  onVisible: () => void;
  onView: () => void;
  onRemove: () => void;
  onCaption: (
    image: ImageInfo,
    caption: string,
  ) => Promise<
    | { ok: true; image: ImageInfo }
    | { ok: false; reason: ImageFailure; image?: ImageInfo }
  >;
}) {
  const entryRef = useRef<HTMLDivElement>(null);
  // What is typed, until it is saved. Null shows the saved caption.
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latestDraftRef = useRef<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const caption = draft ?? image.caption;
  const length = countCharacters(caption);
  const isTooLong = length > maxCaptionLength;

  // Fetches the thumbnail when it comes into view, or at once where the
  // browser cannot tell.
  useEffect(() => {
    const entry = entryRef.current;
    if (!entry) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisible();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((seen) => seen.isIntersecting)) {
        onVisible();
        observer.disconnect();
      }
    });
    observer.observe(entry);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The box grows with its text, as a task's title does, and again when a
  // change of window width rewraps it.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    fitHeightToText(box);
    const refit = () => fitHeightToText(box);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [caption]);

  const saveCaption = async () => {
    if (draft === null || draft === image.caption) {
      setDraft(null);
      return;
    }
    if (isTooLong) {
      setMessage(captionTooLongMessage);
      return;
    }
    const saving = draft;
    const result = await onCaption(image, saving);
    // Text typed while saving stays as a draft, to be saved on its own blur.
    const isUnchanged = latestDraftRef.current === saving;
    if (result.ok) {
      if (isUnchanged) setDraft(null);
      setMessage(null);
    } else if (result.reason === "conflict") {
      setDraft(null);
      setMessage(captionChangedElsewhereMessage);
    } else {
      setMessage(describeImageFailure(result.reason));
    }
  };

  const time = formatAddedTime(image.createdAt);
  return (
    <div ref={entryRef} className="image-entry" data-image-id={image.id}>
      <button
        type="button"
        className="image-entry-thumbnail"
        aria-label={`View full size: ${describeImage(image)}`}
        onClick={onView}
      >
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" />
        ) : (
          <span className="image-entry-placeholder" aria-hidden="true" />
        )}
      </button>
      <div className="image-entry-details">
        <time dateTime={image.createdAt}>{time}</time>
        <textarea
          ref={boxRef}
          aria-label="Caption"
          placeholder="Add a caption"
          rows={2}
          value={caption}
          onChange={(event) => {
            latestDraftRef.current = event.target.value;
            setDraft(event.target.value);
            setMessage(null);
          }}
          onBlur={() => void saveCaption()}
          onKeyDown={(event) => {
            // Esc puts the saved caption back, rather than closing the
            // project.
            if (event.key !== "Escape") return;
            event.preventDefault();
            latestDraftRef.current = null;
            setDraft(null);
            setMessage(null);
          }}
        />
        <div className="image-entry-footer">
          <span
            className={
              isTooLong ? "image-entry-count is-over" : "image-entry-count"
            }
            aria-live="polite"
          >
            {length > maxCaptionLength * 0.8
              ? `${length} / ${maxCaptionLength}`
              : ""}
          </span>
        </div>
        {(message || isTooLong) && (
          <p className="project-images-note" role="alert">
            {isTooLong ? captionTooLongMessage : message}
          </p>
        )}
      </div>
      <button
        type="button"
        className="project-images-remove"
        aria-label="Remove image"
        title="Remove image"
        onClick={onRemove}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" />
          <path d="M5.5 10h9M10 5.5v9" />
        </svg>
      </button>
    </div>
  );
}

export function ImageViewer({
  url,
  label,
  caption,
  createdAt,
  navigation,
  onClose,
}: {
  url: string;
  label: string;
  // Shown below the image: the caption at the left, the time added at the right.
  caption?: string;
  createdAt?: string;
  // Left and right buttons, fixed to the window, to move between a project's
  // images. A null step is at an end, and its button is off.
  navigation?: { onPrevious: (() => void) | null; onNext: (() => void) | null };
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal?.();
    raiseFloatingMessages();
    return () => dialog?.close?.();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className={navigation ? "image-viewer has-step-buttons" : "image-viewer"}
      aria-label="Full-size image"
      // The close event comes after the dialog's cleanup in development, when
      // an effect runs twice, so it counts only if the dialog is still shut.
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // Esc closes only the viewer, not the project behind it.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <img src={url} alt={label} />
      <div className="image-viewer-details">
        <p className="image-viewer-caption">{caption}</p>
        {createdAt && (
          <time dateTime={createdAt}>{formatAddedTime(createdAt)}</time>
        )}
      </div>
      {navigation && (
        <>
          <ViewerStepButton
            direction="previous"
            onClick={navigation.onPrevious}
          />
          <ViewerStepButton direction="next" onClick={navigation.onNext} />
        </>
      )}
    </dialog>
  );
}

// The date picker's month arrow, twice the size.
function ViewerStepButton({
  direction,
  onClick,
}: {
  direction: "previous" | "next";
  onClick: (() => void) | null;
}) {
  const label = direction === "previous" ? "Previous image" : "Next image";
  return (
    <button
      type="button"
      className={`image-viewer-${direction}`}
      aria-label={label}
      title={label}
      aria-disabled={onClick ? undefined : true}
      onClick={() => onClick?.()}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" />
        <path d="M5.5 10h9M11 6.5l3.5 3.5M11 13.5l3.5-3.5" />
      </svg>
    </button>
  );
}
