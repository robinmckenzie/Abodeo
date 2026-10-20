// Development only: saves the projects here as the default projects that
// every visitor receives, or resets the projects here to those defaults. The
// dashboard shows it only in development, so the deployed app leaves it out.
import { useState } from "react";

import {
  buildDefaultProjectsFile,
  defaultProjectsEndpoint,
  defaultProjectsPath,
  readDefaultProjects,
} from "./default-projects";
import {
  loadProjects,
  markProjectsAsDefaults,
  resetToDefaultProjects,
} from "./project-storage";
import { refreshProjects } from "./use-projects";

export function DefaultProjectsPanel({
  onBeforeChange,
}: {
  // Closes an open project, saving its changes.
  onBeforeChange: () => void;
}) {
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const saveAsDefaults = async () => {
    onBeforeChange();
    const loaded = loadProjects();
    if (!loaded.ok) {
      setMessage("Not saved: this browser is not letting Abodeo use storage.");
      return;
    }
    const file = buildDefaultProjectsFile(loaded.projects);
    setIsSaving(true);
    setMessage("Saving…");
    try {
      const response = await fetch(defaultProjectsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(file),
      });
      if (!response.ok) throw new Error(await response.text());
    } catch (error) {
      setMessage(`Not saved: ${(error as Error).message}`);
      return;
    } finally {
      setIsSaving(false);
    }
    const defaults = readDefaultProjects(file);
    const marked = defaults && markProjectsAsDefaults(defaults);
    const count = loaded.projects.length;
    setMessage(
      [
        `Saved ${count} ${count === 1 ? "project" : "projects"} as the defaults.`,
        `Commit ${defaultProjectsPath} to include them in the next deployment.`,
        loaded.unreadableCount > 0 &&
          `${loaded.unreadableCount} unreadable ${loaded.unreadableCount === 1 ? "project was" : "projects were"} left out.`,
        !marked?.ok &&
          "This browser could not record them as defaults, so reloading may replace them with the saved copies.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const resetToDefaults = () => {
    if (
      !window.confirm(
        "Reset the projects here to the saved defaults? Projects added since the defaults were saved are removed, and edits to default projects are discarded.",
      )
    ) {
      return;
    }
    onBeforeChange();
    const result = resetToDefaultProjects();
    refreshProjects();
    setMessage(
      result.ok
        ? "Reset to the saved defaults."
        : "Not reset: this browser is not letting Abodeo save.",
    );
  };

  return (
    <section className="default-projects-panel" aria-label="Default projects">
      <span className="default-projects-label">Development</span>
      <button type="button" onClick={saveAsDefaults} disabled={isSaving}>
        Save as defaults
      </button>
      <button type="button" onClick={resetToDefaults} disabled={isSaving}>
        Reset to defaults
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
