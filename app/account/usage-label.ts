// The usage label (AD #51 Label Account Usage): a short self-declared name set
// from the browser with ?label=NAME, kept in a cookie and stored with every
// usage record, so that Robin can tell who used an account. Shared by the
// browser and the server, so it uses no Node APIs.
export const labelCookieName = "abodeo_label";

// ?label=PUBLIC, in any case, clears the label.
export const clearLabelWord = "PUBLIC";

export const labelMaxLength = 30;

// Only /api requests carry the cookie, which includes Google's return to
// /api/auth/callback/google.
export const labelCookiePath = "/api";

const labelLifetimeSeconds = 365 * 24 * 60 * 60;

// Unicode letters, digits, space, hyphen, apostrophe and full stop.
const validLabel = /^[\p{L}\p{N} '.-]+$/u;

// The label for a value, trimmed, or undefined if it is empty, too long or
// has other characters.
export function normaliseLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim();
  if (label.length < 1 || label.length > labelMaxLength) return undefined;
  return validLabel.test(label) ? label : undefined;
}

export type LabelRequest =
  { kind: "set"; label: string } | { kind: "clear" } | { kind: "none" };

// What the address asks for. An invalid or empty ?label= asks for nothing, so
// the previous label stays.
export function readLabelRequest(search: string): LabelRequest {
  const value = new URLSearchParams(search).get("label");
  const label = normaliseLabel(value);
  if (label === undefined) return { kind: "none" };
  if (label.toUpperCase() === clearLabelWord) return { kind: "clear" };
  return { kind: "set", label };
}

// The cookie text to assign to document.cookie, setting the label or, for
// null, clearing it.
export function formatLabelCookie(
  label: string | null,
  isSecure: boolean,
): string {
  const value = label === null ? "" : encodeURIComponent(label);
  const maxAge = label === null ? 0 : labelLifetimeSeconds;
  return `${labelCookieName}=${value}; Max-Age=${maxAge}; Path=${labelCookiePath}; SameSite=Lax${
    isSecure ? "; Secure" : ""
  }`;
}
