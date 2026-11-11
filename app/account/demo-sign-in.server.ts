// Signs a visitor in as the demo account without Google (AD #138 Demo Entry
// And Seed). The address /demo takes no input: the account is fixed here, so
// nothing in the request can choose another one.
import { makeSignature } from "better-auth/crypto";

import { accountReturnPath } from "./account-api";
import type { AccountAuth } from "./account-auth.server";

export const demoAccountEmail = "abodeodemo@gmail.com";

// What opening a demo session needs from Better Auth.
export type DemoSessionAuth = Pick<AccountAuth, "$context">;

// The demo account's session cookie, as a Set-Cookie value, or undefined when
// the demo account has not signed in with Google yet.
export async function openDemoSessionCookie(auth: DemoSessionAuth) {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(demoAccountEmail);
  if (!found) return undefined;
  const session = await context.internalAdapter.createSession(found.user.id);
  const signature = await makeSignature(session.token, context.secret);
  const { name, attributes } = context.authCookies.sessionToken;
  const parts = [
    `${name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
    `Path=${attributes.path ?? "/"}`,
    `Max-Age=${context.sessionConfig.expiresIn}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (attributes.secure) parts.push("Secure");
  return parts.join("; ");
}

// Signs in as the demo account and moves on to the projects page. Any query
// in the address is ignored.
export async function respondWithDemoSignIn(
  request: Request,
  auth: DemoSessionAuth,
) {
  const cookie = await openDemoSessionCookie(auth);
  if (!cookie) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(accountReturnPath, request.url).toString(),
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
}
