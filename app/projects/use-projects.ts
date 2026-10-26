// The browser's saved projects, read from storage when first needed and
// again after each save, or when another tab saves. The server cannot see
// local storage, so it renders without projects, and the dashboard fills them
// in once the page has loaded, without a hydration mismatch. The app's default
// projects are received once per page load, before projects are first read.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { recheckInterval, type AccountView } from "../account/use-account";
import { loadAccountProjects } from "./account-projects";
import {
  isProjectKey,
  loadProjects as loadSavedProjects,
  receiveDefaultProjects,
  removeAccountHint,
  writeAccountHint,
  type LoadResult,
} from "./project-storage";
import { sortProjectsByDueDate, type Project } from "./projects";

let current: LoadResult | null = null;
const listeners = new Set<() => void>();
let hasReceivedDefaults = false;

// Also needed before the people are first read, as it is the default
// projects' assignees that they are made from.
export function receiveDefaultProjectsOnce() {
  if (hasReceivedDefaults) return;
  hasReceivedDefaults = true;
  receiveDefaultProjects();
}

function loadProjects() {
  receiveDefaultProjectsOnce();
  return loadSavedProjects();
}

function readProjects() {
  current ??= loadProjects();
  return current;
}

export function refreshProjects() {
  current = loadProjects();
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (isProjectKey(event.key)) refreshProjects();
}

// Reads storage again on starting to listen, as other tabs may have saved
// while nothing was listening.
function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    current = loadProjects();
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// Null on the server and while the page hydrates.
export function useProjects(): LoadResult | null {
  return useSyncExternalStore(subscribe, readProjects, () => null);
}

// Where the dashboard's projects come from: the browser while signed out,
// or where sign-in is not set up, and the account while signed in. While
// the sign-in is being checked, or cannot be checked, no projects are
// shown, so that a signed-in person never edits the browser's projects by
// mistake. Each change of account starts a new generation, and answers for
// an earlier one are dropped.
export type ProjectsView =
  | { kind: "checking" }
  | { kind: "browser"; result: LoadResult | null }
  | { kind: "unavailable" }
  | {
      kind: "account";
      accountId: string;
      generation: number;
      state: "loading" | "ready" | "unavailable";
      projects: Project[];
      unreadableCount: number;
      defaultIds: string[];
      // The newest image of each project that has any (AD #48 Add Images To
      // Projects), for its bar's thumbnail.
      latestImageIds: Record<string, string>;
      // How many images each project that has any holds (AD #62 Delete
      // Projects), for the warning before it is deleted.
      imageCounts: Record<string, number>;
    };

export type ProjectsSource = {
  view: ProjectsView;
  // Shows a project's newest image as it is now, as an open project's images
  // change. Null when it has none.
  showLatestImage(
    generation: number,
    projectId: string,
    imageId: string | null,
  ): void;
  // Shows a project as just saved in the account, without loading them all.
  showSavedProject(generation: number, project: Project): void;
  // Takes a project out of the list once it has been deleted, and keeps any
  // save or load still on its way from putting it back.
  removeProject(generation: number, projectId: string): void;
  reload(): void;
};

type AccountState = Extract<ProjectsView, { kind: "account" }>;

let generations = 0;

export function useProjectsSource(
  account: AccountView,
  onSignedOut: () => void,
): ProjectsSource {
  const browser = useProjects();
  const accountId = account.kind === "signed-in" ? account.id : null;
  const [state, setState] = useState<AccountState | null>(null);
  // Set by the current account's effect, for use from event handlers.
  const actionsRef = useRef({ reload: () => {}, noteSavedProject: () => {} });
  // The projects deleted from this page, whose id must not come back from a
  // save or a load that was on its way when they went.
  const deletedIdsRef = useRef(new Set<string>());
  const onSignedOutRef = useRef(onSignedOut);
  useEffect(() => {
    onSignedOutRef.current = onSignedOut;
  });

  // Signed out, the account's hint no longer applies.
  const isBrowser =
    account.kind === "signed-out" || account.kind === "not-configured";
  useEffect(() => {
    if (isBrowser) removeAccountHint();
  }, [isBrowser]);

  useEffect(() => {
    if (!accountId) return;
    deletedIdsRef.current = new Set();
    const generation = ++generations;
    let isCurrent = true;
    let lastLoad = 0;
    let loads = 0;
    let savedProjects = 0;
    const load = async () => {
      const thisLoad = ++loads;
      lastLoad = Date.now();
      const savedAtStart = savedProjects;
      const result = await loadAccountProjects(accountId);
      if (!isCurrent || thisLoad !== loads) return;
      if (!result.ok) {
        if (
          result.reason === "signed-out" ||
          result.reason === "account-changed"
        ) {
          onSignedOutRef.current();
        }
        setState({
          kind: "account",
          accountId,
          generation,
          state: "unavailable",
          projects: [],
          unreadableCount: 0,
          defaultIds: [],
          latestImageIds: {},
          imageCounts: {},
        });
        return;
      }
      // A save answered while this load was on its way, so it may be out of
      // date. Another load starts at once.
      if (savedProjects !== savedAtStart) {
        void load();
        return;
      }
      const { unreadableCount, defaultIds, latestImageIds, imageCounts } =
        result;
      const projects = result.projects.filter(
        ({ id }) => !deletedIdsRef.current.has(id),
      );
      writeAccountHint(
        accountId,
        hasOwnAccountProjects(projects, unreadableCount, defaultIds),
      );
      setState({
        kind: "account",
        accountId,
        generation,
        state: "ready",
        projects,
        unreadableCount,
        defaultIds,
        latestImageIds,
        imageCounts,
      });
    };
    const loadIfDue = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoad >= recheckInterval) void load();
    };
    actionsRef.current = {
      reload: () => void load(),
      noteSavedProject: () => void savedProjects++,
    };
    void load();
    window.addEventListener("focus", loadIfDue);
    document.addEventListener("visibilitychange", loadIfDue);
    return () => {
      isCurrent = false;
      actionsRef.current = { reload: () => {}, noteSavedProject: () => {} };
      window.removeEventListener("focus", loadIfDue);
      document.removeEventListener("visibilitychange", loadIfDue);
    };
  }, [accountId]);

  let view: ProjectsView;
  if (account.kind === "checking") view = { kind: "checking" };
  else if (isBrowser) view = { kind: "browser", result: browser };
  else if (account.kind === "unavailable") view = { kind: "unavailable" };
  else if (state?.accountId === accountId) view = state;
  else {
    view = {
      kind: "account",
      accountId: accountId!,
      generation: 0,
      state: "loading",
      projects: [],
      unreadableCount: 0,
      defaultIds: [],
      latestImageIds: {},
      imageCounts: {},
    };
  }

  return {
    view,
    showLatestImage(generation, projectId, imageId) {
      setState((current) => {
        if (current?.generation !== generation || current.state !== "ready") {
          return current;
        }
        if ((current.latestImageIds[projectId] ?? null) === imageId) {
          return current;
        }
        const others = Object.entries(current.latestImageIds).filter(
          ([id]) => id !== projectId,
        );
        const latestImageIds = Object.fromEntries(
          imageId ? [...others, [projectId, imageId]] : others,
        );
        return { ...current, latestImageIds };
      });
    },
    showSavedProject(generation, project) {
      actionsRef.current.noteSavedProject();
      setState((current) => {
        if (current?.generation !== generation || current.state !== "ready") {
          return current;
        }
        if (deletedIdsRef.current.has(project.id)) return current;
        // An answer can arrive after a newer one, such as for a project
        // closed and opened again, so an older copy is not shown over it.
        const shown = current.projects.find(({ id }) => id === project.id);
        if (shown && shown.updatedAt > project.updatedAt) return current;
        const others = current.projects.filter(({ id }) => id !== project.id);
        const projects = sortProjectsByDueDate([...others, project]);
        writeAccountHint(
          current.accountId,
          hasOwnAccountProjects(
            projects,
            current.unreadableCount,
            current.defaultIds,
          ),
        );
        return { ...current, projects };
      });
    },
    removeProject(generation, projectId) {
      deletedIdsRef.current.add(projectId);
      // A load on its way may have been read before the delete.
      actionsRef.current.noteSavedProject();
      setState((current) => {
        if (current?.generation !== generation || current.state !== "ready") {
          return current;
        }
        const projects = current.projects.filter(({ id }) => id !== projectId);
        const without = <Value>(values: Record<string, Value>) =>
          Object.fromEntries(
            Object.entries(values).filter(([id]) => id !== projectId),
          );
        writeAccountHint(
          current.accountId,
          hasOwnAccountProjects(
            projects,
            current.unreadableCount,
            current.defaultIds,
          ),
        );
        return {
          ...current,
          projects,
          latestImageIds: without(current.latestImageIds),
          imageCounts: without(current.imageCounts),
        };
      });
    },
    reload: () => actionsRef.current.reload(),
  };
}

// As in the browser, a project that cannot be read counts as the person's
// own, and default projects do not.
function hasOwnAccountProjects(
  projects: Project[],
  unreadableCount: number,
  defaultIds: string[],
) {
  return (
    unreadableCount > 0 || projects.some(({ id }) => !defaultIds.includes(id))
  );
}
