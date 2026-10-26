// Reports that the app was opened (AD #94 Log Visits Before Sign-In), once for
// each browser tab, so that a reload or a move between pages is not another
// visit. A failed report is dropped, and so is one the browser cannot
// remember, which may report again.
import { useEffect } from "react";

import { reportVisit } from "./account-client";

export const visitReportedKey = "abodeo_visit_reported";

export function reportVisitOnce(
  search: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  report: (welcome: boolean) => Promise<void> = reportVisit,
) {
  try {
    if (storage.getItem(visitReportedKey)) return;
    storage.setItem(visitReportedKey, "1");
  } catch {
    // Storage is blocked: carry on and report.
  }
  report(new URLSearchParams(search).has("welcome")).catch(() => undefined);
}

export function useSiteVisit() {
  useEffect(() => {
    try {
      reportVisitOnce(window.location.search, window.sessionStorage);
    } catch {
      // sessionStorage cannot be reached: no report.
    }
  }, []);
}
