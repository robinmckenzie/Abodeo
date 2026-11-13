// A demo seed store in memory, for tests of the code around it.
import type { DemoSeedStore } from "./demo-seed-store.server";

export function createMemoryDemoSeedStore(
  demoUserId = "demo-user",
): DemoSeedStore & { saves: string[] } {
  const saves: string[] = [];
  let savedAt: Date | null = null;
  return {
    saves,
    isDemoAccount: async (userId) => userId === demoUserId,
    readSavedAt: async () => savedAt,
    save: async (userId) => {
      saves.push(userId);
      savedAt = new Date("2026-11-13T10:00:00.000Z");
      return { savedAt: savedAt.toISOString(), projectCount: 2, peopleCount: 3 };
    },
  };
}
