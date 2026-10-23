// Applies ?label=NAME from the address (AD #51 Label Account Usage): saves the
// label in a cookie that /api requests carry, or clears it for
// ?label=PUBLIC, then removes the parameter from the address. The cookie is
// the only record; if it cannot be written the app works without a label.
import { useEffect } from "react";

import { formatLabelCookie, readLabelRequest } from "./usage-label";

export function applyLabelRequest(
  location: Pick<Location, "search" | "protocol">,
  setCookie: (cookie: string) => void,
): boolean {
  const request = readLabelRequest(location.search);
  if (request.kind === "none") return false;
  try {
    setCookie(
      formatLabelCookie(
        request.kind === "set" ? request.label : null,
        location.protocol === "https:",
      ),
    );
  } catch {
    // Cookies are blocked: carry on without a label.
  }
  return true;
}

export function useUsageLabel() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("label")) return;
    applyLabelRequest(window.location, (cookie) => {
      document.cookie = cookie;
    });
    // An invalid or empty label is also removed, as it changes nothing.
    params.delete("label");
    const search = params.toString();
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
      );
    } catch {
      // The address stays as it is.
    }
  }, []);
}
