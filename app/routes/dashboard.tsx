import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useViewTransitionState } from "react-router";

import type { Route } from "./+types/dashboard";
import logo from "../images/abodeo-home-logo.jpeg";
import { createAutosaver, type Autosaver } from "../projects/autosave";
import {
  ExpandedProjectBar,
  ProjectBar,
  type ExpandedProjectBarHandle,
} from "../projects/project-bar";
import { ProjectForm, type FormMessage } from "../projects/project-form";
import { ProjectWindow } from "../projects/project-window";
import {
  createProject,
  saveProjectChanges,
  type SaveFailure,
} from "../projects/project-storage";
import {
  hasTitle,
  newProjectFields,
  type Project,
  type ProjectFields,
} from "../projects/projects";
import {
  usePresentation,
  useSwitchPresentationKey,
} from "../projects/presentation";
import { refreshProjects, useProjects } from "../projects/use-projects";

export const meta: Route.MetaFunction = () => [
  { title: "Dashboard - Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

// The project being added (id null) or opened, with the values in its form
// and its collapsed bar's height, which an expanded bar grows from.
type OpenProject = {
  id: string | null;
  values: ProjectFields;
  message: FormMessage;
  barHeight: number;
};

export default function Dashboard() {
  const mainRef = useRef<HTMLElement>(null);
  const projects = useProjects();
  const presentation = usePresentation();
  const [open, setOpen] = useState<OpenProject | null>(null);
  const [unsavedIds, setUnsavedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const saverRef = useRef<Autosaver | null>(null);
  // The field last focused in the form, so that switching presentation
  // returns to it, and where focus goes when the form closes.
  const focusFieldRef = useRef("title");
  const focusAfterCloseRef = useRef<string | null>(null);
  const expandedBarRef = useRef<ExpandedProjectBarHandle>(null);

  useSwitchPresentationKey();

  // The Get Started link disappears when it is used, so focus moves to the
  // dashboard's content and screen readers announce the new screen, unless
  // the Add project form has already taken it.
  useEffect(() => {
    const main = mainRef.current;
    if (!main?.contains(document.activeElement)) main?.focus();
  }, []);

  // Saves an opened project's changes when the page is left or hidden, or
  // the dashboard is left for another screen.
  useEffect(() => {
    const saveNow = () => saverRef.current?.saveNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      saveNow();
    };
  }, []);

  useEffect(() => {
    if (open || !focusAfterCloseRef.current) return;
    document.querySelector<HTMLElement>(focusAfterCloseRef.current)?.focus();
    focusAfterCloseRef.current = null;
  }, [open]);

  const closeProject = () => {
    if (!open) return;
    saverRef.current?.saveNow();
    saverRef.current = null;
    focusAfterCloseRef.current = open.id
      ? `[data-project-id="${open.id}"]`
      : ".add-project";
    setOpen(null);
  };

  const openNewProject = () => {
    closeProject();
    focusFieldRef.current = "title";
    setOpen({
      id: null,
      values: newProjectFields,
      message: null,
      barHeight: 0,
    });
  };

  const openProject = (project: Project, barHeight: number) => {
    closeProject();
    const { id } = project;
    saverRef.current = createAutosaver({
      save: async (changes) => {
        const result = await saveProjectChanges(id, changes);
        refreshProjects();
        return result;
      },
      onStatus: (status) => {
        const isFailed = status.state === "failed";
        setUnsavedIds((ids) => toggleId(ids, id, isFailed));
        setOpen((current) =>
          current?.id === id
            ? {
                ...current,
                message: isFailed ? describeFailure(status.reason) : null,
              }
            : current,
        );
      },
    });
    setUnsavedIds((ids) => toggleId(ids, id, false));
    focusFieldRef.current = "title";
    const { title, notes, assignee } = project;
    setOpen({
      id,
      values: { title, notes, assignee },
      message: null,
      barHeight,
    });
  };

  // Pressing Get Started opens the Add project form as the crossfade to the
  // dashboard ends, or straight away where there is no crossfade. The
  // request is then removed, so that a reload does not open it again.
  const location = useLocation();
  const navigate = useNavigate();
  const isTransitioning = useViewTransitionState("/dashboard");
  const isAddProjectDue =
    (location.state as { openAddProject?: boolean } | null)?.openAddProject ===
      true && !isTransitioning;
  const [handledRequest, setHandledRequest] = useState<string | null>(null);
  if (isAddProjectDue && handledRequest !== location.key) {
    setHandledRequest(location.key);
    setOpen({
      id: null,
      values: newProjectFields,
      message: null,
      barHeight: 0,
    });
  }
  useEffect(() => {
    if (isAddProjectDue) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [isAddProjectDue, location.pathname, navigate]);

  const changeOpenProject = (changes: Partial<ProjectFields>) => {
    if (!open) return;
    setOpen({ ...open, values: { ...open.values, ...changes } });
    if (open.id === null) return;
    saverRef.current?.change(changes);
    // A choice of assignee is complete, so it is saved straight away.
    if (changes.assignee !== undefined) saverRef.current?.saveNow();
  };

  const createOpenProject = async () => {
    if (!open || open.id !== null) return;
    if (!hasTitle(open.values.title)) {
      setOpen({ ...open, message: describeFailure("no-title") });
      return;
    }
    const result = await createProject(open.values);
    if (!result.ok) {
      setOpen(
        (current) =>
          current && { ...current, message: describeFailure(result.reason) },
      );
      return;
    }
    refreshProjects();
    focusAfterCloseRef.current = `[data-project-id="${result.project.id}"]`;
    setOpen(null);
  };

  const list = projects?.ok ? projects.projects : [];
  const unreadableCount = projects?.ok ? projects.unreadableCount : 0;
  const isInPlace = presentation === "in-place";

  // In place, the expanded bar closes the form its own way, squashing.
  const form = open && (
    <ProjectForm
      values={open.values}
      isNew={open.id === null}
      message={open.message}
      getFocusField={() => focusFieldRef.current}
      onChange={changeOpenProject}
      onFieldFocus={(name) => (focusFieldRef.current = name)}
      onFieldBlur={() => saverRef.current?.saveNow()}
      onCreate={createOpenProject}
      onClose={() =>
        expandedBarRef.current
          ? expandedBarRef.current.squash()
          : closeProject()
      }
      hasCloseButton={!isInPlace}
    />
  );

  return (
    <div className="dashboard">
      <header>
        <h1>
          <img
            src={logo}
            alt="Abodeo - Your home, sorted."
            width={997}
            height={868}
          />
        </h1>
      </header>
      <main ref={mainRef} tabIndex={-1}>
        <div className="dashboard-toolbar">
          <button
            type="button"
            className="add-project"
            onClick={openNewProject}
          >
            Add project
          </button>
        </div>
        {projects && !projects.ok && (
          <p className="dashboard-notice" role="alert">
            This browser is not letting Abodeo use its storage, so projects
            cannot be saved here.
          </p>
        )}
        {unreadableCount > 0 && (
          <p className="dashboard-notice" role="alert">
            {unreadableCount === 1
              ? "1 saved project cannot be read, so it is not shown. It has been left as it is."
              : `${unreadableCount} saved projects cannot be read, so they are not shown. They have been left as they are.`}
          </p>
        )}
        <ul className="project-list" aria-label="Projects">
          {list.map((project) =>
            isInPlace && open?.id === project.id ? (
              <ExpandedProjectBar
                key={project.id}
                ref={expandedBarRef}
                barHeight={open.barHeight}
                onCollapse={closeProject}
              >
                {form}
              </ExpandedProjectBar>
            ) : (
              <ProjectBar
                key={project.id}
                project={project}
                hasUnsavedChanges={unsavedIds.has(project.id)}
                onOpen={(barHeight) => openProject(project, barHeight)}
              />
            ),
          )}
          {isInPlace && open?.id === null && (
            <ExpandedProjectBar
              key="new"
              ref={expandedBarRef}
              barHeight={0}
              onCollapse={closeProject}
            >
              {form}
            </ExpandedProjectBar>
          )}
        </ul>
        {projects?.ok && list.length === 0 && unreadableCount === 0 && (
          <p className="dashboard-empty">No projects added yet.</p>
        )}
        {!isInPlace && open && (
          <ProjectWindow onClose={closeProject}>{form}</ProjectWindow>
        )}
      </main>
    </div>
  );
}

function toggleId(ids: ReadonlySet<string>, id: string, isIncluded: boolean) {
  if (ids.has(id) === isIncluded) return ids;
  const next = new Set(ids);
  if (isIncluded) next.add(id);
  else next.delete(id);
  return next;
}

function describeFailure(reason: SaveFailure): FormMessage {
  const text = {
    "no-title": "A project needs a title.",
    full: "Not saved: this browser's storage for Abodeo is full.",
    unavailable: "Not saved: this browser is not letting Abodeo save.",
    unreadable:
      "Not saved: the saved copy of this project cannot be read, so it has been left as it is.",
  }[reason];
  return { text, isError: true };
}
