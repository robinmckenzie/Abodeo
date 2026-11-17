import { useEffect, useRef, useState } from "react";

import {
  binAccountProject,
  createAccountProject,
  openAccountProject,
  setPageLeaving,
  type OpenedAccountProject,
} from "./account-projects";
import {
  createAutosaver,
  type Autosaver,
  type ProjectSaveFailure,
  type ProjectSaveResult,
} from "./autosave";
import {
  createProject as createBrowserProject,
  deleteStoredProject,
  saveProjectChanges,
  saveProjectTasks,
} from "./project-storage";
import {
  changedSinceAddedMessage,
  createOpeningKey,
  deleteFailureMessage,
  describeFailure,
  describeLosses,
  isNewProjectChanged,
  isSameFields,
  pickFormValues,
  reconcileCreatedProject,
  tasksConflictMessage,
  toggleId,
  type Deletion,
  type OpenProject,
} from "./project-editing";
import {
  hasTitle,
  newProjectFields,
  type Project,
  type ProjectFields,
} from "./projects";
import type { TaskChange } from "./task-list";
import type { TaskDrafts } from "./task-drafts";
import type { Task } from "./tasks";
import {
  refreshProjects,
  type ProjectsSource,
  type ProjectsView,
} from "./use-projects";

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

export type ProjectEditingOptions = {
  source: ProjectsSource;
  // Text typed into add-task boxes, which the warning on leaving counts.
  taskDrafts: TaskDrafts;
  refreshBinCount: () => void;
  // A failure that may mean the sign-in has changed, or someone is gone.
  onAccountFailure: (reason: string) => void;
  // Someone named by a save is no longer in the list of people.
  onPeopleOutdated: () => void;
  // Where focus goes is the page's concern, so the lifecycle only reports.
  onClosed: (projectId: string | null) => void;
  onCreated: (project: Project) => void;
  onDeleted: () => void;
};

// Which source projects are being shown from. Checking the sign-in keeps
// the last one, so that it does not close what is open. An account whose
// projects or sign-in cannot be checked counts as a change, so that none of
// its projects stays shown.
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

// Opening, changing, saving, creating, closing and deleting a project, and
// which changes are not yet saved (AD #111 Extract Project Editing Lifecycle).
export function useProjectEditing(options: ProjectEditingOptions) {
  const { source, taskDrafts } = options;
  const { view } = source;
  const [open, setOpen] = useState<OpenProject | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [unsavedIds, setUnsavedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const saverRef = useRef<Autosaver | null>(null);
  const openedRef = useRef<OpenedProject | null>(null);
  // Saves of tasks and new projects on their way, for the warning on leaving
  // the page.
  const sendingRef = useRef(0);
  const browserCreatingKeyRef = useRef<string | null>(null);
  // The openings, current or closed, whose changes are not yet saved.
  const pendingKeysRef = useRef(new Set<string>());
  const unsavedIdsRef = useRef(unsavedIds);
  // Set once sign-in or sign-out is leaving the page, having asked already.
  const isLeavingRef = useRef(false);
  // Saves a task title being edited when the project closes.
  const finishTaskEditRef = useRef<(() => Promise<string | null>) | null>(null);
  const openRef = useRef(open);
  const isAccountSourceRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
    unsavedIdsRef.current = unsavedIds;
    isAccountSourceRef.current = view.kind === "account";
  });

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

  // Counts a save on its way, for the warning on leaving the page.
  const trackSending = async <Result,>(work: Promise<Result>) => {
    sendingRef.current++;
    try {
      return await work;
    } finally {
      sendingRef.current--;
    }
  };

  const closeProject = () => {
    if (!open) return;
    void finishTaskEditRef.current?.();
    saverRef.current?.saveNow();
    saverRef.current = null;
    openedRef.current = null;
    options.onClosed(open.id);
    setOpen(null);
  };

  const showNewProjectForm = () => {
    setOpen({
      key: createOpeningKey(),
      id: null,
      newId: crypto.randomUUID(),
      values: newProjectFields,
      message: null,
      barHeight: 0,
    });
  };

  const openNewProject = () => {
    closeProject();
    showNewProjectForm();
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
      else options.onAccountFailure(result.reason);
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
        else options.onAccountFailure(result.reason);
        return result.ok ? { ok: true } : result;
      },
      saveTasks: async (change) => {
        const result = await trackSending(opened.saveTasks(change));
        if (result.ok) source.showSavedProject(generation, result.project);
        else options.onAccountFailure(result.reason);
        return result;
      },
    };
  };

  const openProject = (project: Project, barHeight: number, slot?: number) => {
    closeProject();
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
          options.onPeopleOutdated();
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
    setOpen({
      key,
      id,
      values: pickFormValues(project),
      message: null,
      barHeight,
      slot,
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

  const changeFields = (changes: Partial<ProjectFields>) => {
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

  // Saves what is waiting, as when a field loses focus.
  const saveNow = () => saverRef.current?.saveNow();

  // Shows a change to the opened project's tasks at once and saves it
  // straight away, going back to the tasks as they were if saving fails.
  const changeTasks = async (change: TaskChange) => {
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

  const createProject = async () => {
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
        result = await createBrowserProject(open.values);
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
      result = await trackSending(
        createAccountProject(accountId, open.newId!, sending),
      );
      if (result.ok && !isSameFields(result.project, sending)) {
        const added = result.project;
        const { changes, isLost } = reconcileCreatedProject(
          sending,
          submitted,
          added,
        );
        let latest = added;
        if (Object.keys(changes).length > 0) {
          const saved = await trackSending(
            openAccountProject(accountId, added).saveChanges(changes),
          );
          if (saved.ok) latest = saved.project;
          else result = { ok: false, reason: saved.reason };
        }
        source.showSavedProject(generation, latest);
        if (result.ok && isLost) {
          result = { ok: false, reason: "changed-since-added" };
        }
      }
      if (result.ok) source.showSavedProject(generation, result.project);
      else options.onAccountFailure(result.reason);
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
    options.onCreated(result.project);
    setOpen(null);
  };

  // Asks for the opened project to be deleted, with the counts of what it
  // shows, null if not shown. A signed-in account's goes to the Bin; signed
  // out, there is none.
  const startDelete = (counts: {
    imageCount: number | null;
    appointmentCount: number | null;
  }) => {
    if (!open || open.id === null || open.isLoading) return;
    if (view.kind !== "account" && view.kind !== "browser") return;
    setDeletion({
      id: open.id,
      title: open.values.title,
      tasks: open.values.tasks,
      imageCount:
        view.kind === "account"
          ? (counts.imageCount ?? view.imageCounts[open.id] ?? 0)
          : 0,
      appointmentCount: counts.appointmentCount,
      mode: view.kind === "account" ? "bin" : "browser",
      isBusy: false,
      message: null,
    });
  };

  const cancelDelete = () => setDeletion(null);

  // Closes the project if it is open, once its pending save has finished, so
  // that nothing is saved to it afterwards, and then deletes it.
  const confirmDelete = async () => {
    if (!deletion || deletion.isBusy) return;
    const { id, mode } = deletion;
    const fail = (message: string) =>
      setDeletion((current) =>
        current?.id === id ? { ...current, isBusy: false, message } : current,
      );
    setDeletion({ ...deletion, isBusy: true, message: null });
    if (openRef.current?.id === id) {
      await finishTaskEditRef.current?.();
      await saverRef.current?.saveNow();
      closeProject();
    }
    if (mode === "browser") {
      const result = deleteStoredProject(id);
      refreshProjects();
      if (!result.ok) return fail(deleteFailureMessage);
    } else {
      if (view.kind !== "account") return fail(deleteFailureMessage);
      const result = await trackSending(binAccountProject(view.accountId, id));
      if (!result.ok) {
        options.onAccountFailure(result.reason);
        return fail(
          result.reason === "unreachable"
            ? "Not deleted: Abodeo cannot reach your projects right now."
            : deleteFailureMessage,
        );
      }
      source.removeProject(view.generation, id);
      options.refreshBinCount();
    }
    setDeletion(null);
    options.onDeleted();
  };

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
        if (isNewProjectChanged(current.values)) {
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
    if (taskDrafts.hasUnaddedText()) losses.push("tasks typed but not yet added");
    // Projects closed earlier whose changes are still on their way or
    // failed.
    if (pendingKeysRef.current.size > 0 || sendingRef.current > 0) {
      losses.push("changes still being saved");
    }
    if ([...unsavedIdsRef.current].some((id) => id !== current?.id)) {
      losses.push("changes to other projects that were not saved");
    }
    if (losses.length === 0) return true;
    return window.confirm(describeLosses(losses));
  };

  // Sign-in or sign-out is leaving the page, having asked already.
  const markLeaving = () => {
    isLeavingRef.current = true;
  };

  return {
    open,
    unsavedIds,
    deletion,
    finishTaskEditRef,
    openProject,
    openNewProject,
    showNewProjectForm,
    changeFields,
    changeTasks,
    createProject,
    closeProject,
    saveNow,
    keepSavedVersion,
    keepMine,
    startDelete,
    confirmDelete,
    cancelDelete,
    prepareToLeave,
    markLeaving,
    trackSending,
  };
}
