// Reports clicks and keypresses while signed in, at most once per
// activityReportInterval, so that the server can keep the visit history.
// Nothing is sent while the page is idle, and a failed report is dropped.
import { useEffect } from "react";

import { reportActivity } from "./account-client";
import { isActivityReportDue } from "./activity-report";

export function useActivityReport(isSignedIn: boolean) {
  useEffect(() => {
    if (!isSignedIn) return;
    let lastReportAt: number | null = null;
    const report = () => {
      const now = Date.now();
      if (!isActivityReportDue(lastReportAt, now)) return;
      lastReportAt = now;
      reportActivity().catch(() => undefined);
    };
    // Capture, so that activity is seen even where a handler stops it.
    // pointerdown covers clicks and the start of drags.
    window.addEventListener("pointerdown", report, true);
    window.addEventListener("keydown", report, true);
    return () => {
      window.removeEventListener("pointerdown", report, true);
      window.removeEventListener("keydown", report, true);
    };
  }, [isSignedIn]);
}
