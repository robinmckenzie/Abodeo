// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { readJsonBody } from "./json-body.server";

const url = "http://localhost:5173/api/test";

function createRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body, headers });
}

describe("readJsonBody", () => {
  it("returns the parsed JSON of a valid body", async () => {
    const request = createRequest(JSON.stringify({ name: "Kitchen" }));
    await expect(readJsonBody(request, 1000)).resolves.toEqual({
      name: "Kitchen",
    });
  });

  it("returns undefined for a body that is not valid JSON", async () => {
    await expect(readJsonBody(createRequest("{not json"), 1000)).resolves.toBe(
      undefined,
    );
  });

  it("refuses a declared length over the limit without reading the body", async () => {
    const request = createRequest("{}", { "Content-Length": "11" });
    const read = vi.spyOn(request, "arrayBuffer");
    await expect(readJsonBody(request, 10)).resolves.toBe("too-large");
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit when no length was declared", async () => {
    const body = JSON.stringify({ text: "x".repeat(20) });
    const request = createRequest(body);
    expect(request.headers.get("Content-Length")).toBeNull();
    await expect(readJsonBody(request, 10)).resolves.toBe("too-large");
  });

  it("accepts a body exactly at the limit", async () => {
    const body = JSON.stringify({ a: 1 });
    await expect(
      readJsonBody(createRequest(body), body.length),
    ).resolves.toEqual({ a: 1 });
  });

  it("returns undefined for a body that fails to read", async () => {
    const request = createRequest("{}");
    vi.spyOn(request, "arrayBuffer").mockRejectedValue(new TypeError("failed"));
    await expect(readJsonBody(request, 1000)).resolves.toBe(undefined);
  });
});
