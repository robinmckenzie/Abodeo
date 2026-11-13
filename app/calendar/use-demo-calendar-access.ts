// Robin's control for the demo account's stored Calendar access (AD #138
// Demo Entry And Seed): when it was stored, and storing it, which leaves for
// Google's consent screen. The server returns the browser to the dashboard
// with ?calendar=stored, which the Calendar test's message shows. Mount it
// only where the demo seed control shows, as the server refuses anyone else.
import { useEffect, useState } from "react";

import { requestTimeout } from "../account/account-client";
import {
  calendarDemoAccessPath,
  type DemoAccessResponse,
} from "./calendar-api";
import { requestCalendarAddress } from "./use-calendar-test";

export const accessNotStoredMessage =
  "Calendar access could not be stored. Please try again.";

// When access was stored, or null if none is or it cannot be read.
export async function loadDemoAccessStatus(fetchFn: typeof fetch = fetch) {
  try {
    const response = await fetchFn(calendarDemoAccessPath, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(requestTimeout),
    });
    const body = response.ok
      ? ((await response.json()) as Partial<DemoAccessResponse> | null)
      : null;
    return typeof body?.savedAt === "string" ? body.savedAt : null;
  } catch {
    return null;
  }
}

export function useDemoCalendarAccess(
  // Gets the page ready to be left, false if the person chose to stay.
  onBeforeLeave: () => Promise<boolean>,
  navigate: (address: string) => void = (address) =>
    window.location.assign(address),
) {
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void loadDemoAccessStatus().then((loaded) => {
      if (isCurrent) setSavedAt(loaded);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const store = async () => {
    setIsLeaving(true);
    setMessage(null);
    try {
      if (!(await onBeforeLeave())) return;
      navigate(await requestCalendarAddress(fetch, calendarDemoAccessPath));
    } catch {
      setMessage(accessNotStoredMessage);
    } finally {
      setIsLeaving(false);
    }
  };

  return { savedAt, isLeaving, message, store };
}
