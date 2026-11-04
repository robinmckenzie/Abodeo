// Sizes a textarea to fit its text, borders included, so that it grows and
// shrinks with what is typed instead of scrolling.
export function fitHeightToText(box: HTMLTextAreaElement) {
  box.style.height = "auto";
  const borders = box.offsetHeight - box.clientHeight;
  box.style.height = `${box.scrollHeight + borders}px`;
}
