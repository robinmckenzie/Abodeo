// A demo seed store in memory, for tests of the code around it.
import type { SeedAppointment } from "../calendar/demo-seed-appointments.server";
import type { DemoSeedStore } from "./demo-seed-store.server";

export function createMemoryDemoSeedStore(
  demoUserId = "demo-user",
): DemoSeedStore & {
  saves: string[];
  resets: string[];
  appointments: SeedAppointment[];
} {
  const saves: string[] = [];
  const appointments: SeedAppointment[] = [];
  const resets: string[] = [];
  let savedAt: Date | null = null;
  return {
    saves,
    resets,
    appointments,
    readProjectIds: async () => ["p1", "p2"],
    readAppointments: async () => appointments,
    isDemoAccount: async (userId) => userId === demoUserId,
    readSavedAt: async () => savedAt,
    reset: async (userId) => {
      resets.push(userId);
      return true;
    },
    save: async (userId, saved) => {
      saves.push(userId);
      appointments.splice(0, appointments.length, ...saved);
      savedAt = new Date("2026-11-13T10:00:00.000Z");
      return {
        savedAt: savedAt.toISOString(),
        projectCount: 2,
        peopleCount: 3,
        imageCount: 4,
        appointmentCount: saved.length,
      };
    },
  };
}
