// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  demoAccountEmail,
  respondWithDemoSignIn,
} from "./demo-sign-in.server";
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
});
