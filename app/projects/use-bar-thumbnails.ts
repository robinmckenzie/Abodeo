// The thumbnail of each project's newest image, for its collapsed bar (AD #48
// Add Images To Projects). Like the open project's images, the blob URLs are
// held only in memory, and let go when the account changes or the page goes.
import { useEffect, useRef, useState } from "react";

import { fetchImageFile, type ImageFailure } from "./images-client";
import { thumbnailConcurrency } from "./use-project-images";

// Blob URLs by project id, for the projects whose newest image has arrived.
export function useBarThumbnails(
  accountId: string | null,
  latestImageIds: Record<string, string>,
  onFailure?: (reason: ImageFailure) => void,
  fetchFn: typeof fetch = fetch,
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const requestedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<{ projectId: string; imageId: string }[]>([]);
  const activeRef = useRef(0);
  const sessionRef = useRef({ isCurrent: false });
  const blobUrlsRef = useRef<string[]>([]);
  const optionsRef = useRef({ onFailure, fetchFn });
  useEffect(() => {
    optionsRef.current = { onFailure, fetchFn };
  });

  useEffect(() => {
    if (!accountId) return;
    const session = { isCurrent: true };
    sessionRef.current = session;
    const requested = requestedRef.current;
    const queue = queueRef.current;
    const blobUrls = blobUrlsRef.current;
    return () => {
      session.isCurrent = false;
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.length = 0;
      requested.clear();
      queue.length = 0;
      activeRef.current = 0;
      setUrls({});
    };
  }, [accountId]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!accountId || !session.isCurrent) return;
    const pump = () => {
      while (
        activeRef.current < thumbnailConcurrency &&
        queueRef.current.length > 0
      ) {
        const { projectId, imageId } = queueRef.current.shift()!;
        activeRef.current++;
        void fetchImageFile(
          accountId,
          projectId,
          imageId,
          "thumbnail",
          optionsRef.current.fetchFn,
        ).then((result) => {
          if (!session.isCurrent) return;
          activeRef.current--;
          if (result.ok) {
            const url = URL.createObjectURL(result.blob);
            blobUrlsRef.current.push(url);
            setUrls((current) => ({
              ...current,
              [`${projectId}/${imageId}`]: url,
            }));
          } else {
            requestedRef.current.delete(`${projectId}/${imageId}`);
            optionsRef.current.onFailure?.(result.reason);
          }
          pump();
        });
      }
    };
    for (const [projectId, imageId] of Object.entries(latestImageIds)) {
      const key = `${projectId}/${imageId}`;
      if (requestedRef.current.has(key)) continue;
      requestedRef.current.add(key);
      queueRef.current.push({ projectId, imageId });
    }
    pump();
  }, [accountId, latestImageIds]);

  if (!accountId) return {};
  return Object.fromEntries(
    Object.entries(latestImageIds).flatMap(([projectId, imageId]) => {
      const url = urls[`${projectId}/${imageId}`];
      return url ? [[projectId, url]] : [];
    }),
  );
}
