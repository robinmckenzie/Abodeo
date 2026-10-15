// Keeps projects in the browser's local storage. Each project has its own
// entry, so that saving one project, or two tabs saving at once, can never
// overwrite another project. This is the only code that touches projects in
// storage: moving to a database means replacing these functions.
//
// The saving functions are async, as a database's would be, but they write to
// local storage before they first wait, so that a save started as the page is
// left is complete before it goes.
import {
  hasTitle,
  parseProject,
  serialiseProject,
  sortProjects,
  type Project,
  type ProjectFields,
} from "./projects";

const keyPrefix = "abodeo-project:";

export type SaveFailure = "unavailable" | "full" | "unreadable" | "no-title";

export type SaveResult = { ok: true } | { ok: false; reason: SaveFailure };

export type LoadResult =
  { ok: true; projects: Project[]; unreadableCount: number } | { ok: false };

export function loadProjects(): LoadResult {
  try {
    const projects: Project[] = [];
    let unreadableCount = 0;
    for (const key of listProjectKeys()) {
      const id = key.slice(keyPrefix.length);
      const project = parseProject(id, localStorage.getItem(key));
      if (project) projects.push(project);
      else unreadableCount++;
    }
    return { ok: true, projects: sortProjects(projects), unreadableCount };
  } catch {
    return { ok: false };
  }
}

export async function createProject(
  fields: ProjectFields,
): Promise<
  { ok: true; project: Project } | { ok: false; reason: SaveFailure }
> {
  if (!hasTitle(fields.title)) return { ok: false, reason: "no-title" };
  const now = new Date().toISOString();
  const project: Project = {
    ...fields,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const result = writeProject(project);
  return result.ok ? { ok: true, project } : result;
}

// Saves only the fields given, onto the project as it is saved now, so that
// fields changed elsewhere, such as in another tab, are kept. A project whose
// saved form cannot be read is left as it is.
export async function saveProjectChanges(
  id: string,
  changes: Partial<ProjectFields>,
): Promise<SaveResult> {
  if (changes.title !== undefined && !hasTitle(changes.title)) {
    return { ok: false, reason: "no-title" };
  }
  let saved: Project | null;
  try {
    saved = parseProject(id, localStorage.getItem(keyPrefix + id));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!saved) return { ok: false, reason: "unreadable" };
  return writeProject({
    ...saved,
    ...changes,
    updatedAt: new Date().toISOString(),
  });
}

// Writing replaces the entry in one step, so a failed write leaves the saved
// project exactly as it was.
function writeProject(project: Project): SaveResult {
  try {
    localStorage.setItem(keyPrefix + project.id, serialiseProject(project));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "full" : "unavailable" };
  }
}

// Older browsers report a full storage by code rather than name.
function isQuotaError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function listProjectKeys() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(keyPrefix)) keys.push(key);
  }
  return keys;
}

export function isProjectKey(key: string | null) {
  return key === null || key.startsWith(keyPrefix);
}

// Any saved project counts, including one that cannot be read, so that a
// returning visitor whose projects are damaged is told so on the dashboard
// rather than being welcomed as new. Tuning settings do not count.
export function hasSavedProjects() {
  try {
    return listProjectKeys().length > 0;
  } catch {
    return false;
  }
}

// /?welcome shows the welcome screen as to a new visitor, for testing it and
// its tuning panels once projects are saved.
export function isWelcomeRequested(search: string) {
  return new URLSearchParams(search).has("welcome");
}

export const hasProjectsAttribute = "data-has-projects";

// Runs in the page's head, before the page first appears, and marks the page
// when projects are saved, so that the welcome screen's CSS can hide the Get
// Started button from the first frame. It checks as hasSavedProjects and
// isWelcomeRequested do.
export const hasProjectsScript = `try{
if(!new URLSearchParams(location.search).has("welcome")){
for(var i=0;i<localStorage.length;i++){
if((localStorage.key(i)||"").indexOf(${JSON.stringify(keyPrefix)})===0){
document.documentElement.setAttribute(${JSON.stringify(hasProjectsAttribute)},"");break}}}
}catch(e){}`;

export const projectKeyPrefix = keyPrefix;
