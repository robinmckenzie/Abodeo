// The demo seed control's state (AD #138 Demo Entry And Seed): whether it
// shows, when the seed was last saved, and saving it. Looked up when the
// account panel opens.
import { useEffect, useState } from "react";

import { loadSeedStatus, saveSeed } from "./account-client";

export type DemoSeed = {
  // False until known, and for everyone but Robin under his own label.
  canSave: boolean;
  savedAt: string | null;
  isSaving: boolean;
  message: string | null;
  // Gets the page ready first (false: the person chose to stay), then saves.
  save(): Promise<void>;
};

export const seedFailedMessage =
  "The demo seed could not be saved. Please try again.";

export function useDemoSeed(onBeforeSave: () => Promise<boolean>): DemoSeed {
  const [status, setStatus] = useState({
    canSave: false,
    savedAt: null as string | null,
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
      if (saved) setStatus({ canSave: true, savedAt: saved.savedAt });
      else setMessage(seedFailedMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return { ...status, isSaving, message, save };
}
