// A demo seed store in memory, for tests of the code around it.
import type { SeedAppointment } from "../calendar/demo-seed-appointments.server";
import type { SeedSaveResponse } from "./account-api";
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
  let seed: SeedSaveResponse | null = null;
  return {
    saves,
    resets,
    appointments,
    readProjectIds: async () => ["p1", "p2"],
    readAppointments: async () => appointments,
    isDemoAccount: async (userId) => userId === demoUserId,
    readSaved: async () => seed,
    reset: async (userId) => {
      resets.push(userId);
      return true;
    },
    save: async (userId, saved) => {
      saves.push(userId);
      appointments.splice(0, appointments.length, ...saved);
      seed = {
        savedAt: "2026-11-13T10:00:00.000Z",
        projectCount: 2,
        peopleCount: 3,
        imageCount: 4,
        appointmentCount: saved.length,
      };
      return seed;
    },
  };
}
