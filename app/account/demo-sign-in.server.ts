// Signs a visitor in as the demo account without Google (AD #138 Demo Entry
// And Seed). The address /demo takes no input: the account is fixed here, so
// nothing in the request can choose another one.
import { makeSignature } from "better-auth/crypto";

import { accountReturnPath } from "./account-api";
import type { AccountAuth, SignInCapture } from "./account-auth.server";
import { formatLabelCookie, readLabelRequest } from "./usage-label";
import {
  formatVisitorWordCookie,
  makeVisitorWord,
  readVisitorWord,
} from "./visitor-word.server";

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

// The label and word of this visit. The word is the browser's, made on its
// first visit. The label is ?label=NAME, or the word when the address has
// none (or PUBLIC), so that every demo visit can be told apart.
export function planDemoVisit(request: Request) {
  const existing = readVisitorWord(request.headers);
  const word = existing || makeVisitorWord();
  const labelRequest = readLabelRequest(new URL(request.url).search);
  const label = labelRequest.kind === "set" ? labelRequest.label : word;
  return { word, label, isNewVisitor: existing === "" };
}

// Signs in as the demo account and moves on to the projects page. Only the
// label in the address is read; the rest of the query is ignored. The label
// and word are kept in cookies for later requests and in the capture for the
// sign-in's own record.
export async function respondWithDemoSignIn(
  request: Request,
  auth: DemoSessionAuth,
  capture: SignInCapture = {},
) {
  const visit = planDemoVisit(request);
  capture.demoUsage = { label: visit.label, word: visit.word };
  const cookie = await openDemoSessionCookie(auth);
  if (!cookie) return new Response(null, { status: 404 });
  const isSecure = new URL(request.url).protocol === "https:";
  const headers = new Headers({
    Location: new URL(accountReturnPath, request.url).toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", formatLabelCookie(visit.label, isSecure));
  headers.append("Set-Cookie", formatVisitorWordCookie(visit.word, isSecure));
  return new Response(null, { status: 302, headers });
}
