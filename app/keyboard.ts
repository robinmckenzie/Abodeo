// True when a key press goes into a field, so that single-letter shortcuts
// such as T, F and E leave it alone.
export function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input:not([type=range]), textarea, select"))
  );
}
