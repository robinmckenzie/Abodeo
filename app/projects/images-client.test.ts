import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendUploadByXhr, uploadImage } from "./images-client";

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress: ((event: unknown) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  timeout = 0;
  withCredentials = true;
  responseType = "";
  status = 0;
  response: ArrayBuffer | null = null;
  method = "";
  path = "";
  headers: Record<string, string> = {};
  body: unknown;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, path: string) {
    this.method = method;
    this.path = path;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.response = new TextEncoder().encode(JSON.stringify(body)).buffer;
    this.onload?.();
  }
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = {
  headers: { "X-A": "b" },
  body: new Uint8Array([1, 2]),
  timeout: 5000,
};

describe("sendUploadByXhr", () => {
  it("sends the headers and body as fetch did, and resolves with the answer", async () => {
    const sent = sendUploadByXhr("/api/up", request);
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.path).toBe("/api/up");
    expect(xhr.headers).toEqual({ "X-A": "b", "Cache-Control": "no-store" });
    expect(xhr.timeout).toBe(5000);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.body).toBe(request.body);
    xhr.answer(409, { error: "no_space" });
    const response = await sent;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_space" });
  });

  it("reports progress as a fraction, or null where the length is not known", () => {
    const onProgress = vi.fn();
    void sendUploadByXhr("/api/up", request, onProgress);
    const { upload } = FakeXhr.last;
    upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
    expect(onProgress.mock.calls).toEqual([[0.25], [null]]);
  });

  it("does not take the end of the upload as the answer", async () => {
    const sent = sendUploadByXhr("/api/up", request);
    let isDone = false;
    void sent.then(() => (isDone = true));
    FakeXhr.last.upload.onprogress?.({
      lengthComputable: true,
      loaded: 2,
      total: 2,
    });
    await Promise.resolve();
    expect(isDone).toBe(false);
    FakeXhr.last.answer(200, {});
    await sent;
  });

  it.each(["onerror", "ontimeout", "onabort"] as const)(
    "rejects on %s",
    async (name) => {
      const sent = sendUploadByXhr("/api/up", request);
      FakeXhr.last[name]?.();
      await expect(sent).rejects.toThrow();
    },
  );
});

describe("uploadImage", () => {
  it("maps a failed or timed out request to unreachable and a status to its reason, passing progress on", async () => {
    const bytes = new Uint8Array([1]);
    const down = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await uploadImage("ada", "shed", "i", bytes, bytes, down)).toEqual({
      ok: false,
      reason: "unreachable",
    });
    const tooLarge = vi.fn(async () => new Response("{}", { status: 413 }));
    expect(
      await uploadImage("ada", "shed", "i", bytes, bytes, tooLarge),
    ).toEqual({ ok: false, reason: "too-large" });
    const progress = vi.fn();
    await uploadImage("ada", "shed", "i", bytes, bytes, tooLarge, progress);
    expect((tooLarge.mock.calls as unknown[][])[1][2]).toBe(progress);
  });
});
