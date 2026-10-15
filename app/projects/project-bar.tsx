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
  return (
    <li className="project-bar">
      <button type="button" data-project-id={project.id} onClick={onOpen}>
        <span className="project-bar-assignee">
          {findAssigneeName(project.assignee)}
        </span>
        <span className="project-bar-text">
          <span className="project-bar-title">{project.title}</span>
          {project.notes && (
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
