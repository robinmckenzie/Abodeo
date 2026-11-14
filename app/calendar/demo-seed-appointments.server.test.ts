// @vitest-environment node
import { symmetricEncrypt } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import { appointmentProjectProperty } from "./appointments-api";
import {
  collectSeedAppointments,
  restoreSeedAppointments,
  type SeedAppointmentDependencies,
} from "./demo-seed-appointments.server";
import {
  createFakeCalendarDependencies,
  testRefreshToken,
  testRefreshedToken,
  testSecret,
} from "./test-calendar.server";

const userId = "demo-user";

async function setup({ stored = true } = {}) {
  const fake = createFakeCalendarDependencies();
  if (stored) {
    await fake.demoAccess.store.save(
      userId,
      await symmetricEncrypt({ key: testSecret, data: testRefreshToken }),
    );
  }
  const failures: string[] = [];
  const dependencies: SeedAppointmentDependencies = {
    ...fake.dependencies,
    reportFailure: (stage, code) => failures.push(`${stage}:${code}`),
  };
  const addEvent = (projectId: string, summary: string) =>
    fake.dependencies.calendar.insertEvent(
      testRefreshedToken,
      fake.store.links.get(userId)!,
      {
        summary,
        description: "",
        start: { date: "2026-12-01" },
        end: { date: "2026-12-02" },
        extendedProperties: {
          private: { [appointmentProjectProperty]: projectId },
        },
      },
    );
  return { fake, dependencies, failures, addEvent };
}

describe("collectSeedAppointments", () => {
  it("gives the events of each project, with their project", async () => {
    const { fake, dependencies, addEvent } = await setup();
    fake.calendar.calendars.set("calendar-0", { summary: "A", events: [] });
    fake.store.links.set(userId, "calendar-0");
    await addEvent("p1", "Tasting");
    await addEvent("p2", "Delivery");
    await addEvent("other", "Not in the seed");
    const found = await collectSeedAppointments(dependencies, userId, [
      "p1",
      "p2",
    ]);
    expect(found.map((a) => [a.projectId, a.event.summary])).toEqual([
      ["p1", "Tasting"],
      ["p2", "Delivery"],
    ]);
    expect(found[0].event.extendedProperties?.private).toEqual({
      [appointmentProjectProperty]: "p1",
    });
  });

  it("gives none, and does not call Google, when no access is stored", async () => {
    const { fake, dependencies } = await setup({ stored: false });
    expect(await collectSeedAppointments(dependencies, userId, ["p1"])).toEqual(
      [],
    );
    expect(fake.google.refreshes).toEqual([]);
  });

  it("gives none when the account has no calendar yet", async () => {
    const { dependencies } = await setup();
    expect(await collectSeedAppointments(dependencies, userId, ["p1"])).toEqual(
      [],
    );
  });

  it("fails, rather than save a seed short of appointments", async () => {
    const { fake, dependencies } = await setup();
    fake.store.links.set(userId, "calendar-0");
    fake.calendar.failures.listEvents = "google_500";
    await expect(
      collectSeedAppointments(dependencies, userId, ["p1"]),
    ).rejects.toThrow("google_500");
  });
});

describe("restoreSeedAppointments", () => {
  const seedEvent = {
    projectId: "p1",
    event: {
      summary: "Tasting",
      description: "Bring a basket",
      start: { dateTime: "2026-12-01T10:00:00", timeZone: "Europe/London" },
      end: { dateTime: "2026-12-01T11:00:00", timeZone: "Europe/London" },
      extendedProperties: { private: { [appointmentProjectProperty]: "p1" } },
    },
  };

  it("deletes the old calendar and adds the seed's events to a new one", async () => {
    const { fake, dependencies, addEvent } = await setup();
    fake.calendar.calendars.set("calendar-0", { summary: "A", events: [] });
    fake.store.links.set(userId, "calendar-0");
    await addEvent("p1", "A visitor's own event");
    await restoreSeedAppointments(dependencies, userId, [seedEvent]);
    expect(fake.calendar.calendars.has("calendar-0")).toBe(false);
    const newId = fake.store.links.get(userId)!;
    expect(newId).not.toBe("calendar-0");
    expect(
      fake.calendar.calendars.get(newId)!.events.map((e) => e.summary),
    ).toEqual(["Tasting"]);
    expect(
      fake.calendar.tokensUsed.every((t) => t === testRefreshedToken),
    ).toBe(true);
  });

  it("leaves no calendar when the seed has no appointments", async () => {
    const { fake, dependencies } = await setup();
    fake.calendar.calendars.set("calendar-0", { summary: "A", events: [] });
    fake.store.links.set(userId, "calendar-0");
    await restoreSeedAppointments(dependencies, userId, []);
    expect(fake.calendar.calendars.size).toBe(0);
    expect(fake.store.links.has(userId)).toBe(false);
  });

  it("carries on when the old calendar is already gone", async () => {
    const { fake, dependencies } = await setup();
    fake.store.links.set(userId, "calendar-0");
    fake.calendar.failures.deleteCalendar = "google_404";
    await restoreSeedAppointments(dependencies, userId, [seedEvent]);
    expect(fake.calendar.calendars.size).toBe(1);
  });

  it("does nothing when no access is stored", async () => {
    const { fake, dependencies } = await setup({ stored: false });
    fake.calendar.calendars.set("calendar-0", { summary: "A", events: [] });
    fake.store.links.set(userId, "calendar-0");
    await restoreSeedAppointments(dependencies, userId, [seedEvent]);
    expect(fake.calendar.calendars.has("calendar-0")).toBe(true);
    expect(fake.calendar.tokensUsed).toEqual([]);
  });

  it("reports a Google failure and does not throw", async () => {
    const { fake, dependencies, failures } = await setup();
    fake.calendar.failures.insertCalendar = "google_500";
    await restoreSeedAppointments(dependencies, userId, [seedEvent]);
    expect(failures).toEqual(["restore:google_500"]);
  });
});
