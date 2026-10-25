// The appointments of one account project, for as long as the project is
// open (AD #70 Add Appointments To Projects). Mount it for one account and
// project, keyed on both: when it unmounts, an answer that arrives later is
// dropped. The appointments are Google Calendar events that Abodeo's own
// endpoints read and write; the browser never sees Google's token.
import { useCallback, useEffect, useRef, useState } from "react";

import { requestTimeout } from "../account/account-client";
import { accountHeader } from "../projects/projects-api";
import {
  calendarAppointmentsPath,
  calendarConnectionPath,
  type Appointment,
  type AppointmentFields,
  type AppointmentsResponse,
  type ConnectionResponse,
  type CreateAppointmentError,
} from "./appointments-api";
import {
  calendarTestAppointmentPath,
  type CalendarResult,
} from "./calendar-api";

type Fetch = typeof fetch;

// How many times this page load has gone through Google by itself. At most
// one, so that a grant that does not fix the token cannot loop.
let automaticReconnects = 0;

export function resetAutomaticReconnects() {
  automaticReconnects = 0;
}

// Results after which Abodeo does not go through Google by itself.
export function isReconnectBlockedBy(result: CalendarResult | undefined) {
  return (
    result === "denied" || result === "wrong-account" || result === "failed"
  );
}

export type AppointmentsState =
  | { status: "loading" }
  | { status: "ready"; appointments: Appointment[] }
  // Google's token is missing or no good, and the person has to connect.
  | { status: "needs-grant" }
  // On the way to Google.
  | { status: "connecting" }
  // Google cannot be reached or the answer was not usable.
  | { status: "unavailable" };

export type AddResult =
  | { ok: true }
  | {
      ok: false;
      reason: CreateAppointmentError | "signed-out" | "unreachable";
    };

export type ProjectAppointmentsOptions = {
  accountId: string;
  projectId: string;
  // Asked once, as the section appears: whether to open the new appointment
  // form at once, because Google has just returned the browser with a good
  // token.
  shouldOpenForm?: () => boolean;
  // Whether opening the project may go through Google by itself. False
  // straight after the person refused or Google failed.
  canReconnectAutomatically?: boolean;
  // Gets the page ready to be left, false if the person chose to stay.
  onBeforeLeave: () => Promise<boolean>;
  // A failure that means the sign-in has changed, for the dashboard to check.
  onSignInChange?: (reason: "signed-out" | "account-changed") => void;
  fetchFn?: Fetch;
  // Where the page goes to reach Google.
  navigate?: (address: string) => void;
};

function readBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

async function readJson(response: Response) {
  return (await response.json().catch(() => undefined)) as unknown;
}

export function useProjectAppointments({
  accountId,
  projectId,
  shouldOpenForm,
  canReconnectAutomatically = true,
  onBeforeLeave,
  onSignInChange,
  fetchFn = fetch,
  navigate = (address) => window.location.assign(address),
}: ProjectAppointmentsOptions) {
  const [state, setState] = useState<AppointmentsState>({ status: "loading" });
  const [isFormOpen, setIsFormOpen] = useState(
    () => shouldOpenForm?.() ?? false,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const isCurrentRef = useRef(true);
  const optionsRef = useRef({
    onBeforeLeave,
    onSignInChange,
    fetchFn,
    navigate,
    canReconnectAutomatically,
  });
  useEffect(() => {
    optionsRef.current = {
      onBeforeLeave,
      onSignInChange,
      fetchFn,
      navigate,
      canReconnectAutomatically,
    };
  });

  const send = useCallback(
    (path: string, init: RequestInit = {}) => {
      // Called on its own: the browser's fetch fails if called as a method.
      const { fetchFn: sendRequest } = optionsRef.current;
      return sendRequest(path, {
        credentials: "same-origin",
        ...init,
        headers: { [accountHeader]: accountId, ...init.headers },
        signal: AbortSignal.timeout(requestTimeout),
      });
    },
    [accountId],
  );

  // A refusal that means the page's sign-in is out of date.
  const noteSignInChange = useCallback((status: number) => {
    if (status === 401) optionsRef.current.onSignInChange?.("signed-out");
    if (status === 409) optionsRef.current.onSignInChange?.("account-changed");
  }, []);

  // Saves the page, then goes through Google and comes back to this project.
  // False if the person chose to stay, or Google could not be started.
  const connect = useCallback(
    async (openForm: boolean) => {
      if (!(await optionsRef.current.onBeforeLeave())) return false;
      try {
        const response = await send(calendarTestAppointmentPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timeZone: readBrowserTimeZone(),
            projectId,
            openForm,
          }),
        });
        const body = response.ok ? await readJson(response) : undefined;
        const url = (body as { url?: unknown } | undefined)?.url;
        if (typeof url !== "string") {
          noteSignInChange(response.status);
          return false;
        }
        optionsRef.current.navigate(url);
        return true;
      } catch {
        return false;
      }
    },
    [projectId, send, noteSignInChange],
  );

  useEffect(() => {
    isCurrentRef.current = true;
    const run = async () => {
      let next: AppointmentsState = { status: "unavailable" };
      try {
        const response = await send(
          `${calendarAppointmentsPath}?projectId=${encodeURIComponent(projectId)}`,
        );
        if (!isCurrentRef.current) return;
        const body = response.ok
          ? ((await readJson(response)) as AppointmentsResponse | undefined)
          : undefined;
        if (!isCurrentRef.current) return;
        noteSignInChange(response.status);
        if (body?.status === "ok" && Array.isArray(body.appointments)) {
          next = { status: "ready", appointments: body.appointments };
        } else if (body?.status === "needs-grant") {
          const mayRedirect =
            body.connectedBefore === true &&
            optionsRef.current.canReconnectAutomatically &&
            automaticReconnects === 0;
          next = { status: "needs-grant" };
          if (mayRedirect) {
            automaticReconnects += 1;
            setState({ status: "connecting" });
            if (await connect(false)) return;
            if (!isCurrentRef.current) return;
          }
        }
      } catch {
        if (!isCurrentRef.current) return;
      }
      setState(next);
    };
    void run();
    return () => {
      isCurrentRef.current = false;
    };
  }, [projectId, reloads, send, connect, noteSignInChange]);

  // Opens the form if Google's token is good enough to fill it in, and goes
  // through Google first if not, so nothing unsaved is lost at the redirect.
  const openForm = async () => {
    setMessage(null);
    try {
      const response = await send(calendarConnectionPath);
      const body = response.ok
        ? ((await readJson(response)) as ConnectionResponse | undefined)
        : undefined;
      if (!isCurrentRef.current) return;
      noteSignInChange(response.status);
      if (body?.ready === true) {
        setIsFormOpen(true);
        return;
      }
      if (body === undefined) throw new Error("no answer");
    } catch {
      if (isCurrentRef.current) {
        setMessage(
          "The appointment form could not be opened. Please try again.",
        );
      }
      return;
    }
    const before = state;
    setState({ status: "connecting" });
    if (!(await connect(true)) && isCurrentRef.current) setState(before);
  };

  const closeForm = () => setIsFormOpen(false);

  // Adds the appointment, then shows the list as Google now has it.
  const add = async (fields: AppointmentFields): Promise<AddResult> => {
    try {
      const response = await send(calendarAppointmentsPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          projectId,
          timeZone: readBrowserTimeZone() ?? null,
        }),
      });
      if (!isCurrentRef.current) return { ok: false, reason: "unreachable" };
      if (response.ok) {
        setIsFormOpen(false);
        setReloads((count) => count + 1);
        return { ok: true };
      }
      noteSignInChange(response.status);
      if (response.status === 401 || response.status === 409) {
        const body = (await readJson(response)) as
          { error?: unknown } | undefined;
        if (body?.error === "token_expired") {
          return { ok: false, reason: "token_expired" };
        }
        return { ok: false, reason: "signed-out" };
      }
      return {
        ok: false,
        reason: response.status === 400 ? "invalid" : "unavailable",
      };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  };

  // The Connect button (without the form), and Reconnect after the token
  // ended with the form open (with it, empty: what was typed is not kept).
  const reconnect = async (withForm: boolean) => {
    setMessage(null);
    const before = state;
    setState({ status: "connecting" });
    if (!(await connect(withForm)) && isCurrentRef.current) setState(before);
  };

  return { state, isFormOpen, message, openForm, closeForm, add, reconnect };
}
