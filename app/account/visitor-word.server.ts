// The visitor's random word (AD #138 Demo Entry And Seed): given the first
// time a browser opens /demo and kept in a cookie that both /demo and /api
// requests carry, so that visits under different labels from one browser can be joined up.
// It identifies a browser, not a person, and is stored with every usage
// record.
export const visitorWordCookieName = "abodeo_visitor";

export const visitorWordLength = 8;

const visitorWordLifetimeSeconds = 365 * 24 * 60 * 60;

const validWord = /^[a-z]{8}$/;

function isVisitorWord(value: string) {
  return validWord.test(value);
}

// A new random word: lower-case letters only, so it is also a valid label.
export function makeVisitorWord(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(visitorWordLength));
  return Array.from(bytes, (byte) =>
    String.fromCharCode(97 + (byte % 26)),
  ).join("");
}

// The word in the request's Cookie header, or "" if there is none.
export function readVisitorWord(headers: Headers | undefined): string {
  const cookies = headers?.get("Cookie");
  if (!cookies) return "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== visitorWordCookieName) continue;
    const value = part.slice(separator + 1).trim();
    return isVisitorWord(value) ? value : "";
  }
  return "";
}

// The Set-Cookie text keeping the word. A cookie has one Path, and the word is
// read at /demo and used at /api, so the path is the whole site.
export function formatVisitorWordCookie(word: string, isSecure: boolean) {
  return `${visitorWordCookieName}=${word}; Max-Age=${visitorWordLifetimeSeconds}; Path=/; HttpOnly; SameSite=Lax${
    isSecure ? "; Secure" : ""
  }`;
}
