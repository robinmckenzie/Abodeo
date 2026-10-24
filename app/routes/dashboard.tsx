import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useViewTransitionState } from "react-router";

import type { Route } from "./+types/dashboard";
import { useAccount } from "../account/use-account";
import { AppMenu } from "../app-menu";
import logo from "../images/abodeo-home-logo.jpeg";
import { useIsTextFieldFocused } from "../keyboard";
import { KeyboardShortcuts } from "../keyboard-shortcuts";
import { AssigneeTuningPanel } from "../projects/assignee-tuning-panel";
import {
  createAccountProject,
  importProjects,
  openAccountProject,
  setPageLeaving,
  type OpenedAccountProject,
} from "../projects/account-projects";
import {
  createAutosaver,
  type Autosaver,
  type ProjectSaveFailure,
  type ProjectSaveResult,
} from "../projects/autosave";
import { DefaultProjectsPanel } from "../projects/default-projects-panel";
import {
  FloatingMessages,
  useFloatingMessages,
} from "../projects/floating-messages";
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
import { ProjectForm, type FormMessage } from "../projects/project-form";
import { useFileDrag } from "../projects/use-file-drag";
import { ProjectImages, type AddFiles } from "../projects/project-images";
import { ProjectWindow } from "../projects/project-window";
import {
  createProject,
  declineMove,
  forgetDeclinedMove,
  isMoveDeclined,
  listOwnProjects,
  removeAccountHint,
  removeProjectsIfUnchanged,
  saveProjectChanges,
  saveProjectTasks,
} from "../projects/project-storage";
import type { Person } from "../projects/people";
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
import {
  hasUnsubmittedTaskText,
  TaskList,
  type TaskChange,
} from "../projects/task-list";
import type { Task } from "../projects/tasks";
import {
  refreshProjects,
  useProjectsSource,
  type ProjectsView,
} from "../projects/use-projects";
import { useBarThumbnails } from "../projects/use-bar-thumbnails";

export const meta: Route.MetaFunction = () => [
  { title: "Dashboard - Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

// The project being added (id null) or opened, with the values in its form
// and its collapsed bar's height, which an expanded bar grows from. Each
// opening has its own key, so that a bar still squashing after one opening
// is never mistaken for the bar of the next. A new project has the id it
// will be added under in an account, kept for any retry. An account's
// project cannot be changed until its latest copy has loaded, and a field
// changed on another device waits for the person to choose a version.
type OpenProject = {
  key: string;
  id: string | null;
  newId?: string;
  values: ProjectFields;
  message: FormMessage;
  barHeight: number;
  isLoading?: boolean;
  hasConflict?: boolean;
  // A new project's values as sent by each Create, for a retry.
  submitted?: ProjectFields[];
};

// How an opened project is saved, in the browser or in the account.
type OpenedProject = {
  saveChanges(changes: Partial<ProjectFields>): Promise<ProjectSaveResult>;
  saveTasks(change: TaskChange): Promise<
    | { ok: true; tasks: Task[] }
    | {
        ok: false;
        reason: ProjectSaveFailure | "tasks-conflict";
        tasks?: Task[];
      }
  >;
  account?: OpenedAccountProject;
};

export const tasksConflictMessage =
  "These tasks were changed on another device. Your last change was not saved.";

// Which source projects are being shown from. Checking the sign-in keeps
// the last one, so that it does not close what is open. An account whose
// projects or sign-in cannot be checked counts as a change, so that none of
// its projects stays shown.
// One object, so that a hook given it does not see a change on each render.
const noLatestImageIds: Record<string, string> = {};
const noPeople: Person[] = [];

function readSourceKey(view: ProjectsView, previous: string | null) {
  if (view.kind === "browser") return "browser";
  if (view.kind === "unavailable") return "unavailable";
  if (view.kind === "account") {
    return view.state === "unavailable"
      ? "unavailable"
      : `account:${view.accountId}`;
  }
  return previous;
}

export const changedSinceAddedMessage =
  "This project was added, then changed on another device, so some of your changes were not saved. Cancel to see it as saved.";

function isSameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isSameFields(a: ProjectFields, b: ProjectFields) {
  return (
    JSON.stringify(pickFormValues(a)) === JSON.stringify(pickFormValues(b))
  );
}

let openings = 0;

function createOpeningKey() {
  openings += 1;
  return `opening-${openings}`;
}

export default function Dashboard() {
  const mainRef = useRef<HTMLElement>(null);
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
  const openedRef = useRef<OpenedProject | null>(null);
  // Saves of tasks and new projects on their way, and whether the opened
  // project has changes not yet saved, for the warning on leaving the page.
  const sendingRef = useRef(0);
  const browserCreatingKeyRef = useRef<string | null>(null);
  // The openings, current or closed, whose changes are not yet saved.
  const pendingKeysRef = useRef(new Set<string>());
  const unsavedIdsRef = useRef(unsavedIds);
  // Set once sign-in or sign-out is leaving the page, having asked already.
  const isLeavingRef = useRef(false);
  // The field last focused in the form, so that switching presentation
  // returns to it, and where focus goes when the form closes.
  const focusFieldRef = useRef("title");
  // Likewise the calendar's day, so that switching keeps its month and day.
  const calendarDateRef = useRef<string | null>(null);
  const focusAfterCloseRef = useRef<string | null>(null);
  const expandedBarRef = useRef<ExpandedProjectBarHandle>(null);
  // Saves a task title being edited when the project closes.
  const finishTaskEditRef = useRef<(() => Promise<string | null>) | null>(null);

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

  // Saves an opened project's changes when the page is left or hidden, or
  // the dashboard is left for another screen.
  // Saves sent then can finish after the page has gone.
  useEffect(() => {
    const saveNow = () => saverRef.current?.saveNow();
    const onPageHide = () => {
      setPageLeaving(true);
      saveNow();
    };
    const onVisibilityChange = () => {
      const isHidden = document.visibilityState === "hidden";
      setPageLeaving(isHidden);
      if (isHidden) saveNow();
    };
    const onPageShow = () => setPageLeaving(false);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      saveNow();
    };
  }, []);

  // Signed in, the browser asks before the page is left while a change is
  // still being sent or has failed to save, as it may then be lost.
  const isAccountSourceRef = useRef(false);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isAccountSourceRef.current || isLeavingRef.current) return;
      if (
        sendingRef.current > 0 ||
        pendingKeysRef.current.size > 0 ||
        unsavedIdsRef.current.size > 0
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (open || !focusAfterCloseRef.current) return;
    document.querySelector<HTMLElement>(focusAfterCloseRef.current)?.focus();
    focusAfterCloseRef.current = null;
  }, [open]);

  // Before signing in or out, which leave the page: saves what is open and
  // asks before anything that cannot be saved is lost. False if the person
  // chooses to stay. The project stays open, as the page is about to go.
  const prepareToLeave = async () => {
    const losses: string[] = [];
    const current = openRef.current;
    if (current) {
      const taskFailure = await finishTaskEditRef.current?.();
      if (taskFailure) losses.push("a change to a task's title");
      if (current.id === null) {
        if (isChanged(current.values)) {
          losses.push("the new project, which has not been added yet");
        }
      } else {
        if (!hasTitle(current.values.title)) {
          losses.push("the project's title, which is blank");
        }
        const isSaved = (await saverRef.current?.saveNow()) ?? true;
        if (!isSaved) losses.push("changes to the project that were not saved");
      }
    }
    if (hasUnsubmittedTaskText()) losses.push("tasks typed but not yet added");
    // Projects closed earlier whose changes are still on their way or
    // failed.
    if (pendingKeysRef.current.size > 0 || sendingRef.current > 0) {
      losses.push("changes still being saved");
    }
    if ([...unsavedIdsRef.current].some((id) => id !== current?.id)) {
      losses.push("changes to other projects that were not saved");
    }
    if (losses.length === 0) return true;
    return window.confirm(
      `Leaving now will lose ${joinList(losses)}.\n\nOK continues without them. Cancel stays here.`,
    );
  };
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
    unsavedIdsRef.current = unsavedIds;
  });

  const account = useAccount({
    onBeforeLeave: prepareToLeave,
    onLeaving: () => {
      isLeavingRef.current = true;
      // The offer to move projects returns at the next sign-in, and the
      // account's hint no longer applies.
      forgetDeclinedMove();
      removeAccountHint();
    },
  });
  const source = useProjectsSource(account.view, account.recheck);
  const { view } = source;
  useEffect(() => {
    isAccountSourceRef.current = view.kind === "account";
  });

  // A change of account, such as another tab signing out, closes the
  // project open for the last one. A new project's form stays, as nothing
  // of it is saved yet.
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const nextSourceKey = readSourceKey(view, sourceKey);
  if (nextSourceKey !== sourceKey) {
    setSourceKey(nextSourceKey);
    if (sourceKey !== null && open && open.id !== null) setOpen(null);
  }
  useEffect(
    () => () => {
      saverRef.current?.saveNow();
      saverRef.current = null;
      openedRef.current = null;
    },
    [sourceKey],
  );

  // Signed in, a failure that means the sign-in has changed checks it again.
  // One that names someone no longer in the list loads the list again.
  const reloadPeopleRef = useRef(() => {});
  const noteAccountFailure = (reason: string) => {
    if (reason === "signed-out" || reason === "account-changed") {
      account.recheck();
    }
    if (reason === "unknown-assignee") reloadPeopleRef.current();
  };

  // Pictures dropped on the page go to the open account project's images.
  const addFilesRef = useRef<AddFiles | null>(null);
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
    onDrop: (files) => {
      if (addFilesRef.current) addFilesRef.current(files);
      else showMessage(noProjectOpenMessage);
    },
  });
  const isDropTarget = isDragging && !isRefused;

  const closeProject = () => {
    if (!open) return;
    void finishTaskEditRef.current?.();
    saverRef.current?.saveNow();
    saverRef.current = null;
    openedRef.current = null;
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
      newId: crypto.randomUUID(),
      values: newProjectFields,
      message: null,
      barHeight: 0,
    });
  };

  // Counts a save on its way, for the warning on leaving the page.
  const whileSending = async <Result,>(work: Promise<Result>) => {
    sendingRef.current++;
    try {
      return await work;
    } finally {
      sendingRef.current--;
    }
  };

  const openInBrowser = (id: string): OpenedProject => ({
    saveChanges: async (changes) => {
      const result = await saveProjectChanges(id, changes);
      refreshProjects();
      return result;
    },
    saveTasks: async (change) => {
      const result = await saveProjectTasks(id, change);
      refreshProjects();
      return result;
    },
  });

  // Shows the project from the list straight away, read-only until its
  // latest copy has loaded, which the form then shows and saves are based
  // on, so that a reopened project never starts from an older copy.
  const openInAccount = (
    accountId: string,
    generation: number,
    project: Project,
    key: string,
  ): OpenedProject => {
    const opened = openAccountProject(accountId, project);
    void opened.load().then((result) => {
      if (result.ok) source.showSavedProject(generation, result.project);
      else noteAccountFailure(result.reason);
      setOpen((current) => {
        if (current?.key !== key) return current;
        if (!result.ok) {
          return {
            ...current,
            message: {
              text: "This project cannot be loaded right now.",
              isError: true,
            },
          };
        }
        return {
          ...current,
          values: pickFormValues(result.project),
          isLoading: false,
          message: null,
        };
      });
    });
    return {
      account: opened,
      saveChanges: async (changes) => {
        const result = await opened.saveChanges(changes);
        if (result.ok) source.showSavedProject(generation, result.project);
        else noteAccountFailure(result.reason);
        return result.ok ? { ok: true } : result;
      },
      saveTasks: async (change) => {
        const result = await whileSending(opened.saveTasks(change));
        if (result.ok) source.showSavedProject(generation, result.project);
        else noteAccountFailure(result.reason);
        return result;
      },
    };
  };

  const openProject = (project: Project, barHeight: number) => {
    closeForNextProject();
    const { id } = project;
    const key = createOpeningKey();
    const opened =
      view.kind === "account"
        ? openInAccount(view.accountId, view.generation, project, key)
        : openInBrowser(id);
    openedRef.current = opened;
    saverRef.current = createAutosaver({
      save: (changes) => opened.saveChanges(changes),
      onStatus: (status) => {
        const isFailed = status.state === "failed";
        if (status.state === "pending") pendingKeysRef.current.add(key);
        else pendingKeysRef.current.delete(key);
        setUnsavedIds((ids) => toggleId(ids, id, isFailed));
        if (isFailed && status.reason === "unknown-assignee") {
          reloadPeopleRef.current();
        }
        setOpen((current) =>
          current?.key === key
            ? {
                ...current,
                message: isFailed ? describeFailure(status.reason) : null,
                hasConflict: isFailed && status.reason === "conflict",
              }
            : current,
        );
      },
    });
    // A mark of changes not saved from an earlier opening stays until this
    // one saves.
    // Just before the title, so opening a project does not put the cursor in
    // it, while Tab does.
    focusFieldRef.current = "start";
    calendarDateRef.current = null;
    setOpen({
      key,
      id,
      values: pickFormValues(project),
      message: opened.account
        ? { text: "Loading the latest copy…", isError: false }
        : null,
      barHeight,
      isLoading: opened.account !== undefined,
    });
  };

  // A field changed on another device: the person keeps the saved version,
  // which the form then shows, or their own, which is then saved over it.
  const keepSavedVersion = () => {
    const opened = openedRef.current?.account;
    if (!opened || !open) return;
    const saved = opened.takeSavedVersion();
    saverRef.current?.discard(Object.keys(saved) as (keyof ProjectFields)[]);
    setOpen({
      ...open,
      values: { ...open.values, ...saved },
      message: null,
      hasConflict: false,
    });
    void saverRef.current?.saveNow();
  };

  const keepMine = () => {
    const opened = openedRef.current?.account;
    if (!opened || !open) return;
    opened.keepMine();
    setOpen({ ...open, message: null, hasConflict: false });
    void saverRef.current?.saveNow();
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
      newId: crypto.randomUUID(),
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
    if (!open || open.isLoading) return;
    setOpen({ ...open, values: { ...open.values, ...changes } });
    if (open.id === null) return;
    saverRef.current?.change(changes);
    // A choice of assignee or due date is complete, so it is saved straight
    // away.
    if (changes.assignee !== undefined || changes.dueDate !== undefined) {
      saverRef.current?.saveNow();
    }
  };

  // Shows a change to the opened project's tasks at once and saves it
  // straight away, going back to the tasks as they were if saving fails.
  const changeOpenTasks = async (change: TaskChange) => {
    const opened = openedRef.current;
    if (!open?.id || open.isLoading || !opened) return null;
    const { key } = open;
    const before = open.values.tasks;
    const showTasks = (update: TaskChange) =>
      setOpen((current) =>
        current?.key === key
          ? {
              ...current,
              values: {
                ...current.values,
                tasks: update(current.values.tasks),
              },
            }
          : current,
      );
    showTasks(change);
    const result = await opened.saveTasks(change);
    if (result.ok) {
      showTasks(() => result.tasks);
      return null;
    }
    // Tasks changed elsewhere are shown as saved.
    showTasks(() => result.tasks ?? before);
    return result.reason === "tasks-conflict"
      ? tasksConflictMessage
      : describeFailure(result.reason).text;
  };

  const createOpenProject = async () => {
    if (!open || open.id !== null || open.isLoading) return;
    if (!hasTitle(open.values.title)) {
      setOpen({ ...open, message: describeFailure("no-title") });
      return;
    }
    const { key } = open;
    let result:
      | { ok: true; project: Project }
      | { ok: false; reason: ProjectSaveFailure | "changed-since-added" };
    if (view.kind === "browser") {
      // Choosing someone can wait for another tab, so a second Create for
      // the same form must not queue a second project.
      if (browserCreatingKeyRef.current === key) return;
      browserCreatingKeyRef.current = key;
      try {
        result = await createProject(open.values);
      } finally {
        browserCreatingKeyRef.current = null;
      }
      refreshProjects();
    } else if (view.kind === "account" && view.state === "ready") {
      const { generation, accountId } = view;
      // The form cannot be changed while Create is on its way.
      const sending = open.values;
      const submitted = [...(open.submitted ?? []), sending];
      setOpen({ ...open, isLoading: true, submitted });
      result = await whileSending(
        createAccountProject(accountId, open.newId!, sending),
      );
      // A retry, after an answer was lost, gives the project as first
      // added. A field still as one of this form's Creates left it is
      // given this one's value. One that matches none was changed on
      // another device since, and is left as it is, which loses a change
      // only if this form also changed it between Creates.
      if (result.ok && !isSameFields(result.project, sending)) {
        const added = result.project;
        const differing = (
          Object.keys(sending) as (keyof ProjectFields)[]
        ).filter((field) => !isSameValue(sending[field], added[field]));
        const ours = differing.filter((field) =>
          submitted.some((values) => isSameValue(values[field], added[field])),
        );
        let latest = added;
        if (ours.length > 0) {
          const changes: Partial<ProjectFields> = {};
          for (const field of ours) {
            Object.assign(changes, { [field]: sending[field] });
          }
          const saved = await whileSending(
            openAccountProject(accountId, added).saveChanges(changes),
          );
          if (saved.ok) latest = saved.project;
          else result = { ok: false, reason: saved.reason };
        }
        source.showSavedProject(generation, latest);
        const isLost = differing.some(
          (field) =>
            !ours.includes(field) &&
            submitted.some(
              (values) => !isSameValue(values[field], sending[field]),
            ),
        );
        if (result.ok && isLost) {
          result = { ok: false, reason: "changed-since-added" };
        }
      }
      if (result.ok) source.showSavedProject(generation, result.project);
      else noteAccountFailure(result.reason);
    } else {
      result = { ok: false, reason: "unreachable" };
    }
    if (!result.ok) {
      const { reason } = result;
      setOpen((current) =>
        current?.key === key
          ? {
              ...current,
              isLoading: false,
              message:
                reason === "changed-since-added"
                  ? { text: changedSinceAddedMessage, isError: true }
                  : describeFailure(reason),
            }
          : current,
      );
      return;
    }
    if (openRef.current?.key !== key) return;
    focusAfterCloseRef.current = `[data-project-id="${result.project.id}"]`;
    setOpen(null);
  };

  const isAccountReady = view.kind === "account" && view.state === "ready";
  const browserProjects =
    view.kind === "browser" && view.result?.ok ? view.result : null;
  const list = isAccountReady
    ? view.projects
    : (browserProjects?.projects ?? []);
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

  // Signed in, the browser's own projects, if any, are offered to be moved
  // into the account once its projects have loaded, unless declined.
  const offerKey =
    view.kind === "account" && view.state === "ready"
      ? `${view.accountId}:${view.generation}`
      : null;
  const [moveOffer, setMoveOffer] = useState<{
    key: string;
    projects: Project[];
    status: "offered" | "moving" | "failed";
  } | null>(null);
  if (offerKey && moveOffer?.key !== offerKey && view.kind === "account") {
    setMoveOffer({
      key: offerKey,
      projects: isMoveDeclined(view.accountId) ? [] : listOwnProjects(),
      status: "offered",
    });
  }
  const offeredCount =
    offerKey && moveOffer?.key === offerKey ? moveOffer.projects.length : 0;

  // The people the projects can be assigned to. An account's list is saved
  // once the offer to move the browser's projects and people in is settled.
  const people = usePeople(account.view, {
    isEstablishDue:
      offerKey !== null &&
      moveOffer?.key === offerKey &&
      moveOffer.projects.length === 0 &&
      moveOffer.status !== "moving",
    onAccountFailure: noteAccountFailure,
  });
  useEffect(() => {
    reloadPeopleRef.current = people.reload;
  });
  const readyPeople = people.view.status === "ready" ? people.view : null;

  const moveProjects = async () => {
    if (view.kind !== "account" || !moveOffer) return;
    const { key, projects } = moveOffer;
    setMoveOffer({ ...moveOffer, status: "moving" });
    // The browser's people go with its projects.
    const stored = readStoredPeople();
    const result = await whileSending(
      importProjects(
        view.accountId,
        projects,
        stored.state === "found" ? stored.people : undefined,
      ),
    );
    if (!result.ok) {
      noteAccountFailure(result.reason);
      setMoveOffer((current) =>
        current?.key === key ? { ...current, status: "failed" } : current,
      );
      return;
    }
    // Only those the account now has, each only if not changed here since.
    removeProjectsIfUnchanged(
      projects.filter(({ id }) => result.outcomes[id] !== undefined),
    );
    // With none of its own projects left, the browser's list has gone too.
    if (listOwnProjects().length === 0) removeStoredPeople();
    refreshProjects();
    setMoveOffer((current) =>
      current?.key === key ? { ...current, projects: [] } : current,
    );
    source.reload();
    people.reload();
  };

  const declineMoveOffer = () => {
    if (view.kind !== "account" || !moveOffer) return;
    declineMove(view.accountId);
    setMoveOffer({ ...moveOffer, projects: [] });
  };

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

  const form = open && (
    <ProjectForm
      values={open.values}
      isNew={open.id === null}
      isReadOnly={open.isLoading}
      people={readyPeople?.people ?? noPeople}
      onAddPerson={readyPeople ? people.addPerson : undefined}
      projectKey={open.key}
      message={open.message}
      messageActions={
        open.hasConflict && (
          <>
            <button type="button" onClick={keepSavedVersion}>
              Use saved version
            </button>
            <button type="button" onClick={keepMine}>
              Keep mine
            </button>
          </>
        )
      }
      getFocusField={() => focusFieldRef.current}
      onChange={changeOpenProject}
      onFieldFocus={(name) => (focusFieldRef.current = name)}
      getCalendarDate={() => calendarDateRef.current}
      onCalendarDateChange={(date) => (calendarDateRef.current = date)}
      onFieldBlur={() => saverRef.current?.saveNow()}
      onCreate={createOpenProject}
      onClose={closeOpenProject}
      hasCloseButton={!isInPlace}
      images={
        open.id !== null && (
          <ProjectImages
            accountId={view.kind === "account" ? view.accountId : null}
            projectId={open.id}
            onFailure={noteAccountFailure}
            onMessage={showMessage}
            addFilesRef={addFilesRef}
            onLatestImageChange={(imageId) => {
              if (view.kind === "account" && open.id !== null) {
                source.showLatestImage(view.generation, open.id, imageId);
              }
            }}
          />
        )
      }
      tasks={
        open.id !== null && (
          <TaskList
            className="arrives-in-turn"
            style={{ "--arrival": 4 } as React.CSSProperties}
            projectId={open.id}
            tasks={open.values.tasks}
            onChange={changeOpenTasks}
            finishEditRef={finishTaskEditRef}
          />
        )
      }
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
        people={readyPeople?.people ?? noPeople}
        message={bar.message}
        getFocusField={() => "start"}
        onChange={() => {}}
        onFieldFocus={() => {}}
        onFieldBlur={() => {}}
        onCreate={() => {}}
        onClose={() => {}}
        hasCloseButton={false}
        tasks={
          bar.id !== null && (
            <TaskList
              projectId={bar.id}
              tasks={bar.values.tasks}
              onChange={async () => null}
            />
          )
        }
      />
    </ExpandedProjectBar>
  );

  return (
    <div className={isDropTarget ? "dashboard is-drop-target" : "dashboard"}>
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
        <AppMenu
          current="/dashboard"
          account={account}
          onBeforeLeave={prepareToLeave}
        />
      </header>
      <main ref={mainRef} tabIndex={-1}>
        <div className="dashboard-toolbar" inert={isAddingInPlace}>
          <h2>Projects</h2>
          {/* Replaced by false when the app is built for deployment, which
              leaves the panel out. */}
          {import.meta.env.DEV && (
            <DefaultProjectsPanel
              isSignedIn={view.kind === "account"}
              onBeforeChange={() => {
                if (view.kind === "browser") closeProject();
              }}
            />
          )}
          <button
            type="button"
            className="add-project"
            disabled={isAccountUnavailable}
            onClick={openNewProject}
          >
            Add project
          </button>
        </div>
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
        {offeredCount > 0 && moveOffer && (
          <div className="dashboard-notice dashboard-move-offer" role="status">
            <p>
              {offeredCount === 1
                ? "This browser has 1 project saved while signed out. Move it into your account?"
                : `This browser has ${offeredCount} projects saved while signed out. Move them into your account?`}
              {moveOffer.status === "failed" &&
                " They could not be moved just now. Please try again."}
            </p>
            <button
              type="button"
              disabled={moveOffer.status === "moving"}
              onClick={moveProjects}
            >
              Move
            </button>
            <button
              type="button"
              disabled={moveOffer.status === "moving"}
              onClick={declineMoveOffer}
            >
              Not now
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
                people={readyPeople?.people ?? null}
                hasUnsavedChanges={unsavedIds.has(project.id)}
                isInert={isAddingInPlace}
                thumbnailUrl={barThumbnails[project.id]}
                onOpen={(barHeight) => openProject(project, barHeight)}
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
        {isShowingList && list.length === 0 && unreadableCount === 0 && (
          <p className="dashboard-empty">No projects added yet.</p>
        )}
        {!isInPlace && open && (
          <ProjectWindow onClose={closeProject}>{form}</ProjectWindow>
        )}
      </main>
      <FloatingMessages boxes={messageBoxes} />
      <KeyboardShortcuts
        shortcuts={[
          {
            keyboardKeyLabel: "T",
            action: "Toggle tuning panel",
            isShown: !isTextFieldFocused,
          },
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
          {
            keyboardKeyLabel: "Esc",
            action: "Close open project",
            isShown: open !== null,
            onPress: closeOpenProject,
          },
        ]}
      />
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

// Whether anything has been entered in the Add project form.
function isChanged(values: ProjectFields) {
  return (Object.keys(values) as (keyof ProjectFields)[]).some(
    (key) =>
      JSON.stringify(values[key]) !== JSON.stringify(newProjectFields[key]),
  );
}

function joinList(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function pickFormValues({
  title,
  notes,
  assignee,
  dueDate,
  tasks,
}: ProjectFields): ProjectFields {
  return { title, notes, assignee, dueDate, tasks };
}

function describeFailure(reason: ProjectSaveFailure) {
  const text = {
    "no-title": "A project needs a title.",
    full: "Not saved: this browser's storage for Abodeo is full.",
    unavailable: "Not saved: this browser is not letting Abodeo save.",
    unreadable:
      "Not saved: the saved copy of this project cannot be read, so it has been left as it is.",
    unreachable: "Not saved: Abodeo cannot reach your projects right now.",
    "signed-out": "Not saved: you have been signed out.",
    "account-changed":
      "Not saved: this page is no longer signed in to this account.",
    "not-found": "Not saved: this project is no longer in your account.",
    "too-large": "Not saved: this project is too large to save.",
    "unknown-assignee":
      "Not saved: that person is no longer in the list, so please choose someone else.",
    refused: "Not saved: Abodeo could not accept this change.",
    conflict: "This project was changed on another device.",
  }[reason];
  return { text, isError: true } satisfies FormMessage;
}
