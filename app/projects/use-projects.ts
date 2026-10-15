// The saved projects, read from storage when first needed in the browser and
// again after each save, or when another tab saves. The server cannot see
// local storage, so it renders without projects, and the dashboard fills them
// in once the page has loaded, without a hydration mismatch.
import { useSyncExternalStore } from "react";

import { isProjectKey, loadProjects, type LoadResult } from "./project-storage";

let current: LoadResult | null = null;
const listeners = new Set<() => void>();

function readProjects() {
  current ??= loadProjects();
  return current;
}

export function refreshProjects() {
  current = loadProjects();
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (isProjectKey(event.key)) refreshProjects();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// Null on the server and while the page hydrates.
export function useProjects(): LoadResult | null {
  return useSyncExternalStore(subscribe, readProjects, () => null);
}
