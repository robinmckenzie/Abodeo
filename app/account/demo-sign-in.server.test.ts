// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SignInCapture } from "./account-auth.server";
import { demoAccountEmail, respondWithDemoSignIn } from "./demo-sign-in.server";
import {
  createTestAuth,
  signInTestAccount,
  testBaseUrl,
} from "./test-account.server";

describe("respondWithDemoSignIn", () => {
  it("signs in as the demo account and redirects to the dashboard", async () => {
    const { auth } = createTestAuth();
    const { user } = await signInTestAccount(auth, {
      email: demoAccountEmail,
      sub: "demo-sub",
    });
    const response = await respondWithDemoSignIn(
      new Request(`${testBaseUrl}/demo`),
      auth,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${testBaseUrl}/dashboard`);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.split(";")[0] }),
    });
    expect(session?.user.id).toBe(user.id);
  });

  it("ignores an email or user in the address", async () => {
    const { auth } = createTestAuth();
    const { user: demo } = await signInTestAccount(auth, {
      email: demoAccountEmail,
      sub: "demo-sub",
    });
    await signInTestAccount(auth, { email: "other@example.com", sub: "other" });
    const response = await respondWithDemoSignIn(
      new Request(
        `${testBaseUrl}/demo?email=other@example.com&user=other&label=Acme`,
      ),
      auth,
    );
    const cookie = response.headers.get("Set-Cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.split(";")[0] }),
    });
    expect(session?.user.id).toBe(demo.id);
  });

  it("gives 404 when the demo account does not exist", async () => {
    const { auth } = createTestAuth();
    const response = await respondWithDemoSignIn(
      new Request(`${testBaseUrl}/demo`),
      auth,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  describe("label and random word", () => {
    async function openDemo(address: string, cookie?: string) {
      const { auth } = createTestAuth();
      await signInTestAccount(auth, { email: demoAccountEmail, sub: "demo" });
      const capture: SignInCapture = {};
      const response = await respondWithDemoSignIn(
        new Request(`${testBaseUrl}${address}`, {
          headers: cookie ? { Cookie: cookie } : {},
        }),
        auth,
        capture,
      );
      const cookies = response.headers.getSetCookie();
      const value = (name: string) =>
        cookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0];
      return { capture, value };
    }

    it("gives a new visitor a word and keeps the label from the address", async () => {
      const { capture, value } = await openDemo("/demo?label=Moodys");
      expect(capture.demoUsage?.label).toBe("Moodys");
      expect(capture.demoUsage?.word).toMatch(/^[a-z]{8}$/);
      expect(value("abodeo_label")).toBe("abodeo_label=Moodys");
      expect(value("abodeo_visitor")).toBe(
        `abodeo_visitor=${capture.demoUsage?.word}`,
      );
    });

    it("keeps the same word when the label changes", async () => {
      const first = await openDemo("/demo?label=Moodys");
      const word = first.capture.demoUsage?.word;
      const second = await openDemo(
        "/demo?label=Bob",
        `abodeo_visitor=${word}`,
      );
      expect(second.capture.demoUsage).toEqual({ label: "Bob", word });
    });

    it("uses the word as the label when the address has none, again on a second visit", async () => {
      const first = await openDemo("/demo");
      const word = first.capture.demoUsage?.word;
      expect(first.capture.demoUsage?.label).toBe(word);
      const second = await openDemo("/demo", `abodeo_visitor=${word}`);
      expect(second.capture.demoUsage).toEqual({ label: word, word });
    });

    it("treats an invalid label or PUBLIC as no label", async () => {
      const bad = await openDemo("/demo?label=a%3Cb");
      expect(bad.capture.demoUsage?.label).toBe(bad.capture.demoUsage?.word);
      const clear = await openDemo("/demo?label=public");
      expect(clear.capture.demoUsage?.label).toBe(
        clear.capture.demoUsage?.word,
      );
    });
  });

  describe("reset to the seed", () => {
    async function openDemo(cookie?: string) {
      const { auth } = createTestAuth();
      const { user } = await signInTestAccount(auth, {
        email: demoAccountEmail,
        sub: "demo",
      });
      const resets: string[] = [];
      await respondWithDemoSignIn(
        new Request(`${testBaseUrl}/demo`, {
          headers: cookie ? { Cookie: cookie } : {},
        }),
        auth,
        {},
        async (userId) => resets.push(userId),
      );
      return { resets, userId: user.id };
    }

    it("resets the demo account for a new visitor", async () => {
      const { resets, userId } = await openDemo();
      expect(resets).toEqual([userId]);
    });

    it("leaves the account as it is for a returning visitor", async () => {
      const { resets } = await openDemo("abodeo_visitor=abcdefgh");
      expect(resets).toEqual([]);
    });

    it("does not reset when the demo account does not exist", async () => {
      const { auth } = createTestAuth();
      const resets: string[] = [];
      await respondWithDemoSignIn(
        new Request(`${testBaseUrl}/demo`),
        auth,
        {},
        async (userId) => resets.push(userId),
      );
      expect(resets).toEqual([]);
    });
  });
});
