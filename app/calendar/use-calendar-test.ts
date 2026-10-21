// The "Create test appointment" action (AD #10 Prove Calendar Access). It
// leaves for Google, which asks for the Calendar permission, and the server
// returns the browser to the dashboard with ?calendar=<result>. The result is
// shown once and removed from the address, so a reload does not repeat it.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  calendarResultParameter,
  calendarTestAppointmentPath,
  readCalendarResult,
  removeCalendarResult,
  type CalendarResult,
} from "./calendar-api";

export const calendarMessages: Record<CalendarResult, string> = {
  created: "Test appointment created in your Abodeo calendar.",
  denied: "Calendar access was not given, so no appointment was created.",
  "wrong-account":
    "Choose the Google account you signed in with. No appointment was created.",
  failed: "The test appointment could not be created. Please try again.",
};

// Google Calendar in the given account, rather than the browser's default
// Google account (AD #44 Open Signed-In Calendar). Without an email address it
// opens the default account.
export function buildGoogleCalendarAddress(email?: string) {
  if (!email) return "https://calendar.google.com/";
  const query = new URLSearchParams({ authuser: email });
  return `https://calendar.google.com/calendar/u/?${query}`;
}

const requestTimeout = 8000;

function readBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

// Google's address for the Calendar permission. The server decides what
// Google is asked for.
export async function requestCalendarAddress(fetchFn: typeof fetch = fetch) {
  const response = await fetchFn(calendarTestAppointmentPath, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeZone: readBrowserTimeZone() }),
    signal: AbortSignal.timeout(requestTimeout),
  });
  const body: unknown = response.ok ? await response.json() : undefined;
  const url = (body as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string") throw new Error("The test could not start.");
  return url;
}

export type CalendarTest = {
  // The last test's result, or null.
  result: CalendarResult | null;
  isLeaving: boolean;
  createTestAppointment(): void;
};

export function useCalendarTest({
  onBeforeLeave,
}: {
  // Gets the page ready to be left, false if the person chose to stay.
  onBeforeLeave: () => Promise<boolean>;
}): CalendarTest {
  const location = useLocation();
  const navigate = useNavigate();
  const [result, setResult] = useState<CalendarResult | null>(
    () => readCalendarResult(location.search) ?? null,
  );
  const [isLeaving, setIsLeaving] = useState(false);
  const onBeforeLeaveRef = useRef(onBeforeLeave);
  useEffect(() => {
    onBeforeLeaveRef.current = onBeforeLeave;
  });

  const isResultInAddress = new URLSearchParams(location.search).has(
    calendarResultParameter,
  );
  useEffect(() => {
    if (!isResultInAddress) return;
    navigate(
      {
        pathname: location.pathname,
        search: removeCalendarResult(location.search),
      },
      { replace: true, state: location.state },
    );
  }, [isResultInAddress, location, navigate]);

  const createTestAppointment = () => {
    if (isLeaving) return;
    void (async () => {
      setResult(null);
      setIsLeaving(true);
      try {
        if (!(await onBeforeLeaveRef.current())) return;
        try {
          window.location.assign(await requestCalendarAddress());
        } catch {
          setResult("failed");
        }
      } finally {
        setIsLeaving(false);
      }
    })();
  };

  return { result, isLeaving, createTestAppointment };
}
