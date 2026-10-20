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

// cyrb53, a fast 53-bit string hash. It only needs to tell one set of
// default projects from another, not to be secure.
function hashText(text: string) {
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
