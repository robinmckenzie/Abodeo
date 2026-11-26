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

// Waits a while, or until the tour ends. A pause ends at once when hurried
// is aborted, as the visitor's right arrow key does.
export function pause(ms: number, signal: AbortSignal, hurried?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    checkRunning(signal);
    if (hurried?.aborted) {
      resolve();
      return;
    }
    const stop = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", ended);
      hurried?.removeEventListener("abort", hurry);
    };
    const ended = () => {
      stop();
      reject(new TourEnded());
    };
    const hurry = () => {
      stop();
      resolve();
    };
    const timer = window.setTimeout(hurry, ms);
    signal.addEventListener("abort", ended, { once: true });
    hurried?.addEventListener("abort", hurry, { once: true });
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
// Once hurried, the rest goes in at once.
export async function typeInto(
  field: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  signal: AbortSignal,
  hurried?: AbortSignal,
) {
  field.focus();
  const characters = [...text];
  for (const [index, character] of characters.entries()) {
    await pause(tourPace.typing, signal, hurried);
    if (hurried?.aborted) {
      setFieldValue(field, field.value + characters.slice(index).join(""));
      return;
    }
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
