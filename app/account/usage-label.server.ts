// Reads the usage label (AD #51 Label Account Usage) from a request's Cookie
// header. Every usage record must store what this gives.
import { labelCookieName, normaliseLabel } from "./usage-label";

// The label in the request's cookie, or "" if there is none or it is not
// valid. Never throws.
export function readLabel(headers: Headers | undefined): string {
  const cookies = headers?.get("Cookie");
  if (!cookies) return "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== labelCookieName) continue;
    try {
      return (
        normaliseLabel(decodeURIComponent(part.slice(separator + 1).trim())) ??
        ""
      );
    } catch {
      return "";
    }
  }
  return "";
}
