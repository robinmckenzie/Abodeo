// The account API between the server and the browser. Both sides import it,
// so it uses neither Node nor browser APIs.

// Where Better Auth's own endpoints are served.
export const authBasePath = "/api/auth";
export const accountStatusPath = "/api/account/status";
export const accountProfilePath = "/api/account/profile";
// Where the page reports a click or keypress, for the visit history.
export const accountActivityPath = "/api/account/activity";

// The demo seed (AD #138): whether the control shows, and saving the seed.
export const accountSeedPath = "/api/account/seed";

// Where the page reports a visit, signed in or not (AD #94).
export const siteVisitPath = "/api/visit";

// Where sign-in and sign-out return to, so that neither the welcome screen
// nor the returning-visitor logo sequence plays first.
export const accountReturnPath = "/dashboard";

export const preferredNameMaxLength = 50;

export type AccountStatusResponse = { configured: boolean };

// The signed-in account's preferred name, or null when none is set.
export type AccountProfileResponse = { preferredName: string | null };

export type AccountErrorCode =
  | "not_signed_in"
  | "not_allowed"
  | "invalid_request"
  | "seed_too_large"
  | "method_not_allowed"
  | "unavailable";

// canSave: this is the demo account under one of Robin's own labels. savedAt
// is an ISO time, or null if no seed is saved.
export type SeedStatusResponse = { canSave: boolean; savedAt: string | null };

export type SeedSaveResponse = {
  savedAt: string;
  projectCount: number;
  peopleCount: number;
  imageCount: number;
};

// The most the seed's images may hold, to spare the database quota
// (provisional): each original, and all files together.
export const maxSeedImageBytes = 1024 * 1024;
export const maxSeedTotalBytes = 4 * 1024 * 1024;

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
