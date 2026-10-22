// The signed-in account, if any. It is kept apart from projects, tasks,
// assignees and settings: nothing here reads or changes them, though the
// dashboard is told just before sign-in or sign-out leaves the page. It is
// looked up
// once the page has loaded, so a slow or failed lookup never holds the page
// up, and again when the window comes back into use, when the session is due
// to end, and when another tab signs out, so that a session that has ended
// stops being shown.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { accountReturnPath } from "./account-api";
import {
  loadAccountSession,
  loadPreferredName,
  ProfileError,
  requestSignInAddress,
  savePreferredName as sendPreferredName,
  signOut as sendSignOut,
  type ProfileFailure,
} from "./account-client";
import {
  calculateRecheckDelay,
  hasSignInError,
  removeSignInError,
} from "./account-display";

export type AccountView =
  | { kind: "checking" }
  | { kind: "not-configured" }
  | { kind: "unavailable" }
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      id: string;
      name: string;
      email: string;
      preferredName: string | null;
      profile: "loading" | "ready" | "unavailable";
    };

export type ProfileSaveResult = "saved" | ProfileFailure;

export type Account = {
  view: AccountView;
  // About the last sign-in or sign-out, or null.
  message: string | null;
  isLeaving: boolean;
  signIn(): void;
  signOut(): void;
  // Looks up who is signed in again, such as after a request was refused.
  recheck(): void;
  savePreferredName(preferredName: string | null): Promise<ProfileSaveResult>;
};

export const signInFailedMessage =
  "Sign-in did not complete. Please try again.";
export const signInUnavailableMessage =
  "Sign-in is unavailable at the moment. Please try again later.";
export const signOutFailedMessage =
  "Sign-out did not complete, so you are still signed in. Please try again.";

// Checks prompted by the window coming back into use are at least this far
// apart, as each one reaches the database.
export const recheckInterval = 10_000;

// Other tabs hear of a sign-out on this channel.
const channelName = "abodeo-account";

export function useAccount({
  onBeforeLeave,
  onLeaving,
}: {
  // Gets the page ready to be left, false if the person chose to stay.
  onBeforeLeave: () => Promise<boolean>;
  // Just before sign-in or sign-out leaves the page.
  onLeaving?: (action: "sign-in" | "sign-out") => void;
}): Account {
  const location = useLocation();
  const navigate = useNavigate();
  const [view, setView] = useState<AccountView>({ kind: "checking" });
  const [message, setMessage] = useState<string | null>(() =>
    hasSignInError(location.search) ? signInFailedMessage : null,
  );
  const [isLeaving, setIsLeaving] = useState(false);
  const viewRef = useRef(view);
  const onBeforeLeaveRef = useRef(onBeforeLeave);
  const onLeavingRef = useRef(onLeaving);
  const recheckRef = useRef(() => {});
  useEffect(() => {
    viewRef.current = view;
    onBeforeLeaveRef.current = onBeforeLeave;
    onLeavingRef.current = onLeaving;
  });

  // Removes the sign-in error from the address, so that a reload does not
  // show the message again.
  const isErrorInAddress = hasSignInError(location.search);
  useEffect(() => {
    if (!isErrorInAddress) return;
    navigate(
      {
        pathname: location.pathname,
        search: removeSignInError(location.search),
      },
      { replace: true, state: location.state },
    );
  }, [isErrorInAddress, location, navigate]);

  useEffect(() => {
    let isCurrent = true;
    // Only the latest check's answer is shown.
    let checks = 0;
    let lastCheck = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      const thisCheck = ++checks;
      lastCheck = Date.now();
      clearTimeout(timer);
      const session = await loadAccountSession();
      if (!isCurrent || thisCheck !== checks) return;
      if (session.kind !== "signed-in") {
        setView(session);
        return;
      }
      timer = setTimeout(
        check,
        calculateRecheckDelay(session.expiresAt, Date.now()),
      );
      const { id, name, email } = session;
      const shown = viewRef.current;
      // The same account: its profile is already shown.
      if (shown.kind === "signed-in" && shown.id === id) {
        if (shown.profile !== "unavailable") return;
      } else {
        setView({
          kind: "signed-in",
          id,
          name,
          email,
          preferredName: null,
          profile: "loading",
        });
      }
      try {
        const preferredName = await loadPreferredName();
        if (!isCurrent || thisCheck !== checks) return;
        setView({
          ...shownAs(id, name, email),
          preferredName,
          profile: "ready",
        });
      } catch (error) {
        if (!isCurrent || thisCheck !== checks) return;
        setView(
          error instanceof ProfileError && error.failure === "signed-out"
            ? { kind: "signed-out" }
            : {
                ...shownAs(id, name, email),
                preferredName: null,
                profile: "unavailable",
              },
        );
      }
    };

    const checkIfDue = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck >= recheckInterval) void check();
    };

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = () => void check();
    } catch {
      // Without it, other tabs notice a sign-out when next used.
    }

    recheckRef.current = () => void check();
    void check();
    window.addEventListener("focus", checkIfDue);
    document.addEventListener("visibilitychange", checkIfDue);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener("focus", checkIfDue);
      document.removeEventListener("visibilitychange", checkIfDue);
    };
  }, []);

  const leave = async (go: () => Promise<void>) => {
    if (isLeaving) return;
    setMessage(null);
    setIsLeaving(true);
    try {
      if (await onBeforeLeaveRef.current()) await go();
    } finally {
      setIsLeaving(false);
    }
  };

  // Sign-in leaves for Google, which returns to the dashboard.
  const signIn = () =>
    void leave(async () => {
      try {
        const address = await requestSignInAddress();
        onLeavingRef.current?.("sign-in");
        window.location.assign(address);
      } catch {
        setMessage(signInUnavailableMessage);
      }
    });

  // Sign-out loads the dashboard afresh, signed out, as sign-in does.
  const signOut = () =>
    void leave(async () => {
      try {
        await sendSignOut();
      } catch {
        setMessage(signOutFailedMessage);
        return;
      }
      announceSignOut();
      onLeavingRef.current?.("sign-out");
      window.location.replace(accountReturnPath);
    });

  const savePreferredName = async (
    preferredName: string | null,
  ): Promise<ProfileSaveResult> => {
    try {
      const saved = await sendPreferredName(preferredName);
      setView((current) =>
        current.kind === "signed-in"
          ? { ...current, preferredName: saved, profile: "ready" }
          : current,
      );
      return "saved";
    } catch (error) {
      const failure =
        error instanceof ProfileError ? error.failure : "unavailable";
      if (failure === "signed-out") setView({ kind: "signed-out" });
      return failure;
    }
  };

  const recheck = () => recheckRef.current();

  return {
    view,
    message,
    isLeaving,
    signIn,
    signOut,
    recheck,
    savePreferredName,
  };
}

function shownAs(id: string, name: string, email: string) {
  return { kind: "signed-in" as const, id, name, email };
}

function announceSignOut() {
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage("signed-out");
    channel.close();
  } catch {
    // Other tabs notice when next used.
  }
}
