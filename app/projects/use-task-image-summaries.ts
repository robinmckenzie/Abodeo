// For the open account project, how many photos each task has and the
// thumbnail of its newest (AD #67 Add Photos To Tasks), for the task rows.
// Fetched once when the project opens, and kept up to date by the task's
// photos dialog. Like the project's images, the blob URLs are held only in
// memory, and let go when the account or project changes, or the page goes.
import { useCallback, useEffect, useRef, useState } from "react";

import type { TaskImageSummary } from "./images-api";
import {
  fetchImageFile,
  loadTaskImageSummaries,
  type ImageFailure,
} from "./images-client";
import { thumbnailConcurrency } from "./use-project-images";

export type TaskImageSummaries = {
  // By task id, for the tasks with photos. Empty until loaded.
  summaries: Record<string, TaskImageSummary>;
  // Blob URLs of the newest photos' thumbnails, by task id, once arrived.
  thumbnails: Record<string, string>;
  // How many photos the project's tasks have, or null until loaded.
  total: number | null;
  // Says what a task's photos dialog now shows.
  report: (taskId: string, count: number, latestImageId: string | null) => void;
  // Forgets a task whose photos have been removed.
  forget: (taskId: string) => void;
};

type Session = {
  isCurrent: boolean;
  urls: Map<string, string>;
  requested: Set<string>;
  queued: string[];
  active: number;
};

// Null account or project while signed out or no saved project is open.
export function useTaskImageSummaries(
  accountId: string | null,
  projectId: string | null,
  onFailure?: (reason: ImageFailure) => void,
  fetchFn: typeof fetch = fetch,
): TaskImageSummaries {
  const [loaded, setLoaded] = useState<{
    key: string;
    summaries: Record<string, TaskImageSummary>;
  } | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const sessionRef = useRef<Session | null>(null);
  const optionsRef = useRef({ onFailure, fetchFn });
  useEffect(() => {
    optionsRef.current = { onFailure, fetchFn };
  });
  const key = accountId && projectId ? `${accountId}/${projectId}` : null;

  useEffect(() => {
    if (!accountId || !projectId || !key) return;
    const session: Session = {
      isCurrent: true,
      urls: new Map(),
      requested: new Set(),
      queued: [],
      active: 0,
    };
    sessionRef.current = session;
    void loadTaskImageSummaries(
      accountId,
      projectId,
      optionsRef.current.fetchFn,
    ).then((result) => {
      if (!session.isCurrent) return;
      if (!result.ok) {
        optionsRef.current.onFailure?.(result.reason);
        return;
      }
      setLoaded({ key, summaries: result.tasks });
    });
    return () => {
      session.isCurrent = false;
      session.urls.forEach((url) => URL.revokeObjectURL(url));
      session.urls.clear();
      session.queued.length = 0;
      if (sessionRef.current === session) sessionRef.current = null;
      setLoaded(null);
      setUrls({});
    };
  }, [accountId, projectId, key]);

  const summaries = loaded && loaded.key === key ? loaded.summaries : null;

  // Fetches the newest thumbnail of each task not yet fetched.
  useEffect(() => {
    const session = sessionRef.current;
    if (!accountId || !projectId || !summaries || !session?.isCurrent) return;
    const pump = () => {
      while (session.active < thumbnailConcurrency && session.queued.length) {
        const imageId = session.queued.shift()!;
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
            const url = URL.createObjectURL(result.blob);
            session.urls.set(imageId, url);
            setUrls((current) => ({ ...current, [imageId]: url }));
          } else {
            session.requested.delete(imageId);
            optionsRef.current.onFailure?.(result.reason);
          }
          pump();
        });
      }
    };
    for (const { latestImageId } of Object.values(summaries)) {
      if (session.requested.has(latestImageId)) continue;
      session.requested.add(latestImageId);
      session.queued.push(latestImageId);
    }
    pump();
  }, [accountId, projectId, summaries]);

  const report = useCallback(
    (taskId: string, count: number, latestImageId: string | null) => {
      if (!key) return;
      setLoaded((current) => {
        if (!current || current.key !== key) return current;
        const { [taskId]: previous, ...others } = current.summaries;
        if (count === 0 || !latestImageId) {
          return previous ? { key, summaries: others } : current;
        }
        if (
          previous?.count === count &&
          previous.latestImageId === latestImageId
        ) {
          return current;
        }
        return {
          key,
          summaries: { ...others, [taskId]: { count, latestImageId } },
        };
      });
    },
    [key],
  );

  const forget = useCallback(
    (taskId: string) => report(taskId, 0, null),
    [report],
  );

  const thumbnails: Record<string, string> = {};
  let total: number | null = null;
  if (summaries) {
    total = 0;
    for (const [taskId, summary] of Object.entries(summaries)) {
      total += summary.count;
      const url = urls[summary.latestImageId];
      if (url) thumbnails[taskId] = url;
    }
  }
  return {
    summaries: summaries ?? noSummaries,
    thumbnails,
    total,
    report,
    forget,
  };
}

const noSummaries: Record<string, TaskImageSummary> = {};
