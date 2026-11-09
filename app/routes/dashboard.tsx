import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useViewTransitionState } from "react-router";

import type { Route } from "./+types/dashboard";
import { isTextField, useIsTextFieldFocused } from "../keyboard";
import { KeyboardShortcuts } from "../keyboard-shortcuts";
import { ScreenPanel } from "../screen-panel";
import { ProjectsIcon } from "../ui/icons";
import {
  useRefreshBinCount,
  useScreenAccount,
  useScreenLeave,
} from "../screen-context";
import { AssigneeTuningPanel } from "../projects/assignee-tuning-panel";
import { importProjects } from "../projects/account-projects";
import { DeleteProjectDialog } from "../projects/delete-project-dialog";
import { FloatingMessages, useFloatingMessages } from "../ui/floating-messages";
import {
  areAllTypesUnsupported,
  noProjectOpenMessage,
  signInToAddMessage,
  unsavedProjectMessage,
  unsupportedFilesMessage,
} from "../projects/image-messages";
import {
  readStoredPeople,
  removeStoredPeople,
} from "../projects/people-storage";
import { usePeople } from "../projects/use-people";
import {
  ExpandedProjectBar,
  ProjectBar,
  type ExpandedProjectBarHandle,
} from "../projects/project-bar";
import { describeFailure, type OpenProject } from "../projects/project-editing";
import { ProjectForm } from "../projects/project-form";
import { useFileDrag } from "../projects/use-file-drag";
import { ProjectImages, type AddFiles } from "../projects/project-images";
import { removeTaskImages } from "../projects/images-client";
import { TaskPhotosDialog } from "../projects/task-photos-dialog";
import { useTaskImageSummaries } from "../projects/use-task-image-summaries";
import {
  noteStorageUsage,
  type StorageUsage,
} from "../projects/use-project-images";
import {
  describeReturnResult,
  ProjectAppointments,
} from "../projects/project-appointments";
import {
  readProjectReturn,
  removeProjectReturn,
} from "../calendar/appointments-api";
import { isReconnectBlockedBy } from "../calendar/use-project-appointments";
import { ProjectWindow } from "../projects/project-window";
import {
  listOwnProjects,
  removeAccountHint,
  removeProjectsIfUnchanged,
} from "../projects/project-storage";
import type { Person } from "../projects/people";
import type { Project } from "../projects/projects";
import type { Task } from "../projects/tasks";
import {
  usePresentation,
  useSwitchPresentationKey,
} from "../projects/presentation";
import { TaskDrafts } from "../projects/task-drafts";
import { TaskList } from "../projects/task-list";
import { useProjectEditing } from "../projects/use-project-editing";
import { refreshProjects, useProjectsSource } from "../projects/use-projects";
import { useBarThumbnails } from "../projects/use-bar-thumbnails";

export const meta: Route.MetaFunction = () => [
  { title: "Dashboard - Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

// One object, so that a hook given it does not see a change on each render.
const noLatestImageIds: Record<string, string> = {};
const noPeople: Person[] = [];

export default function Dashboard() {
  const mainRef = useRef<HTMLElement>(null);
  const presentation = usePresentation();
  const isInPlace = presentation === "in-place";
  // In place, projects left open when another was opened, kept as they were
  // while their bars squash closed alongside the new one expanding.
  const [closing, setClosing] = useState<OpenProject[]>([]);
  if (!isInPlace && closing.length > 0) setClosing([]);
  // The field last focused in the form, so that switching presentation
  // returns to it, and where focus goes when the form closes.
  const focusFieldRef = useRef("title");
  // Likewise the calendar's day, so that switching keeps its month and day.
  const calendarDateRef = useRef<string | null>(null);
  const focusAfterCloseRef = useRef<string | null>(null);
  const expandedBarRef = useRef<ExpandedProjectBarHandle>(null);
  // How many images the open project shows, null if not shown.
  const imageCountRef = useRef<number | null>(null);
  // How many appointments the open project shows, null if not shown.
  const appointmentCountRef = useRef<number | null>(null);
  // Text typed into projects' add-task boxes but not yet added. It lasts as
  // long as this dashboard, so moving to another screen or reloading drops it.
  const [taskDrafts] = useState(() => new TaskDrafts());

  useSwitchPresentationKey();
  // T and E do not work while typing in a field, so they are not listed
  // then.
  const isTextFieldFocused = useIsTextFieldFocused();

  // The Get Started link disappears when it is used, so focus moves to the
  // dashboard's content and screen readers announce the new screen, unless
  // the Add project form has already taken it.
  useEffect(() => {
    const main = mainRef.current;
    if (!main?.contains(document.activeElement)) main?.focus();
  }, []);

  const account = useScreenAccount();
  const refreshBinCount = useRefreshBinCount();
  const source = useProjectsSource(account.view, account.recheck);
  const { view } = source;

  // Signed in, a failure that means the sign-in has changed checks it again.
  // One that names someone no longer in the list loads the list again.
  const reloadPeopleRef = useRef(() => {});
  const noteAccountFailure = (reason: string) => {
    if (reason === "signed-out" || reason === "account-changed") {
      account.recheck();
    }
    if (reason === "unknown-assignee") reloadPeopleRef.current();
  };

  const editing = useProjectEditing({
    source,
    taskDrafts,
    refreshBinCount,
    onAccountFailure: noteAccountFailure,
    onPeopleOutdated: () => reloadPeopleRef.current(),
    onClosed: (projectId) => {
      focusAfterCloseRef.current = projectId
        ? `[data-project-id="${projectId}"]`
        : ".add-project";
    },
    onCreated: (project) => {
      focusAfterCloseRef.current = `[data-project-id="${project.id}"]`;
    },
    onDeleted: () =>
      document.querySelector<HTMLElement>(".add-project")?.focus(),
  });
  const { open, unsavedIds, deletion, closeProject } = editing;

  useScreenLeave({
    onBeforeLeave: editing.prepareToLeave,
    onLeaving: () => {
      editing.markLeaving();
      // The account's hint no longer applies.
      removeAccountHint();
    },
  });

  useEffect(() => {
    if (open || !focusAfterCloseRef.current) return;
    document.querySelector<HTMLElement>(focusAfterCloseRef.current)?.focus();
    focusAfterCloseRef.current = null;
  }, [open]);

  // Pictures dropped on the page go to the open account project's images,
  // or, dropped on one of its tasks, to that task's photos (AD #67).
  const addFilesRef = useRef<AddFiles | null>(null);
  const addTaskFilesRef = useRef<AddFiles | null>(null);
  // The account's storage use as last given by the server, shared by the
  // project's images, its tasks' photos and their removal (AD #67).
  const storageUsageRef = useRef<StorageUsage | null>(null);
  // The task whose photos are shown in their dialog, over the open project,
  // and files to add to them once it opens.
  const [taskPhotos, setTaskPhotos] = useState<{
    accountId: string;
    projectId: string;
    taskId: string;
    title: string;
    filesToAdd: File[] | null;
  } | null>(null);
  const photosAccountId = view.kind === "account" ? view.accountId : null;
  const photosProjectId = photosAccountId && open?.id ? open.id : null;
  if (
    taskPhotos &&
    (taskPhotos.accountId !== photosAccountId ||
      taskPhotos.projectId !== photosProjectId)
  ) {
    setTaskPhotos(null);
  }
  const taskSummaries = useTaskImageSummaries(
    photosAccountId,
    photosProjectId,
    noteAccountFailure,
  );
  const openTaskPhotos = (task: Task, filesToAdd: File[] | null) => {
    if (!photosAccountId || !photosProjectId) return;
    setTaskPhotos({
      accountId: photosAccountId,
      projectId: photosProjectId,
      taskId: task.id,
      title: task.title,
      filesToAdd,
    });
  };
  // Once a deleted task's Undo has ended, its photos are removed and their
  // allowance given back. The server keeps them if the task is saved again.
  // If removing them fails, they stay hidden, as the ticket accepts.
  const removeDeletedTaskPhotos = (
    accountId: string,
    projectId: string,
    taskId: string,
  ) => {
    void removeTaskImages(accountId, projectId, taskId).then((result) => {
      if (result.ok) {
        noteStorageUsage(storageUsageRef, accountId, result.usedBytes);
        taskSummaries.forget(taskId);
      } else if (result.reason !== "conflict") {
        noteAccountFailure(result.reason);
      }
    });
  };
  const { boxes: messageBoxes, showMessage } = useFloatingMessages();
  const dropRefusal =
    view.kind !== "account"
      ? signInToAddMessage
      : !open
        ? noProjectOpenMessage
        : open.id === null
          ? unsavedProjectMessage
          : null;
  const { isDragging, isRefused } = useFileDrag({
    getRefusal: (fileTypes) =>
      dropRefusal ??
      (areAllTypesUnsupported(fileTypes) ? unsupportedFilesMessage : null),
    onRefusal: (message) =>
      showMessage(message, message === unsupportedFilesMessage),
    onDrop: (files, target) => {
      // While a task's photos are open, anything dropped goes to them.
      if (taskPhotos && addTaskFilesRef.current) {
        addTaskFilesRef.current(files);
        return;
      }
      // Only the open project's rows are marked, not those of a project
      // squashing closed.
      const row =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-photo-task-id]")
          : null;
      const task = row
        ? open?.values.tasks.find(({ id }) => id === row.dataset.photoTaskId)
        : undefined;
      if (task) openTaskPhotos(task, files);
      else if (addFilesRef.current) addFilesRef.current(files);
      else showMessage(noProjectOpenMessage);
    },
  });
  const isDropTarget = isDragging && !isRefused;

  // In place, the project left open squashes closed as the next one opens.
  const keepOpenProjectSquashing = () => {
    if (open && isInPlace) setClosing((bars) => [...bars, open]);
  };

  const openNewProject = () => {
    keepOpenProjectSquashing();
    editing.openNewProject();
    focusFieldRef.current = "title";
    calendarDateRef.current = null;
  };

  const openProject = (project: Project, barHeight: number, slot?: number) => {
    keepOpenProjectSquashing();
    editing.openProject(project, barHeight, slot);
    // Just before the title, so opening a project does not put the cursor in
    // it, while Tab does.
    focusFieldRef.current = "start";
    calendarDateRef.current = null;
  };

  const startDelete = () =>
    editing.startDelete({
      // With its tasks' photos, which go with it (AD #67). Until both are
      // shown, null, for the count the server gave with the list, which has
      // both.
      imageCount:
        imageCountRef.current !== null && taskSummaries.total !== null
          ? imageCountRef.current + taskSummaries.total
          : null,
      appointmentCount: appointmentCountRef.current,
    });

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
    editing.showNewProjectForm();
  }
  useEffect(() => {
    if (isAddProjectDue) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [isAddProjectDue, location.pathname, navigate]);

  const isAccountReady = view.kind === "account" && view.state === "ready";

  // Google returns the browser to a project (AD #70 Add Appointments To
  // Projects) as ?project=<id>, with the result of the grant. Read once, as
  // the address is then cleaned. The project opens once the account's
  // projects have loaded.
  const [returnTarget] = useState(() => readProjectReturn(location.search));
  const isReturnHandledRef = useRef(false);
  // The project to open the new appointment form for, on its opening only.
  const formProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (open === null) formProjectIdRef.current = null;
  }, [open]);
  const openProjectRef = useRef(openProject);
  useEffect(() => {
    openProjectRef.current = openProject;
  });
  const returnedProject =
    isAccountReady && returnTarget
      ? view.projects.find(({ id }) => id === returnTarget.projectId)
      : undefined;
  const isReturnSettled =
    isAccountReady || view.kind === "browser" || view.kind === "unavailable";
  useEffect(() => {
    if (!returnTarget || isReturnHandledRef.current || !isReturnSettled) return;
    isReturnHandledRef.current = true;
    if (returnedProject) {
      const bar = document.querySelector<HTMLElement>(
        `[data-project-id="${CSS.escape(returnedProject.id)}"]`,
      );
      openProjectRef.current(
        returnedProject,
        bar?.getBoundingClientRect().height ?? 0,
      );
      if (returnTarget.openForm && returnTarget.result === "connected") {
        formProjectIdRef.current = returnedProject.id;
      }
    }
    navigate(
      {
        pathname: location.pathname,
        search: removeProjectReturn(location.search),
      },
      { replace: true, state: location.state },
    );
  }, [returnTarget, isReturnSettled, returnedProject, location, navigate]);
  const browserProjects =
    view.kind === "browser" && view.result?.ok ? view.result : null;
  const list = isAccountReady
    ? view.projects
    : (browserProjects?.projects ?? []);
  // In place, the opened project keeps its slot while open, even if a new due
  // date would sort it elsewhere, so that the page does not jump. It moves to
  // its sorted place once closed.
  const shownList = (() => {
    if (!isInPlace || !open?.id || open.slot === undefined) return list;
    const others = list.filter((project) => project.id !== open.id);
    const opened = list.find((project) => project.id === open.id);
    if (!opened) return list;
    others.splice(Math.min(open.slot, others.length), 0, opened);
    return others;
  })();
  const barThumbnails = useBarThumbnails(
    isAccountReady ? view.accountId : null,
    isAccountReady ? view.latestImageIds : noLatestImageIds,
    noteAccountFailure,
  );
  const isShowingList = isAccountReady || browserProjects !== null;
  const isAccountUnavailable =
    view.kind === "unavailable" ||
    (view.kind === "account" && view.state === "unavailable");
  // In place, a new project's form is the only part of the dashboard that
  // can be used, as in the floating window, so that what was typed is not
  // lost by opening something else.
  const isAddingInPlace = isInPlace && open?.id === null;
  const unreadableCount = isAccountReady
    ? view.unreadableCount
    : (browserProjects?.unreadableCount ?? 0);
  // An opened project stays open, at the list's end, while the list cannot
  // be shown.
  const isOpenOutsideList =
    open !== null &&
    open.id !== null &&
    !list.some((project) => project.id === open.id);

  // Signed in, the browser's own projects, if any, move into the account by
  // themselves once its projects have loaded (AD #68). A failed move leaves
  // them in the browser, to be tried again on asking or at the next sign-in.
  const moveKey =
    view.kind === "account" && view.state === "ready"
      ? `${view.accountId}:${view.generation}`
      : null;
  const [move, setMove] = useState<{
    key: string;
    projects: Project[];
    status: "none" | "moving" | "moved" | "failed" | "dismissed";
    movedCount: number;
  } | null>(null);
  if (moveKey && move?.key !== moveKey) {
    const projects = listOwnProjects();
    setMove({
      key: moveKey,
      projects,
      status: projects.length > 0 ? "moving" : "none",
      movedCount: 0,
    });
  }
  const currentMove = moveKey && move?.key === moveKey ? move : null;

  // The people the projects can be assigned to. An account's list is saved
  // once the browser has no projects left to move in with its people.
  const people = usePeople(account.view, {
    // Not while the browser still has projects to move in, even once a failed
    // move's notice is dismissed: their people would no longer match.
    isEstablishDue:
      currentMove !== null &&
      currentMove.status !== "moving" &&
      currentMove.status !== "failed" &&
      listOwnProjects().length === 0,
    onAccountFailure: noteAccountFailure,
  });
  useEffect(() => {
    reloadPeopleRef.current = people.reload;
  });
  const readyPeople = people.view.status === "ready" ? people.view : null;

  const moveProjects = async (key: string, projects: Project[]) => {
    if (view.kind !== "account") return;
    const settleMove = (status: "moved" | "failed", movedCount = 0) =>
      setMove((current) =>
        current?.key === key ? { ...current, status, movedCount } : current,
      );
    // The browser's people go with its projects.
    const stored = readStoredPeople();
    // A damaged list stops the move, so that no one loses who they were
    // assigned to and the browser's copies are kept.
    if (stored.state === "unreadable" || stored.state === "unavailable") {
      settleMove("failed");
      return;
    }
    const result = await editing.trackSending(
      importProjects(
        view.accountId,
        projects,
        stored.state === "found" ? stored.people : undefined,
      ),
    );
    if (!result.ok) {
      noteAccountFailure(result.reason);
      settleMove("failed");
      return;
    }
    // Only those the account now has, each only if not changed here since.
    const moved = projects.filter(
      ({ id }) => result.outcomes[id] !== undefined,
    );
    removeProjectsIfUnchanged(moved);
    // With none of its own projects left, the browser's list has gone too.
    if (listOwnProjects().length === 0) removeStoredPeople();
    refreshProjects();
    settleMove("moved", moved.length);
    source.reload();
    people.reload();
  };

  // Starts each move once, even where development runs effects twice.
  const startedMoveRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentMove?.status !== "moving") return;
    if (startedMoveRef.current === currentMove.key) return;
    startedMoveRef.current = currentMove.key;
    void moveProjects(currentMove.key, currentMove.projects);
  });

  const retryMove = () => {
    if (!currentMove || currentMove.status !== "failed") return;
    // What is in the browser now, in case it changed since.
    const projects = listOwnProjects();
    startedMoveRef.current = null;
    setMove({
      ...currentMove,
      projects,
      status: projects.length > 0 ? "moving" : "none",
    });
  };

  const dismissMoveNotice = () =>
    setMove((current) =>
      current?.key === moveKey ? { ...current, status: "dismissed" } : current,
    );

  // In place, the expanded bar closes the form its own way, squashing. Esc
  // and its keycap in the shortcuts panel both close it this way.
  const closeOpenProject = () =>
    expandedBarRef.current ? expandedBarRef.current.squash() : closeProject();

  // In place, Esc closes the project wherever focus is, such as on the page
  // after a click on its background or on text in the form. The floating
  // window's dialog hears Esc wherever focus is already. Not when something
  // has used Esc itself, as a task's title does to cancel its edit.
  const closeOpenProjectRef = useRef(closeOpenProject);
  useEffect(() => {
    closeOpenProjectRef.current = closeOpenProject;
  });
  const isOpenInPlace = isInPlace && open !== null;
  useEffect(() => {
    if (!isOpenInPlace) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.repeat || event.isComposing) return;
      event.preventDefault();
      closeOpenProjectRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpenInPlace]);

  // Development only, for looking at how the form shows a failed save: M puts
  // the "cannot reach your projects" message on the open project, and again
  // takes it off. Kept apart from the project's own message, so that loading
  // or saving does not clear it. Not in the deployed app.
  const [testMessageKey, setTestMessageKey] = useState<string | null>(null);
  const isOpenRef = useRef<string | null>(null);
  useEffect(() => {
    isOpenRef.current = open?.key ?? null;
  });
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "m" || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = isOpenRef.current;
      if (isTextField(event.target) || key === null) return;
      setTestMessageKey((current) => (current === key ? null : key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The project form for an opened project, or, with isClosing, for the same
  // project squashing closed (AD #111 Extract Project Editing Lifecycle). Both
  // come from here so that they cannot drift apart. While closing, the form
  // keeps the same elements in the same places, so that its state stays, but
  // does nothing: it has no images, appointments, message actions or add-
  // person box, is not read-only, and its handlers do nothing. Appointments
  // in particular must not be shown again, as they can redirect to Google.
  const renderProjectForm = (entry: OpenProject, isClosing: boolean) => (
    <ProjectForm
      values={entry.values}
      isNew={entry.id === null}
      isReadOnly={isClosing ? undefined : entry.isLoading}
      people={readyPeople?.people ?? noPeople}
      onAddPerson={!isClosing && readyPeople ? people.addPerson : undefined}
      projectKey={isClosing ? undefined : entry.key}
      message={
        !isClosing && import.meta.env.DEV && testMessageKey === entry.key
          ? describeFailure("unreachable")
          : entry.message
      }
      messageActions={
        !isClosing &&
        entry.hasConflict && (
          <>
            <button
              type="button"
              className="button-secondary"
              onClick={editing.keepSavedVersion}
            >
              Use saved version
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={editing.keepMine}
            >
              Keep mine
            </button>
          </>
        )
      }
      getFocusField={() => (isClosing ? "start" : focusFieldRef.current)}
      onChange={isClosing ? () => {} : editing.changeFields}
      onFieldFocus={
        isClosing ? () => {} : (name) => (focusFieldRef.current = name)
      }
      getCalendarDate={isClosing ? undefined : () => calendarDateRef.current}
      onCalendarDateChange={
        isClosing ? undefined : (date) => (calendarDateRef.current = date)
      }
      onFieldBlur={isClosing ? () => {} : editing.saveNow}
      onCreate={isClosing ? () => {} : editing.createProject}
      onClose={isClosing ? () => {} : closeOpenProject}
      onDelete={!isClosing && entry.id !== null ? startDelete : undefined}
      hasCloseButton={!isClosing && !isInPlace}
      images={
        !isClosing &&
        entry.id !== null && (
          <ProjectImages
            accountId={view.kind === "account" ? view.accountId : null}
            projectId={entry.id}
            usageRef={storageUsageRef}
            onFailure={noteAccountFailure}
            onMessage={showMessage}
            addFilesRef={addFilesRef}
            onCountChange={(count) => {
              imageCountRef.current = count;
            }}
            onLatestImageChange={(imageId) => {
              if (view.kind === "account" && entry.id !== null) {
                source.showLatestImage(view.generation, entry.id, imageId);
              }
            }}
          />
        )
      }
      appointments={
        !isClosing &&
        entry.id !== null && (
          <ProjectAppointments
            accountId={view.kind === "account" ? view.accountId : null}
            projectId={entry.id}
            shouldOpenForm={() => formProjectIdRef.current === entry.id}
            canReconnectAutomatically={
              !isReconnectBlockedBy(returnTarget?.result)
            }
            returnNote={
              returnTarget?.projectId === entry.id
                ? describeReturnResult(returnTarget.result)
                : null
            }
            onBeforeLeave={editing.prepareToLeave}
            onSignInChange={noteAccountFailure}
            onCountChange={(count) => {
              appointmentCountRef.current = count;
            }}
          />
        )
      }
      tasks={
        entry.id !== null && (
          <TaskList
            className={isClosing ? undefined : "arrives-in-turn"}
            style={
              isClosing
                ? undefined
                : ({ "--arrival": 4 } as React.CSSProperties)
            }
            projectId={entry.id}
            tasks={entry.values.tasks}
            people={readyPeople?.people ?? noPeople}
            onAddPerson={
              !isClosing && readyPeople ? people.addPerson : undefined
            }
            drafts={taskDrafts}
            onChange={isClosing ? async () => null : editing.changeTasks}
            finishEditRef={isClosing ? undefined : editing.finishTaskEditRef}
            // A closing bar's tasks have no photos and end their Undo with the
            // callback they had while open, not the next project's.
            photos={
              !isClosing && photosProjectId
                ? {
                    summaries: taskSummaries.summaries,
                    thumbnails: taskSummaries.thumbnails,
                    isDropTarget,
                    onAdd: openTaskPhotos,
                    onOpen: (task) => openTaskPhotos(task, null),
                  }
                : null
            }
            onUndoEnd={
              isClosing
                ? undefined
                : (task) => {
                    if (
                      photosAccountId &&
                      photosProjectId &&
                      taskSummaries.summaries[task.id]
                    ) {
                      removeDeletedTaskPhotos(
                        photosAccountId,
                        photosProjectId,
                        task.id,
                      );
                    }
                  }
            }
          />
        )
      }
    />
  );
  const form = open && renderProjectForm(open, false);

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
      {renderProjectForm(bar, true)}
    </ExpandedProjectBar>
  );

  return (
    <>
      <AssigneeTuningPanel />
      <ScreenPanel
        title="Projects"
        icon={<ProjectsIcon />}
        className={
          isDropTarget ? "projects-screen is-drop-target" : "projects-screen"
        }
        ref={mainRef}
        tabIndex={-1}
        isTitleInert={isAddingInPlace}
        actions={
          <button
            type="button"
            className="button-secondary add-project"
            disabled={isAccountUnavailable}
            onClick={openNewProject}
          >
            Add project
          </button>
        }
      >
        {view.kind === "browser" && view.result && !view.result.ok && (
          <p className="dashboard-notice" role="alert">
            This browser is not letting Abodeo use its storage, so projects
            cannot be saved here.
          </p>
        )}
        {isAccountUnavailable && (
          <p className="dashboard-notice" role="alert">
            Your projects cannot be loaded right now. Please try again later.
          </p>
        )}
        {currentMove?.status === "moving" && (
          <p className="dashboard-notice dashboard-move-notice" role="status">
            {currentMove.projects.length === 1
              ? "Moving the project saved in this browser into your account…"
              : `Moving the ${currentMove.projects.length} projects saved in this browser into your account…`}
          </p>
        )}
        {currentMove?.status === "moved" && (
          <div className="dashboard-notice dashboard-move-notice" role="status">
            <p>
              {currentMove.movedCount === 1
                ? "1 project from this browser was moved into your account."
                : `${currentMove.movedCount} projects from this browser were moved into your account.`}
            </p>
            <button
              type="button"
              className="button-secondary button-small"
              onClick={dismissMoveNotice}
            >
              Dismiss
            </button>
          </div>
        )}
        {currentMove?.status === "failed" && (
          <div className="dashboard-notice dashboard-move-notice" role="alert">
            <p>
              {currentMove.projects.length === 1
                ? "The project saved in this browser could not be moved into your account just now. It is kept here, and will be moved when you try again or next come back."
                : `The ${currentMove.projects.length} projects saved in this browser could not be moved into your account just now. They are kept here, and will be moved when you try again or next come back.`}
            </p>
            <button
              type="button"
              className="button-secondary button-small"
              onClick={retryMove}
            >
              Try again
            </button>
            <button
              type="button"
              className="button-secondary button-small"
              onClick={dismissMoveNotice}
            >
              Dismiss
            </button>
          </div>
        )}
        {unreadableCount > 0 && (
          <p className="dashboard-notice" role="alert">
            {unreadableCount === 1
              ? "1 saved project cannot be read, so it is not shown. It has been left as it is."
              : `${unreadableCount} saved projects cannot be read, so they are not shown. They have been left as they are.`}
          </p>
        )}
        <ul className="project-list" aria-label="Projects">
          {shownList.map((project, index) => {
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
                people={readyPeople?.people ?? null}
                hasUnsavedChanges={unsavedIds.has(project.id)}
                isInert={isAddingInPlace}
                thumbnailUrl={barThumbnails[project.id]}
                onOpen={(barHeight) => openProject(project, barHeight, index)}
              />
            );
          })}
          {isInPlace && isOpenOutsideList && (
            <ExpandedProjectBar
              key={open.key}
              ref={expandedBarRef}
              barHeight={open.barHeight}
              onCollapse={closeProject}
            >
              {form}
            </ExpandedProjectBar>
          )}
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
        {isShowingList &&
          list.length === 0 &&
          unreadableCount === 0 &&
          // Not while moved projects are on their way into the list.
          currentMove?.status !== "moving" &&
          currentMove?.status !== "moved" && (
            <p className="dashboard-empty">No projects added yet.</p>
          )}
        {!isInPlace && open && (
          <ProjectWindow onClose={closeProject}>{form}</ProjectWindow>
        )}
      </ScreenPanel>
      {taskPhotos && (
        <TaskPhotosDialog
          key={`${taskPhotos.accountId}/${taskPhotos.projectId}/${taskPhotos.taskId}`}
          accountId={taskPhotos.accountId}
          projectId={taskPhotos.projectId}
          taskId={taskPhotos.taskId}
          taskTitle={
            open?.values.tasks.find(({ id }) => id === taskPhotos.taskId)
              ?.title ?? taskPhotos.title
          }
          filesToAdd={taskPhotos.filesToAdd}
          onFilesTaken={() =>
            setTaskPhotos(
              (current) => current && { ...current, filesToAdd: null },
            )
          }
          addFilesRef={addTaskFilesRef}
          usageRef={storageUsageRef}
          onSummaryChange={(count, latestImageId) =>
            taskSummaries.report(taskPhotos.taskId, count, latestImageId)
          }
          onFailure={noteAccountFailure}
          onMessage={showMessage}
          onClose={() => setTaskPhotos(null)}
        />
      )}
      {deletion && (
        <DeleteProjectDialog
          project={deletion}
          imageCount={deletion.imageCount}
          appointmentCount={deletion.appointmentCount}
          mode={deletion.mode}
          isBusy={deletion.isBusy}
          message={deletion.message}
          onConfirm={() => void editing.confirmDelete()}
          onCancel={editing.cancelDelete}
        />
      )}
      <FloatingMessages boxes={messageBoxes} />
      <KeyboardShortcuts
        shortcuts={[
          ...(import.meta.env.DEV
            ? [
                {
                  keyboardKeyLabel: "T",
                  action: "Toggle tuning panel",
                  isShown: !isTextFieldFocused,
                },
              ]
            : []),
          {
            keyboardKeyLabel: "E",
            action: (
              <>
                Switch{" "}
                <span className={isInPlace ? undefined : "is-current"}>
                  window
                </span>{" "}
                /{" "}
                <span className={isInPlace ? "is-current" : undefined}>
                  in place
                </span>
              </>
            ),
            isShown: !isTextFieldFocused,
          },
          ...(import.meta.env.DEV
            ? [
                {
                  keyboardKeyLabel: "M",
                  action: "Show or hide a failed-save message",
                  isShown: open !== null && !isTextFieldFocused,
                },
              ]
            : []),
          {
            keyboardKeyLabel: "Esc",
            action: "Close open project",
            isShown: open !== null,
            onPress: closeOpenProject,
          },
        ]}
      />
    </>
  );
}
