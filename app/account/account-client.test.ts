import { describe, expect, it, vi } from "vitest";

import { reportVisit } from "./account-client";

describe("reportVisit", () => {
  it("posts the welcome flag with keepalive, so leaving the page does not cancel it", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await reportVisit(true, fetchFn);
    const [path, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/visit");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.body).toBe(JSON.stringify({ welcome: true }));
  });

  it("fails when the server does not accept the visit", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await expect(reportVisit(false, fetchFn)).rejects.toThrow();
  });
});
