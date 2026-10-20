// What the account control shows, kept apart from React so that it can be
// tested on its own.

// The name shown while signed in: the preferred name once set, else Google's.
export function chooseDisplayName(
  googleName: string,
  preferredName: string | null,
) {
  return preferredName ?? (googleName.trim() || "your Google account");
}

// Better Auth returns to the dashboard with ?error= when sign-in did not
// complete, such as when it was cancelled at Google.
export function hasSignInError(search: string) {
  return new URLSearchParams(search).has("error");
}

// The address without the parameters Better Auth adds after a failed
// sign-in, keeping any others.
export function removeSignInError(search: string) {
  const parameters = new URLSearchParams(search);
  parameters.delete("error");
  parameters.delete("error_description");
  const query = parameters.toString();
  return query ? `?${query}` : "";
}

// When to check the session again: as it is due to end, and at least once a
// day, as a browser timer cannot wait much longer than 24 days.
export function calculateRecheckDelay(
  expiresAt: number | null,
  now: number,
) {
  const day = 24 * 60 * 60 * 1000;
  if (expiresAt === null) return day;
  return Math.min(Math.max(expiresAt - now + 1000, 0), day);
}
