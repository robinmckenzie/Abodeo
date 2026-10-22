// The projects API between the server and the browser, for a signed-in
// account's projects (AD #41 Access Projects Across Devices). Both sides
// import it, so it uses neither Node nor browser APIs.
import type { ProjectField } from "./project-changes";
import type { Project, ProjectFields } from "./projects";

export const projectsPath = "/api/projects";
export const projectsImportPath = `${projectsPath}/import`;

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

// A project id made by the browser, or a default project's.
export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
}

export type ProjectListResponse = {
  projects: Project[];
  unreadableCount: number;
  // The account's default projects, so that the browser can tell its own.
  defaultIds: string[];
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
export type ImportProjectsRequest = { projects: unknown[] };

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
  | "account_changed"
  | "too_large";
