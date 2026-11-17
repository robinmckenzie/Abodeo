// The demo seed control's state (AD #138 Demo Entry And Seed): whether it
// shows, what the saved seed holds, and saving it. Looked up when the account
// panel opens.
import { useEffect, useState } from "react";

import type { SeedSaveResponse } from "./account-api";
import { loadSeedStatus, saveSeed } from "./account-client";

export type DemoSeed = {
  // False until known, and for everyone but Robin under his own label.
  canSave: boolean;
  // The saved seed, or null if there is none.
  seed: SeedSaveResponse | null;
  isSaving: boolean;
  message: string | null;
  // Gets the page ready first (false: the person chose to stay), then saves.
  save(): Promise<void>;
};

export const seedFailedMessage =
  "The demo seed could not be saved. Please try again.";

export const seedTooLargeMessage =
  "The demo seed was not saved: its images are too big. Use smaller or fewer images.";

export const seedPastDateMessage =
  "The demo seed was not saved: a due date or an appointment has already passed. Move it to a coming date, then save again.";

function count(number: number, one: string, many = `${one}s`) {
  return `${number} ${number === 1 ? one : many}`;
}

// When the seed was saved and what it holds, so that a save that kept less
// than expected, such as no appointments, is seen at once.
export function describeSeed(seed: SeedSaveResponse) {
  return `Saved ${new Date(seed.savedAt).toLocaleString()}: ${[
    count(seed.projectCount, "project"),
    count(seed.peopleCount, "person", "people"),
    count(seed.imageCount, "image"),
    count(seed.appointmentCount, "appointment"),
  ].join(", ")}.`;
}

export function useDemoSeed(onBeforeSave: () => Promise<boolean>): DemoSeed {
  const [status, setStatus] = useState({
    canSave: false,
    seed: null as SeedSaveResponse | null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void loadSeedStatus().then((loaded) => {
      if (isCurrent) setStatus(loaded);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const save = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      if (!(await onBeforeSave())) return;
      const saved = await saveSeed();
      if (saved === "too-large") setMessage(seedTooLargeMessage);
      else if (saved === "past-date") setMessage(seedPastDateMessage);
      else if (saved) setStatus({ canSave: true, seed: saved });
      else setMessage(seedFailedMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return { ...status, isSaving, message, save };
}
