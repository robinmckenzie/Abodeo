// Keeps projects in the browser's local storage, for use while signed out.
// Each project has its own entry, so that saving one project, or two tabs
// saving at once, can never overwrite another project. This is the only code
// that touches projects in browser storage. A signed-in account's projects
// are never kept here (see account-projects.ts).
//
// The saving functions are async, as a database's would be, but they write to
// local storage before they first wait, so that a save started as the page is
// left is complete before it goes.
import {
  bundledDefaultProjects,
  planDefaultsReceipt,
  type DefaultProjects,
  type DefaultsRecord,
} from "./default-projects";
import { isKnownAssignee } from "./people";
import { readStoredPeople, withPeopleLock } from "./people-storage";
import {
  hasTitle,
  parseProject,
  serialiseProject,
  sortProjects,
  unassignedId,
  type Project,
  type ProjectFields,
} from "./projects";
import type { Task } from "./tasks";

const keyPrefix = "abodeo-project:";

// Which default projects this browser last received: their hash and ids. Its
// name does not start with keyPrefix, so it is not counted as a project.
const defaultsKey = "abodeo-default-projects";

// While signed in: whether the account has projects of its own, so that the
// welcome screen can be chosen before the account's projects load. Only yes
// or no, with the account it is for, never any project data.
const accountHintKey = "abodeo-account-has-projects";

// The account for which the person chose not to move this browser's
// projects in, until they next sign in or out.
const moveDeclinedKey = "abodeo-move-declined";

export type SaveFailure =
  | "unavailable"
  | "full"
  | "unreadable"
  | "no-title"
  // The person chosen is not in the list, such as when removed in another tab.
  | "unknown-assignee";

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
  if (!isAssigneeInList(fields.assignee)) {
    return { ok: false, reason: "unknown-assignee" };
  }
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
// saved form cannot be read is left as it is. Assigning someone takes its
// turn with removing people (AD #61 Manage People), and is refused if they
// are not in the list as it is saved now.
export async function saveProjectChanges(
  id: string,
  changes: Partial<ProjectFields>,
): Promise<SaveResult> {
  if (changes.title !== undefined && !hasTitle(changes.title)) {
    return { ok: false, reason: "no-title" };
  }
  if (changes.assignee !== undefined && changes.assignee !== unassignedId) {
    return withPeopleLock(async () => writeProjectChanges(id, changes));
  }
  return writeProjectChanges(id, changes);
}

// Whether the person is Unassigned or in the list as it is saved now.
function isAssigneeInList(assignee: string) {
  if (assignee === unassignedId) return true;
  const stored = readStoredPeople();
  return stored.state === "found" && isKnownAssignee(stored.people, assignee);
}

// Reads the list, the project and then writes in one step, so that nothing
// can come between them in this tab.
function writeProjectChanges(
  id: string,
  changes: Partial<ProjectFields>,
): SaveResult {
  if (changes.assignee !== undefined && !isAssigneeInList(changes.assignee)) {
    return { ok: false, reason: "unknown-assignee" };
  }
  const saved = readProject(id);
  if (!saved.ok) return saved;
  return writeProject({
    ...saved.project,
    ...changes,
    updatedAt: new Date().toISOString(),
  });
}

// Applies one change to the tasks as they are saved now, such as adding or
// moving one, so that tasks changed elsewhere, such as in another tab, are
// kept. Gives the tasks as saved.
export async function saveProjectTasks(
  id: string,
  change: (tasks: Task[]) => Task[],
): Promise<{ ok: true; tasks: Task[] } | { ok: false; reason: SaveFailure }> {
  const saved = readProject(id);
  if (!saved.ok) return saved;
  const tasks = change(saved.project.tasks);
  const result = writeProject({
    ...saved.project,
    tasks,
    updatedAt: new Date().toISOString(),
  });
  return result.ok ? { ok: true, tasks } : result;
}

function readProject(
  id: string,
): { ok: true; project: Project } | { ok: false; reason: SaveFailure } {
  let project: Project | null;
  try {
    project = parseProject(id, localStorage.getItem(keyPrefix + id));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return project ? { ok: true, project } : { ok: false, reason: "unreadable" };
}

// Writing replaces the entry in one step, so a failed write leaves the saved
// project exactly as it was.
function writeProject(project: Project): SaveResult {
  try {
    localStorage.setItem(keyPrefix + project.id, serialiseProject(project));
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

// Brings this browser's default projects up to date with the app's, when
// they differ from those it last received: adds new ones, replaces existing
// ones, overwriting any edits, and removes those the app no longer has. The
// visitor's own projects are never touched, nor is an entry this version
// cannot read, such as one saved by a later version. The record is written
// last, so that if storage fails part way, the next load tries again.
//
// Unlike the saving functions, this is not async, as it runs before projects
// are first read, which React needs straight away.
export function receiveDefaultProjects(
  defaults = bundledDefaultProjects,
): SaveResult {
  try {
    const receipt = planDefaultsReceipt(
      readDefaultsRecord(),
      defaults,
      isUnreadableEntry,
    );
    if (!receipt) return { ok: true };
    for (const project of receipt.write) {
      localStorage.setItem(keyPrefix + project.id, serialiseProject(project));
    }
    for (const id of receipt.remove) localStorage.removeItem(keyPrefix + id);
    writeDefaultsRecord(receipt.record.hash, receipt.record.ids);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

// Records the projects just saved as the defaults, in development, as the
// defaults this browser has received, so that they count as default
// projects here rather than being added again as copies.
export function markProjectsAsDefaults(defaults: DefaultProjects): SaveResult {
  try {
    writeDefaultsRecord(
      defaults.hash,
      defaults.projects.map(({ id }) => id),
    );
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

// Leaves exactly the default projects, in development: writes them, then
// removes every other project, readable or not. Writing first means a
// failure removes nothing.
export function resetToDefaultProjects(
  defaults = bundledDefaultProjects,
): SaveResult {
  if (!defaults) return { ok: false, reason: "unreadable" };
  try {
    const ids = new Set(defaults.projects.map(({ id }) => id));
    for (const project of defaults.projects) {
      localStorage.setItem(keyPrefix + project.id, serialiseProject(project));
    }
    for (const key of listProjectKeys()) {
      if (!ids.has(key.slice(keyPrefix.length))) localStorage.removeItem(key);
    }
    writeDefaultsRecord(defaults.hash, [...ids]);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

// The visitor's own projects that can be read, not default projects, to
// offer to move into an account.
export function listOwnProjects(): Project[] {
  const loaded = loadProjects();
  if (!loaded.ok) return [];
  const defaultIds = new Set([
    ...(readDefaultsRecord()?.ids ?? []),
    ...(bundledDefaultProjects?.projects.map(({ id }) => id) ?? []),
  ]);
  return loaded.projects.filter(({ id }) => !defaultIds.has(id));
}

// Removes each project that is still exactly as given, such as once it has
// been moved into an account. One changed since, such as in another tab, is
// kept, to be offered again.
export function removeProjectsIfUnchanged(projects: Project[]) {
  try {
    for (const project of projects) {
      const key = keyPrefix + project.id;
      const saved = parseProject(project.id, localStorage.getItem(key));
      if (saved && serialiseProject(saved) === serialiseProject(project)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // What is left is offered again.
  }
}

export function writeAccountHint(accountId: string, hasProjects: boolean) {
  try {
    localStorage.setItem(
      accountHintKey,
      JSON.stringify({ accountId, hasProjects }),
    );
  } catch {
    // Without it, the browser's own projects choose the welcome screen.
  }
}

export function removeAccountHint() {
  try {
    localStorage.removeItem(accountHintKey);
  } catch {
    // Nothing to remove.
  }
}

function readAccountHint(): boolean | null {
  try {
    const hint = JSON.parse(localStorage.getItem(accountHintKey) ?? "null");
    return typeof hint?.hasProjects === "boolean" ? hint.hasProjects : null;
  } catch {
    return null;
  }
}

export function isMoveDeclined(accountId: string) {
  try {
    return localStorage.getItem(moveDeclinedKey) === accountId;
  } catch {
    return false;
  }
}

export function declineMove(accountId: string) {
  try {
    localStorage.setItem(moveDeclinedKey, accountId);
  } catch {
    // The offer is made again on the next load.
  }
}

export function forgetDeclinedMove() {
  try {
    localStorage.removeItem(moveDeclinedKey);
  } catch {
    // Nothing to forget.
  }
}

function isUnreadableEntry(id: string) {
  const json = localStorage.getItem(keyPrefix + id);
  return json !== null && parseProject(id, json) === null;
}

function readDefaultsRecord(): DefaultsRecord | null {
  try {
    const saved = JSON.parse(localStorage.getItem(defaultsKey) ?? "null");
    if (
      typeof saved?.hash === "string" &&
      Array.isArray(saved.ids) &&
      saved.ids.every((id: unknown) => typeof id === "string")
    ) {
      return { hash: saved.hash, ids: saved.ids };
    }
  } catch {
    // An unreadable record counts as no defaults received.
  }
  return null;
}

function writeDefaultsRecord(hash: string, ids: string[]) {
  localStorage.setItem(defaultsKey, JSON.stringify({ hash, ids }));
}

function toFailure(error: unknown): SaveResult {
  return { ok: false, reason: isQuotaError(error) ? "full" : "unavailable" };
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
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

// A visitor's own projects are those that are not default projects. Any
// counts, including one that cannot be read, so that a returning visitor
// whose projects are damaged is told so on the dashboard rather than being
// welcomed as new. Default projects and tuning settings do not count. While
// signed in, the account's hint decides instead.
export function hasOwnProjects() {
  const hint = readAccountHint();
  if (hint !== null) return hint;
  try {
    const defaultIds = new Set(readDefaultsRecord()?.ids);
    return listProjectKeys().some(
      (key) => !defaultIds.has(key.slice(keyPrefix.length)),
    );
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
// when the visitor has projects of their own, so that the welcome screen's
// CSS can hide the Get Started button from the first frame. It checks as
// hasOwnProjects and isWelcomeRequested do.
export const hasProjectsScript = `try{
if(!new URLSearchParams(location.search).has("welcome")){
var h=null;try{h=JSON.parse(localStorage.getItem(${JSON.stringify(accountHintKey)}))}catch(e){}
if(h&&typeof h.hasProjects==="boolean"){
if(h.hasProjects)document.documentElement.setAttribute(${JSON.stringify(hasProjectsAttribute)},"")}else{
var d=[];try{var r=JSON.parse(localStorage.getItem(${JSON.stringify(defaultsKey)}));
if(r&&typeof r.hash==="string"&&Array.isArray(r.ids))d=r.ids}catch(e){}
var p=${JSON.stringify(keyPrefix)};
for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i)||"";
if(k.indexOf(p)===0&&d.indexOf(k.slice(p.length))<0){
document.documentElement.setAttribute(${JSON.stringify(hasProjectsAttribute)},"");break}}}}
}catch(e){}`;

export const projectKeyPrefix = keyPrefix;
