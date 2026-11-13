// A demo seed store in memory, for tests of the code around it.
import type { DemoSeedStore } from "./demo-seed-store.server";

export function createMemoryDemoSeedStore(
  demoUserId = "demo-user",
): DemoSeedStore & { saves: string[]; resets: string[] } {
  const saves: string[] = [];
  const resets: string[] = [];
  let savedAt: Date | null = null;
  return {
    saves,
    resets,
    isDemoAccount: async (userId) => userId === demoUserId,
    readSavedAt: async () => savedAt,
    reset: async (userId) => {
      resets.push(userId);
      return true;
    },
    save: async (userId) => {
      saves.push(userId);
      savedAt = new Date("2026-11-13T10:00:00.000Z");
      return {
        savedAt: savedAt.toISOString(),
        projectCount: 2,
        peopleCount: 3,
        imageCount: 4,
      };
    },
  };
}
