// While a task is dragged, the list scrolls when the pointer is near its top
// or bottom edge, or anywhere beyond it. Browsers only scroll for the last few
// pixels, which is hard to land on.
const edgeSize = 48;
const slowestStep = 2;
const fastestStep = 22;

// Pixels to scroll per frame: negative to go up, positive to go down, 0 to
// stay put. The speed rises the further the pointer is into or past the edge.
export function calculateDragScroll(
  pointerY: number,
  listTop: number,
  listBottom: number,
) {
  const intoTop = listTop + edgeSize - pointerY;
  if (intoTop > 0) return -scaleStep(intoTop);
  const intoBottom = pointerY - (listBottom - edgeSize);
  if (intoBottom > 0) return scaleStep(intoBottom);
  return 0;
}

function scaleStep(distance: number) {
  const fraction = Math.min(distance / (edgeSize * 2), 1);
  return slowestStep + (fastestStep - slowestStep) * fraction;
}
