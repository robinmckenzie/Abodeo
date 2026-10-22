// The default projects that every visitor receives. Robin saves them in local
// development into default-projects.json, which each deployment includes.
// Each entry is a project's saved form with its id, so that a later version
// of the app can still read it. No storage here.
import bundledFile from "./default-projects.json";
import {
  parseProject,
  serialiseProject,
  sortProjects,
  type Project,
} from "./projects";

export type DefaultProjects = {
  // Changes whenever any default project's data does, so that a browser can
  // tell whether it has received these defaults.
  hash: string;
  projects: Project[];
};

export const defaultProjectsPath = "app/projects/default-projects.json";

// The development server's address for saving the default projects.
export const defaultProjectsEndpoint = "/__abodeo/default-projects";

// Null if any entry is damaged or repeats an id, so that a damaged file
// changes nothing rather than removing default projects.
export function readDefaultProjects(file: unknown): DefaultProjects | null {
  const entries = (file as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(entries)) return null;
  const projects: Project[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id === "" || ids.has(id)) return null;
    const project = parseProject(id, JSON.stringify(entry));
    if (!project) return null;
    ids.add(id);
    projects.push(project);
  }
  return { hash: hashText(JSON.stringify(entries)), projects };
}

export function buildDefaultProjectsFile(projects: Project[]) {
  return {
    projects: sortProjects(projects).map((project) => ({
      id: project.id,
      ...JSON.parse(serialiseProject(project)),
    })),
  };
}

export const bundledDefaultProjects = readDefaultProjects(bundledFile);

// Which default projects a browser or an account last received.
export type DefaultsRecord = { hash: string; ids: string[] };

export type DefaultsReceipt = {
  write: Project[];
  remove: string[];
  record: DefaultsRecord;
};

// What receiving the defaults changes, or null when nothing needs doing:
// every default is written, overwriting any edits, and defaults the app no
// longer has are removed. A project that cannot be read, such as one saved
// by a later version, is never written or removed, and one that is kept
// still counts as a default. The same rules apply to a browser and an
// account.
export function planDefaultsReceipt(
  record: DefaultsRecord | null,
  defaults: DefaultProjects | null,
  isUnreadable: (id: string) => boolean,
): DefaultsReceipt | null {
  // A damaged defaults file changes nothing.
  if (!defaults) return null;
  if (record?.hash === defaults.hash) return null;
  // Nothing received yet and nothing to receive.
  if (!record && defaults.projects.length === 0) return null;
  const ids = new Set(defaults.projects.map(({ id }) => id));
  const write = defaults.projects.filter(({ id }) => !isUnreadable(id));
  const remove: string[] = [];
  const keptIds: string[] = [];
  for (const id of record?.ids ?? []) {
    if (ids.has(id)) continue;
    if (isUnreadable(id)) keptIds.push(id);
    else remove.push(id);
  }
  return {
    write,
    remove,
    record: { hash: defaults.hash, ids: [...ids, ...keptIds] },
  };
}

// cyrb53, a fast 53-bit string hash. It only needs to tell one set of
// default projects, or one copy of a project, from another, not to be
// secure.
export function hashText(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
