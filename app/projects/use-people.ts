// The list of people (AD #61 Manage People), from where the projects are: the
// browser while signed out, or where sign-in is not set up, and the account
// while signed in. The browser's list is read from storage when first needed
// and again when another tab changes it. The server cannot see local storage,
// so it renders without people, and the page fills them in once it has loaded,
// without a hydration mismatch. An account's list is only held in memory.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { recheckInterval, type AccountView } from "../account/use-account";
import {
  addAccountPerson,
  countAccountAssignedProjects,
  establishAccountPeople,
  loadAccountPeople,
  removeAccountPerson,
  renameAccountPerson,
  type AccountPeopleChange,
} from "./account-people";
import { createPersonId, type Person } from "./people";
import {
  addStoredPerson,
  countStoredAssignedProjects,
  loadPeople,
  removeStoredPerson,
  renameStoredPerson,
  type PeopleLoad,
} from "./people-management";
import { isPeopleKey } from "./people-storage";
import type { PersonFailure } from "./people-messages";
import { receiveDefaultProjectsOnce, refreshProjects } from "./use-projects";

let current: PeopleLoad | null = null;
const listeners = new Set<() => void>();

// The default projects are received first, so that their assignees are the
// ones the first list is made from.
function loadPeopleAfterDefaults() {
  receiveDefaultProjectsOnce();
  return loadPeople();
}

function readPeople() {
  current ??= loadPeopleAfterDefaults();
  return current;
}

export function refreshPeople() {
  current = loadPeopleAfterDefaults();
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (isPeopleKey(event.key)) refreshPeople();
}

// Reads storage again on starting to listen, as other tabs may have saved
// while nothing was listening.
function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    current = loadPeopleAfterDefaults();
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// Null on the server and while the page hydrates.
function useBrowserPeople(): PeopleLoad | null {
  return useSyncExternalStore(subscribe, readPeople, () => null);
}

export type PeopleView =
  | { status: "loading" }
  // The list cannot be loaded right now.
  | { status: "unavailable" }
  // The saved list is damaged or from a later version, and is left as it is.
  | { status: "unreadable" }
  // isEstablished is false for an account with no saved list yet, whose
  // people are those its projects are assigned to, until one is saved.
  | { status: "ready"; people: Person[]; isEstablished: boolean };

export type PeopleSource = {
  view: PeopleView;
  // Adds a new person. The id is made here, so that a retry finds the person
  // already added.
  addPerson(
    name: string,
  ): Promise<
    { ok: true; person: Person } | { ok: false; reason: PersonFailure }
  >;
  renamePerson(
    id: string,
    name: string,
  ): Promise<{ ok: true } | { ok: false; reason: PersonFailure }>;
  // How many projects removing the person would set to Unassigned, and how
  // many could not be read and would be left as they are.
  countAssignedProjects(
    id: string,
  ): Promise<
    | { ok: true; count: number; unreadable: number }
    | { ok: false; reason: PersonFailure }
  >;
  removePerson(
    id: string,
    expectedCount: number,
  ): Promise<
    | { ok: true }
    | ({ ok: false; reason: "count-changed" } & {
        count: number;
        unreadable: number;
      })
    | { ok: false; reason: PersonFailure }
  >;
  reload(): void;
};

type AccountState = {
  accountId: string;
  view: PeopleView;
};

const loadingView: PeopleView = { status: "loading" };

// isEstablishDue is true once the offer to move the browser's projects into
// the account is settled, so that an account's list can be saved without
// getting in the way of the move.
export function usePeople(
  account: AccountView,
  {
    isEstablishDue = false,
    onAccountFailure,
  }: {
    isEstablishDue?: boolean;
    onAccountFailure?: (reason: string) => void;
  } = {},
): PeopleSource {
  const browser = useBrowserPeople();
  const accountId = account.kind === "signed-in" ? account.id : null;
  useEffect(() => {
    accountIdRef.current = accountId;
  });
  const isBrowser =
    account.kind === "signed-out" || account.kind === "not-configured";
  const [state, setState] = useState<AccountState | null>(null);
  const reloadRef = useRef(() => {});
  // Counts the loads started and the changes shown, so that a list read
  // before a change is not shown over it.
  const loadsRef = useRef(0);
  const accountIdRef = useRef<string | null>(null);
  const onAccountFailureRef = useRef(onAccountFailure);
  useEffect(() => {
    onAccountFailureRef.current = onAccountFailure;
  });

  useEffect(() => {
    if (!accountId) return;
    let isCurrent = true;
    let lastLoad = 0;
    const load = async () => {
      const thisLoad = ++loadsRef.current;
      lastLoad = Date.now();
      const result = await loadAccountPeople(accountId);
      if (!isCurrent || thisLoad !== loadsRef.current) return;
      if (result.ok) {
        setState({
          accountId,
          view: {
            status: "ready",
            people: result.people,
            isEstablished: result.established,
          },
        });
        return;
      }
      if (
        result.reason === "signed-out" ||
        result.reason === "account-changed"
      ) {
        onAccountFailureRef.current?.(result.reason);
      }
      setState({
        accountId,
        view: {
          status:
            result.reason === "list-unreadable" ? "unreadable" : "unavailable",
        },
      });
    };
    const loadIfDue = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoad >= recheckInterval) void load();
    };
    reloadRef.current = () => void load();
    void load();
    window.addEventListener("focus", loadIfDue);
    document.addEventListener("visibilitychange", loadIfDue);
    return () => {
      isCurrent = false;
      reloadRef.current = () => {};
      window.removeEventListener("focus", loadIfDue);
      document.removeEventListener("visibilitychange", loadIfDue);
    };
  }, [accountId]);

  let view: PeopleView;
  if (isBrowser) {
    if (!browser) view = loadingView;
    else if (browser.ok) {
      view = { status: "ready", people: browser.people, isEstablished: true };
    } else {
      view = {
        status: browser.reason === "unreadable" ? "unreadable" : "unavailable",
      };
    }
  } else if (account.kind === "unavailable") view = { status: "unavailable" };
  else if (state?.accountId === accountId && accountId) view = state.view;
  else view = loadingView;

  // Shows the list as the server has just saved it.
  const showChange = (
    forAccountId: string,
    result: Extract<AccountPeopleChange, { ok: true }>,
  ) => {
    // Only for the account shown, so that an earlier account's answer does
    // not cancel the load of this one.
    if (forAccountId === accountIdRef.current) loadsRef.current++;
    setState({
      accountId: forAccountId,
      view: { status: "ready", people: result.people, isEstablished: true },
    });
  };

  const accountView = view.status === "ready" ? view : null;
  const shouldEstablish =
    accountId !== null &&
    isEstablishDue &&
    accountView !== null &&
    !accountView.isEstablished;
  useEffect(() => {
    if (!shouldEstablish || !accountId) return;
    let isCurrent = true;
    void establishAccountPeople(accountId).then((result) => {
      if (isCurrent && result.ok) showChange(accountId, result);
    });
    return () => {
      isCurrent = false;
    };
  }, [shouldEstablish, accountId]);

  const noteFailure = (reason: PersonFailure) => {
    if (reason === "signed-out" || reason === "account-changed") {
      onAccountFailureRef.current?.(reason);
    }
    if (reason === "list-unreadable" && accountId) {
      setState({ accountId, view: { status: "unreadable" } });
    }
  };

  const fromStorage = (reason: "unreadable" | "unavailable" | string) =>
    (reason === "unreadable" ? "list-unreadable" : reason) as PersonFailure;

  return {
    view,

    async addPerson(name) {
      const id = createPersonId();
      if (accountId) {
        const result = await addAccountPerson(accountId, id, name);
        if (!result.ok) {
          noteFailure(result.reason);
          return result;
        }
        showChange(accountId, result);
        return {
          ok: true,
          person: result.people.find((person) => person.id === id)!,
        };
      }
      const result = await addStoredPerson(id, name);
      if (!result.ok) return { ok: false, reason: fromStorage(result.reason) };
      refreshPeople();
      return {
        ok: true,
        person: result.people.find((person) => person.id === id)!,
      };
    },

    async renamePerson(id, name) {
      if (accountId) {
        const result = await renameAccountPerson(accountId, id, name);
        if (!result.ok) {
          noteFailure(result.reason);
          return result;
        }
        showChange(accountId, result);
        return { ok: true };
      }
      const result = await renameStoredPerson(id, name);
      if (!result.ok) return { ok: false, reason: fromStorage(result.reason) };
      refreshPeople();
      return { ok: true };
    },

    async countAssignedProjects(id) {
      if (accountId) {
        const result = await countAccountAssignedProjects(accountId, id);
        if (!result.ok) noteFailure(result.reason);
        return result;
      }
      const count = countStoredAssignedProjects(id);
      return count === null
        ? { ok: false, reason: "unavailable" }
        : { ok: true, count, unreadable: 0 };
    },

    async removePerson(id, expectedCount) {
      if (accountId) {
        const result = await removeAccountPerson(accountId, id, expectedCount);
        if (result.ok) showChange(accountId, result);
        else if (result.reason !== "count-changed") noteFailure(result.reason);
        return result;
      }
      const result = await removeStoredPerson(id, expectedCount);
      refreshPeople();
      refreshProjects();
      if (result.ok) return { ok: true };
      if (result.reason === "count-changed") {
        return { ...result, unreadable: 0 };
      }
      return { ok: false, reason: fromStorage(result.reason) };
    },

    reload() {
      if (accountId) reloadRef.current();
      else refreshPeople();
    },
  };
}
