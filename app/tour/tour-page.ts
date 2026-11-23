// How the demo tour (AD #139 Demo Tour) works the page as a visitor would:
// typing into the real fields, pressing keys, and waiting for the page to
// catch up. Each helper stops when the tour ends, through its signal.

// How fast the tour goes, in milliseconds. Tests set these to 0.
export const tourPace = {
  // Between one typed character and the next.
  typing: 45,
  // Before typing into a window that has just opened, as its parts arrive.
  settling: 500,
};

// Ends a helper's wait when the tour ends.
export class TourEnded extends Error {
  constructor() {
    super("The tour has ended.");
  }
}

function checkRunning(signal: AbortSignal) {
  if (signal.aborted) throw new TourEnded();
}

// Waits a while, or until the tour ends.
export function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    checkRunning(signal);
    const ended = () => {
      window.clearTimeout(timer);
      reject(new TourEnded());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", ended);
      resolve();
    }, ms);
    signal.addEventListener("abort", ended, { once: true });
  });
}

// Waits, with no time limit, until find returns something, and gives that.
// It looks every 50 ms rather than watching for changes, as a value React
// sets on a field changes nothing that can be watched.
export async function waitUntil<T>(
  find: () => T | null | undefined | false,
  signal: AbortSignal,
): Promise<T> {
  for (;;) {
    checkRunning(signal);
    const found = find();
    if (found) return found;
    await pause(50, signal);
  }
}

// Sets a field's value so that React sees an ordinary change: through the
// browser's own value setter, which React's tracking of the value does not
// intercept, followed by the input event a visitor's typing would fire.
export function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

// Types text into a field one character at a time, after what it holds.
export async function typeInto(
  field: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  signal: AbortSignal,
) {
  field.focus();
  for (const character of text) {
    await pause(tourPace.typing, signal);
    setFieldValue(field, field.value + character);
  }
}

export function pressEnter(field: HTMLElement) {
  field.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}
