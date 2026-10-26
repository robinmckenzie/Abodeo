// Helpers for the projects tests: a project store that keeps each account's
// projects in memory, with the same rules as the database's, and records
// which account each call was for.
import { applyProjectChanges, findConflictingFields } from "./project-changes";
import { buildCopyId, type ProjectStore } from "./project-store.server";
import { serialiseProject, sortProjects, type Project } from "./projects";

export function createMemoryProjectStore() {
  const accounts = new Map<string, Map<string, Project>>();
  const calls: string[] = [];
  // Each account's binned projects, by id, with when they were binned.
  const bins = new Map<string, Map<string, { project: Project; at: string }>>();
  const binOf = (userId: string) => {
    if (!bins.has(userId)) bins.set(userId, new Map());
    return bins.get(userId)!;
  };
  const projectsOf = (userId: string) => {
    if (!accounts.has(userId)) accounts.set(userId, new Map());
    return accounts.get(userId)!;
  };
  const store: ProjectStore = {
    async receiveDefaults() {},
    async list(userId) {
      calls.push(userId);
      return {
        projects: sortProjects([...projectsOf(userId).values()]),
        unreadableCount: 0,
        defaultIds: [],
        latestImageIds: {},
        imageCounts: {},
      };
    },
    async read(userId, id) {
      calls.push(userId);
      const project = projectsOf(userId).get(id);
      return project ? { kind: "found", project } : { kind: "not-found" };
    },
    async create(userId, id, fields) {
      calls.push(userId);
      const projects = projectsOf(userId);
      if (!projects.has(id)) {
        const time = new Date().toISOString();
        projects.set(id, { ...fields, id, createdAt: time, updatedAt: time });
      }
      return { kind: "found", project: projects.get(id)! };
    },
    async saveChanges(userId, id, base, changes) {
      calls.push(userId);
      const projects = projectsOf(userId);
      const saved = projects.get(id);
      if (!saved) return { kind: "not-found" };
      const fields = findConflictingFields(saved, base, changes);
      if (fields.length > 0)
        return { kind: "conflict", project: saved, fields };
      const project = applyProjectChanges(
        saved,
        changes,
        new Date().toISOString(),
      );
      projects.set(id, project);
      return { kind: "saved", project };
    },
    async importProjects(userId, sent) {
      calls.push(userId);
      const projects = projectsOf(userId);
      const outcomes: Record<
        string,
        "moved" | "already-moved" | "moved-as-copy"
      > = {};
      for (const project of sent) {
        const existing = projects.get(project.id);
        if (!existing) {
          projects.set(project.id, project);
          outcomes[project.id] = "moved";
        } else if (serialiseProject(existing) === serialiseProject(project)) {
          outcomes[project.id] = "already-moved";
        } else {
          const copyId = buildCopyId(project);
          if (projects.has(copyId)) {
            outcomes[project.id] = "already-moved";
          } else {
            projects.set(copyId, { ...project, id: copyId });
            outcomes[project.id] = "moved-as-copy";
          }
        }
      }
      return outcomes;
    },
    async remove(userId, id) {
      calls.push(userId);
      const project = projectsOf(userId).get(id);
      if (!project) return { kind: "not-found" };
      projectsOf(userId).delete(id);
      binOf(userId).set(id, { project, at: new Date().toISOString() });
      return { kind: "done" };
    },
    async listBin(userId) {
      calls.push(userId);
      return {
        projects: [...binOf(userId).values()].map(({ project, at }) => ({
          project,
          deletedAt: at,
        })),
        unreadableCount: 0,
        imageCounts: {},
      };
    },
    async restore(userId, id) {
      calls.push(userId);
      const binned = binOf(userId).get(id);
      if (!binned) return { kind: "not-found" };
      binOf(userId).delete(id);
      projectsOf(userId).set(id, binned.project);
      return { kind: "done" };
    },
    async deletePermanently(userId, id) {
      calls.push(userId);
      return { kind: binOf(userId).delete(id) ? "done" : "not-found" };
    },
  };
  return { store, accounts, bins, calls };
}
