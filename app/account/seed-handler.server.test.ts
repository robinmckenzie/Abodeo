// @vitest-environment node
import { describe, expect, it } from "vitest";

import { accountSeedPath } from "./account-api";
import { handleSeedRequest } from "./seed-handler.server";
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
    expect(await response.json()).toEqual({ canSave: true, savedAt: null });
  });

  it("hides the control without such a label, or with no label", async () => {
    const { handle } = setup();
    for (const cookie of ["abodeo_label=Acme", undefined]) {
      expect(await (await handle("GET", cookie)).json()).toEqual({
        canSave: false,
        savedAt: null,
      });
    }
  });

  it("hides the control from another account, even under that label", async () => {
    const { handle } = setup("someone-else");
    expect(await (await handle("GET", "abodeo_label=Robin")).json()).toEqual({
      canSave: false,
      savedAt: null,
    });
  });

  it("saves for the allowed session and then reports when", async () => {
    const { handle, store } = setup();
    const saved = await handle("PUT", "abodeo_label=robin");
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      projectCount: 2,
      peopleCount: 3,
    });
    expect(store.saves).toEqual(["demo-user"]);
    expect(await (await handle("GET", "abodeo_label=robin")).json()).toEqual({
      canSave: true,
      savedAt: "2026-11-13T10:00:00.000Z",
    });
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

  it("accepts only GET and PUT", async () => {
    const { handle } = setup();
    expect((await handle("POST", "abodeo_label=Robin")).status).toBe(405);
  });
});
