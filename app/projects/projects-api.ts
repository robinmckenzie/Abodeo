// The projects API between the server and the browser, for a signed-in
// account's projects (AD #41 Access Projects Across Devices). Both sides
// import it, so it uses neither Node nor browser APIs.
import type { ProjectField } from "./project-changes";
import type { Project, ProjectFields } from "./projects";

export const projectsPath = "/api/projects";
export const projectsImportPath = `${projectsPath}/import`;
export const projectsBinPath = `${projectsPath}/bin`;

// How long a deleted project can be restored from the Bin before the
// dashboard next clears it for good (AD #62 Delete Projects). Provisional,
// expected to be tuned.
export const binPeriodMs = 2 * 24 * 60 * 60 * 1000;

// The account the page believes it is working for. It never chooses the
// account, which comes only from the sign-in: a request whose account
// differs is refused, so that a page left open for one account cannot change
// another's projects after another tab switched accounts.
export const accountHeader = "X-Abodeo-Account";

// The most a request body may be, in bytes. Provisional.
export const projectBodyLimit = 256 * 1024;
export const importBodyLimit = 1024 * 1024;

export function buildProjectPath(id: string) {
  return `${projectsPath}/${encodeURIComponent(id)}`;
}

export function buildRestorePath(id: string) {
  return `${buildProjectPath(id)}/restore`;
}

export function buildPermanentDeletePath(id: string) {
  return `${buildProjectPath(id)}/permanent`;
}

// A project id made by the browser, or a default project's.
export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
}

export type ProjectListResponse = {
  projects: Project[];
  unreadableCount: number;
  // The account's default projects, so that the browser can tell its own.
  defaultIds: string[];
  // The newest image of each project that has any, by project id, for its
  // bar's thumbnail (AD #48 Add Images To Projects).
  latestImageIds: Record<string, string>;
  // How many images each project that has any holds, by project id, for the
  // warning before it is deleted (AD #62 Delete Projects).
  imageCounts: Record<string, number>;
};

// The account's deleted projects, each with when it was put in the Bin as an
// ISO time.
export type BinListResponse = {
  projects: { project: Project; deletedAt: string }[];
  unreadableCount: number;
  imageCounts: Record<string, number>;
};

export type ProjectResponse = { project: Project };

export type CreateProjectRequest = { id: string; fields: ProjectFields };

// Each changed field with the value it was based on.
export type SaveProjectRequest = {
  base: Partial<ProjectFields>;
  changes: Partial<ProjectFields>;
};

export type ProjectConflictResponse = {
  error: "conflict";
  project: Project;
  fields: ProjectField[];
};

// Each project's saved form with its id, as the browser keeps it.
// With the browser's list of people, which goes with them (AD #61 Manage
// People).
export type ImportProjectsRequest = { projects: unknown[]; people?: unknown[] };

// For each id sent: moved, already in the account from an earlier move, or
// moved as a copy because the account's copy differs.
export type ImportOutcome = "moved" | "already-moved" | "moved-as-copy";

export type ImportProjectsResponse = {
  outcomes: Record<string, ImportOutcome>;
};

export type ProjectErrorCode =
  | "not_signed_in"
  | "invalid_request"
  | "method_not_allowed"
  | "unavailable"
  | "not_found"
  | "unreadable"
  | "conflict"
  // The person chosen is not in the account's list.
  | "unknown_assignee"
  | "account_changed"
  | "too_large";
