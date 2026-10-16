import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useViewTransitionState } from "react-router";

import type { Route } from "./+types/dashboard";
import logo from "../images/abodeo-home-logo.jpeg";
import { AssigneeTuningPanel } from "../projects/assignee-tuning-panel";
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
// and its collapsed bar's height, which an expanded bar grows from. Each
// opening has its own key, so that a bar still squashing after one opening
// is never mistaken for the bar of the next.
type OpenProject = {
  key: string;
  id: string | null;
  values: ProjectFields;
  message: FormMessage;
  barHeight: number;
};

let openings = 0;

function createOpeningKey() {
  openings += 1;
  return `opening-${openings}`;
}

export default function Dashboard() {
  const mainRef = useRef<HTMLElement>(null);
  const projects = useProjects();
  const presentation = usePresentation();
  const isInPlace = presentation === "in-place";
  const [open, setOpen] = useState<OpenProject | null>(null);
  // In place, projects left open when another was opened, kept as they were
  // while their bars squash closed alongside the new one expanding.
  const [closing, setClosing] = useState<OpenProject[]>([]);
  if (!isInPlace && closing.length > 0) setClosing([]);
  const [unsavedIds, setUnsavedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const saverRef = useRef<Autosaver | null>(null);
  // The field last focused in the form, so that switching presentation
  // returns to it, and where focus goes when the form closes.
  const focusFieldRef = useRef("title");
  // Likewise the calendar's day, so that switching keeps its month and day.
  const calendarDateRef = useRef<string | null>(null);
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

  // In place, the project left open squashes closed as the next one opens.
  const closeForNextProject = () => {
    if (open && isInPlace) setClosing((bars) => [...bars, open]);
    closeProject();
  };

  const openNewProject = () => {
    closeForNextProject();
    focusFieldRef.current = "title";
    calendarDateRef.current = null;
    setOpen({
      key: createOpeningKey(),
      id: null,
      values: newProjectFields,
      message: null,
      barHeight: 0,
    });
  };

  const openProject = (project: Project, barHeight: number) => {
    closeForNextProject();
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
    // Just before the title, so opening a project does not put the cursor in
    // it, while Tab does.
    focusFieldRef.current = "start";
    calendarDateRef.current = null;
    const { title, notes, assignee, dueDate } = project;
    setOpen({
      key: createOpeningKey(),
      id,
      values: { title, notes, assignee, dueDate },
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
      key: createOpeningKey(),
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
    // A choice of assignee or due date is complete, so it is saved straight
    // away.
    if (changes.assignee !== undefined || changes.dueDate !== undefined) {
      saverRef.current?.saveNow();
    }
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
  // In place, a new project's form is the only part of the dashboard that
  // can be used, as in the floating window, so that what was typed is not
  // lost by opening something else.
  const isAddingInPlace = isInPlace && open?.id === null;
  const unreadableCount = projects?.ok ? projects.unreadableCount : 0;

  // In place, the expanded bar closes the form its own way, squashing.
  const form = open && (
    <ProjectForm
      values={open.values}
      isNew={open.id === null}
      message={open.message}
      getFocusField={() => focusFieldRef.current}
      onChange={changeOpenProject}
      onFieldFocus={(name) => (focusFieldRef.current = name)}
      getCalendarDate={() => calendarDateRef.current}
      onCalendarDateChange={(date) => (calendarDateRef.current = date)}
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

  // Keeps the same key as when the project was open, so that its bar and
  // form stay as they are, and only start squashing.
  const renderClosingBar = (bar: OpenProject) => (
    <ExpandedProjectBar
      key={bar.key}
      barHeight={bar.barHeight}
      isClosing
      hasCollapseButton={bar.id !== null}
      onCollapse={() =>
        setClosing((bars) => bars.filter(({ key }) => key !== bar.key))
      }
    >
      <ProjectForm
        values={bar.values}
        isNew={bar.id === null}
        message={bar.message}
        getFocusField={() => "start"}
        onChange={() => {}}
        onFieldFocus={() => {}}
        onFieldBlur={() => {}}
        onCreate={() => {}}
        onClose={() => {}}
        hasCloseButton={false}
      />
    </ExpandedProjectBar>
  );

  return (
    <div className="dashboard">
      <AssigneeTuningPanel />
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
        <div className="dashboard-toolbar" inert={isAddingInPlace}>
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
          {list.map((project) => {
            const closingBar = closing.find((bar) => bar.id === project.id);
            if (isInPlace && open?.id === project.id) {
              return (
                <ExpandedProjectBar
                  key={open.key}
                  ref={expandedBarRef}
                  barHeight={open.barHeight}
                  onCollapse={closeProject}
                >
                  {form}
                </ExpandedProjectBar>
              );
            }
            if (closingBar) return renderClosingBar(closingBar);
            return (
              <ProjectBar
                key={project.id}
                project={project}
                hasUnsavedChanges={unsavedIds.has(project.id)}
                isInert={isAddingInPlace}
                onOpen={(barHeight) => openProject(project, barHeight)}
              />
            );
          })}
          {/* New projects' bars, in one array so that an open one keeps its
              bar and form as it starts closing. */}
          {[
            ...closing.filter((bar) => bar.id === null).map(renderClosingBar),
            isInPlace && open?.id === null && (
              <ExpandedProjectBar
                key={open.key}
                ref={expandedBarRef}
                barHeight={0}
                hasCollapseButton={false}
                scrollsToPageEnd
                onCollapse={closeProject}
              >
                {form}
              </ExpandedProjectBar>
            ),
          ]}
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
