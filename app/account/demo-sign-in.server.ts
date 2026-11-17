// Signs a visitor in as the demo account without Google (AD #138 Demo Entry
// And Seed). The address /demo takes no input: the account is fixed here, so
// nothing in the request can choose another one.
import { makeSignature } from "better-auth/crypto";

import {
  accountReturnPath,
  accountSeedCalendarPath,
  demoAccountEmail,
  demoArrivalPath,
} from "./account-api";
import type { AccountAuth, SignInCapture } from "./account-auth.server";
import { formatLabelCookie, readLabelRequest } from "./usage-label";
import {
  formatVisitorWordCookie,
  makeVisitorWord,
  readVisitorWord,
} from "./visitor-word.server";

// What opening a demo session needs from Better Auth.
export type DemoSessionAuth = Pick<AccountAuth, "$context">;

// The demo account's id, or undefined when it has not signed in with Google
// yet.
export async function findDemoUserId(auth: DemoSessionAuth) {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(demoAccountEmail);
  return found?.user.id;
}

// A session cookie for the demo account, as a Set-Cookie value.
export async function openDemoSessionCookie(
  auth: DemoSessionAuth,
  userId: string,
) {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
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

// Says that the calendar is still to be put back to the seed, after a new
// visitor's reset. Sent only to the request that does it, which clears it.
const calendarDueCookieName = "abodeo_demo_calendar";
const calendarDueLifetimeSeconds = 10 * 60;

function formatCalendarDueCookie(maxAge: number, isSecure: boolean) {
  return `${calendarDueCookieName}=1; Max-Age=${maxAge}; Path=${accountSeedCalendarPath}; HttpOnly; SameSite=Lax${
    isSecure ? "; Secure" : ""
  }`;
}

export function clearCalendarDueCookie(isSecure: boolean) {
  return formatCalendarDueCookie(0, isSecure);
}

export function isCalendarDue(headers: Headers) {
  return (headers.get("Cookie") ?? "")
    .split(";")
    .some((part) => part.trim() === `${calendarDueCookieName}=1`);
}

// Signs in as the demo account. Only the label in the address is read; the
// rest of the query is ignored. The label and word are kept in cookies for
// later requests and in the capture for the sign-in's own record. A new
// visitor first has the account reset to the saved seed (resetToSeed says
// whether there was one) and moves on to the welcome screen, which asks for
// the calendar to be put back, so that /demo never waits for Google. A
// returning visitor finds the account as they left it, on the projects page.
export async function respondWithDemoSignIn(
  request: Request,
  auth: DemoSessionAuth,
  capture: SignInCapture = {},
  resetToSeed?: (userId: string) => Promise<unknown>,
) {
  const visit = planDemoVisit(request);
  capture.demoUsage = { label: visit.label, word: visit.word };
  const userId = await findDemoUserId(auth);
  if (!userId) return new Response(null, { status: 404 });
  const wasReset =
    visit.isNewVisitor && (await resetToSeed?.(userId)) === true;
  const cookie = await openDemoSessionCookie(auth, userId);
  const isSecure = new URL(request.url).protocol === "https:";
  const headers = new Headers({
    Location: new URL(
      visit.isNewVisitor ? demoArrivalPath : accountReturnPath,
      request.url,
    ).toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", cookie);
  if (wasReset) {
    headers.append(
      "Set-Cookie",
      formatCalendarDueCookie(calendarDueLifetimeSeconds, isSecure),
    );
  }
  headers.append("Set-Cookie", formatLabelCookie(visit.label, isSecure));
  headers.append("Set-Cookie", formatVisitorWordCookie(visit.word, isSecure));
  return new Response(null, { status: 302, headers });
}
