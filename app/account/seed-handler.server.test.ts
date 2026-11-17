// @vitest-environment node
import { describe, expect, it } from "vitest";

import { accountSeedCalendarPath, accountSeedPath } from "./account-api";
import { SeedTooLargeError } from "./demo-seed-store.server";
import {
  handleSeedCalendarRequest,
  handleSeedRequest,
} from "./seed-handler.server";
import { createMemoryDemoSeedStore } from "./test-demo-seed.server";

function setup(userId: string | null = "demo-user") {
  const store = createMemoryDemoSeedStore("demo-user");
  const handle = (method: string, cookie?: string) =>
    handleSeedRequest(
      new Request(`http://localhost:5173${accountSeedPath}`, {
        method,
        headers: cookie ? { Cookie: cookie } : {},
      }),
      {
        readSessionUserId: async () => userId ?? undefined,
        store,
        ignoredLabels: ["robin"],
        collectAppointments: async (_userId, projectIds) =>
          projectIds.map((projectId) => ({
            projectId,
            event: {
              summary: "Visit",
              description: "",
              start: { date: "2026-12-01" },
              end: { date: "2026-12-02" },
            },
          })),
        reportFailure: () => {},
      },
    );
  return { store, handle };
}

describe("handleSeedRequest", () => {
  it("refuses a visitor who is not signed in", async () => {
    const { handle } = setup(null);
    expect((await handle("GET", "abodeo_label=Robin")).status).toBe(401);
  });

  it("shows the control to the demo account under an ignored label", async () => {
    const { handle } = setup();
    const response = await handle("GET", "abodeo_label=Robin");
    expect(await response.json()).toEqual({ canSave: true, seed: null });
  });

  it("hides the control without such a label, or with no label", async () => {
    const { handle } = setup();
    for (const cookie of ["abodeo_label=Acme", undefined]) {
      expect(await (await handle("GET", cookie)).json()).toEqual({
        canSave: false,
        seed: null,
      });
    }
  });

  it("hides the control from another account, even under that label", async () => {
    const { handle } = setup("someone-else");
    expect(await (await handle("GET", "abodeo_label=Robin")).json()).toEqual({
      canSave: false,
      seed: null,
    });
  });

  it("saves for the allowed session and then reports what the seed holds", async () => {
    const { handle, store } = setup();
    const saved = await handle("PUT", "abodeo_label=robin");
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      projectCount: 2,
      peopleCount: 3,
      imageCount: 4,
    });
    expect(store.saves).toEqual(["demo-user"]);
    expect(await (await handle("GET", "abodeo_label=robin")).json()).toEqual({
      canSave: true,
      seed: {
        savedAt: "2026-11-13T10:00:00.000Z",
        projectCount: 2,
        peopleCount: 3,
        imageCount: 4,
        appointmentCount: 2,
      },
    });
  });

  it("saves the appointments of the projects", async () => {
    const { store, handle } = setup();
    const saved = await handle("PUT", "abodeo_label=robin");
    expect(await saved.json()).toMatchObject({ appointmentCount: 2 });
    expect(store.appointments.map((a) => a.projectId)).toEqual(["p1", "p2"]);
  });

  it("refuses to save without an allowed label or account", async () => {
    const demo = setup();
    expect((await demo.handle("PUT", "abodeo_label=Acme")).status).toBe(403);
    expect((await demo.handle("PUT")).status).toBe(403);
    const other = setup("someone-else");
    expect((await other.handle("PUT", "abodeo_label=Robin")).status).toBe(403);
    expect(demo.store.saves).toEqual([]);
    expect(other.store.saves).toEqual([]);
  });

  it("answers 413 when the images are too big, without a failure report", async () => {
    const { handle, store } = setup();
    store.save = async () => {
      throw new SeedTooLargeError();
    };
    const response = await handle("PUT", "abodeo_label=robin");
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "seed_too_large" });
  });

  it("accepts only GET and PUT", async () => {
    const { handle } = setup();
    expect((await handle("POST", "abodeo_label=Robin")).status).toBe(405);
  });
});

describe("handleSeedCalendarRequest", () => {
  const due = "abodeo_demo_calendar=1";

  function setup(userId: string | null = "demo-user") {
    const store = createMemoryDemoSeedStore("demo-user");
    const restores: { userId: string; count: number }[] = [];
    const handle = (cookie?: string, method = "POST") =>
      handleSeedCalendarRequest(
        new Request(`http://localhost:5173${accountSeedCalendarPath}`, {
          method,
          headers: cookie ? { Cookie: cookie } : {},
        }),
        {
          readSessionUserId: async () => userId ?? undefined,
          store,
          restoreAppointments: async (restoredFor, appointments) => {
            restores.push({ userId: restoredFor, count: appointments.length });
          },
          reportFailure: () => {},
        },
      );
    return { store, restores, handle };
  }

  it("puts the seed's appointments back when /demo left it due, and marks it done", async () => {
    const { store, restores, handle } = setup();
    await store.save("demo-user", [
      {
        projectId: "p1",
        event: {
          summary: "Visit",
          description: "",
          start: { date: "2026-12-01" },
          end: { date: "2026-12-02" },
        },
      },
    ]);
    const response = await handle(`abodeo_label=Acme; ${due}`);
    expect(await response.json()).toEqual({ restored: true });
    expect(restores).toEqual([{ userId: "demo-user", count: 1 }]);
    // The cookie is removed, at the path it was set for.
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("abodeo_demo_calendar=1; Max-Age=0");
    expect(cookie).toContain(`Path=${accountSeedCalendarPath}`);
  });

  it("leaves the calendar alone when it is not due, such as on going back", async () => {
    const { restores, handle } = setup();
    const response = await handle("abodeo_label=Acme");
    expect(await response.json()).toEqual({ restored: false });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(restores).toEqual([]);
  });

  it("does nothing for another account", async () => {
    const { restores, handle } = setup("someone-else");
    expect(await (await handle(due)).json()).toEqual({ restored: false });
    expect(restores).toEqual([]);
  });

  it("refuses a visitor who is not signed in, and other methods", async () => {
    expect((await setup(null).handle(due)).status).toBe(401);
    expect((await setup().handle(due, "GET")).status).toBe(405);
  });
});
