// Whether the Add project form and opened projects show in a floating window
// or in place, in the project's expanding bar, so that Robin can try both.
// E on the dashboard switches between them, and the choice is kept in local
// storage. When one is chosen for good, this file can go.
import { useEffect, useSyncExternalStore } from "react";

import { isTextField } from "../keyboard";

export type Presentation = "window" | "in-place";

const storageKey = "abodeo-project-presentation";

let current: Presentation | null = null;
const listeners = new Set<() => void>();

function readPresentation(): Presentation {
  if (!current) {
    try {
      current =
        localStorage.getItem(storageKey) === "in-place" ? "in-place" : "window";
    } catch {
      current = "window";
    }
  }
  return current;
}

// If the choice cannot be saved, it still applies until the page reloads.
export function switchPresentation() {
  current = readPresentation() === "window" ? "in-place" : "window";
  try {
    localStorage.setItem(storageKey, current);
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The floating window on the server and while the page hydrates. Nothing is
// open then, so a saved choice of in place shows no change.
export function usePresentation() {
  return useSyncExternalStore(subscribe, readPresentation, () => "window");
}

// E switches the presentation. A held key, browser shortcuts, typing into a
// field and composing text with an input method are ignored.
export function useSwitchPresentationKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || isTextField(e.target)) return;
      switchPresentation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// For tests, which share this module between them.
export function forgetPresentation() {
  current = null;
}
