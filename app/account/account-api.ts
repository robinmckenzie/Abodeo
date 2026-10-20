// The account API between the server and the browser. Both sides import it,
// so it uses neither Node nor browser APIs.

// Where Better Auth's own endpoints are served.
export const authBasePath = "/api/auth";
export const accountStatusPath = "/api/account/status";
export const accountProfilePath = "/api/account/profile";

// Where sign-in and sign-out return to, so that neither the welcome screen
// nor the returning-visitor logo sequence plays first.
export const accountReturnPath = "/dashboard";

export const preferredNameMaxLength = 50;

export type AccountStatusResponse = { configured: boolean };

// The signed-in account's preferred name, or null when none is set.
export type AccountProfileResponse = { preferredName: string | null };

export type AccountErrorCode =
  | "not_signed_in"
  | "invalid_request"
  | "method_not_allowed"
  | "unavailable";

export type AccountErrorResponse = { error: AccountErrorCode };

// A preferred name as it is stored: without surrounding spaces, and 1 to
// preferredNameMaxLength characters long. Undefined for anything else,
// including a name that is only spaces.
export function normalisePreferredName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && [...name].length <= preferredNameMaxLength
    ? name
    : undefined;
}
