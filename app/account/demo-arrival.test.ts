import { beforeEach, describe, expect, it, vi } from "vitest";

// The module remembers that it has asked, so each test loads it afresh.
async function loadArrival() {
  vi.resetModules();
  return (await import("./demo-arrival")).requestSeedCalendarOnArrival;
}

describe("requestSeedCalendarOnArrival", () => {
  const request = vi.fn(async () => {});
  beforeEach(() => request.mockClear());

  it("asks for the calendar once, however often the welcome screen shows", async () => {
    const arrive = await loadArrival();
    arrive("?demo", request);
    arrive("?demo", request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not ask on any other visit to the welcome screen", async () => {
    const arrive = await loadArrival();
    arrive("", request);
    arrive("?welcome", request);
    expect(request).not.toHaveBeenCalled();
  });

  it("carries on when the request fails", async () => {
    const arrive = await loadArrival();
    expect(() => arrive("?demo", () => Promise.reject(new Error()))).not.toThrow();
  });
});
