// A project's horizontal bar on the dashboard. In the in-place presentation,
// an opened project's bar expands to show the form instead.
import { findAssigneeName, type Project } from "./projects";

export function ProjectBar({
  project,
  hasUnsavedChanges,
  onOpen,
}: {
  project: Project;
  hasUnsavedChanges: boolean;
  onOpen: () => void;
}) {
  const assigneeName = findAssigneeName(project.assignee);
  // Screen readers hear the title first, and not the notes preview, whose
  // notes they read once the project is opened.
  const label = [
    project.title,
    assigneeName,
    hasUnsavedChanges && "last changes not saved",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="project-bar">
      <button
        type="button"
        data-project-id={project.id}
        aria-label={label}
        onClick={onOpen}
      >
        <span className="project-bar-assignee">{assigneeName}</span>
        <span className="project-bar-text">
          <span className="project-bar-title">{project.title}</span>
          {project.notes.trim() && (
            <span className="project-bar-notes">{project.notes}</span>
          )}
        </span>
        {hasUnsavedChanges && (
          <span className="project-bar-unsaved">Last changes not saved</span>
        )}
      </button>
    </li>
  );
}

export function ExpandedProjectBar({
  children,
}: {
  children: React.ReactNode;
}) {
  return <li className="project-bar is-expanded">{children}</li>;
}
