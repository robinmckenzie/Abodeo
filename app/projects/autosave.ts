// Saves an opened project's changes without a Save button: after a pause in
// typing, and straight away when asked, such as when a field or the project
// is closed or the page is left. Only the fields changed are sent, and a
// change counts as saved only once that exact change has been written, so a
// failed save is never shown as saved and newer typing is never lost to an
// older save.
import type { AccountFailure } from "./account-projects";
import { hasTitle, type ProjectFields } from "./projects";
import type { SaveFailure } from "./project-storage";

// Why a save failed, in the browser or in the account. "conflict" is a field
// changed elsewhere since it was loaded.
export type ProjectSaveFailure = SaveFailure | AccountFailure | "conflict";

export type ProjectSaveResult =
  { ok: true } | { ok: false; reason: ProjectSaveFailure };

export type AutosaveStatus =
  | { state: "saved" }
  | { state: "pending" }
  | { state: "failed"; reason: ProjectSaveFailure };

export type Autosaver = {
  change(changes: Partial<ProjectFields>): void;
  // Drops unsaved changes to these fields, such as when the person keeps
  // the version saved elsewhere, and clears the last failure.
  discard(fields: (keyof ProjectFields)[]): void;
  // Settles once this save is done: true if every change is then saved.
  saveNow(): Promise<boolean>;
};

export const autosaveDelay = 500;

export function createAutosaver({
  save,
  onStatus,
  delay = autosaveDelay,
}: {
  save: (changes: Partial<ProjectFields>) => Promise<ProjectSaveResult>;
  onStatus: (status: AutosaveStatus) => void;
  delay?: number;
}): Autosaver {
  let unsaved: Partial<ProjectFields> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = 0;
  let failure: ProjectSaveFailure | null = null;

  const hasUnsaved = () => Object.keys(unsaved).length > 0;

  const reportStatus = () => {
    if (failure) onStatus({ state: "failed", reason: failure });
    else if (hasUnsaved() || saving > 0) onStatus({ state: "pending" });
    else onStatus({ state: "saved" });
  };

  // Saves still running when this one started count too.
  let latestSave: Promise<unknown> = Promise.resolve();
  const isAllSaved = () => !failure && !hasUnsaved() && saving === 0;

  function saveNow() {
    clearTimeout(timer);
    timer = undefined;
    if (!hasUnsaved()) return latestSave.then(isAllSaved);
    const sending = unsaved;
    unsaved = {};
    saving++;
    latestSave = save(sending).then((result) => {
      saving--;
      if (result.ok) {
        failure = null;
      } else {
        // Puts the failed changes back under any made since, to be tried
        // again with the next change, or when the project is closed.
        unsaved = { ...sending, ...unsaved };
        failure = result.reason;
      }
      reportStatus();
    });
    return latestSave.then(isAllSaved);
  }

  return {
    // A title that is empty or only spaces is not saved, so the project
    // keeps its last valid title.
    change(changes) {
      const valid = { ...changes };
      if (valid.title !== undefined && !hasTitle(valid.title)) {
        delete valid.title;
      }
      unsaved = { ...unsaved, ...valid };
      clearTimeout(timer);
      if (hasUnsaved()) timer = setTimeout(saveNow, delay);
      if (!failure) reportStatus();
    },
    discard(fields) {
      const kept = { ...unsaved };
      for (const field of fields) delete kept[field];
      unsaved = kept;
      failure = null;
      reportStatus();
    },
    saveNow,
  };
}
