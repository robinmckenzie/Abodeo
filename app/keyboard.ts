import { useSyncExternalStore } from "react";

// True when a key press goes into a field, so that single-letter shortcuts
// such as T, F and E leave it alone.
export function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input:not([type=range]), textarea, select"))
  );
}

function subscribeToFocus(listener: () => void) {
  document.addEventListener("focusin", listener);
  document.addEventListener("focusout", listener);
  return () => {
    document.removeEventListener("focusin", listener);
    document.removeEventListener("focusout", listener);
  };
}

// True while focus is in a field, where single-letter shortcuts do not
// work. False on the server, where nothing has focus.
export function useIsTextFieldFocused() {
  return useSyncExternalStore(
    subscribeToFocus,
    () => isTextField(document.activeElement),
    () => false,
  );
}
