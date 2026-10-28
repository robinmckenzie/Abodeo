// Where the page scrolls to for an expanding project bar (AD #99 Layout and
// Style Tidy). All positions are in the page's own coordinates, from its top.

// The furthest the page may scroll down: the bar's top stays in sight, below
// a sticky title (stickyOffset is its height, 0 without one) and a margin.
export function calculateBarTopLimit({
  barTop,
  stickyOffset,
  margin,
}: {
  barTop: number;
  stickyOffset: number;
  margin: number;
}) {
  return barTop - stickyOffset - margin;
}

// Where the page scrolls to: no further up than where it started, down just
// far enough to show the bar's foot, or the page's end for a new project, and
// never so far down that the bar's top goes out of sight. The foot is shown
// whatever sticks above it, as the bar has the whole window below its top to
// grow into.
export function calculateBarScrollEnd({
  start,
  barTop,
  height,
  viewportHeight,
  pageEnd,
  scrollsToPageEnd,
  stickyOffset,
  margin,
}: {
  start: number;
  barTop: number;
  height: number;
  viewportHeight: number;
  pageEnd: number;
  scrollsToPageEnd: boolean;
  stickyOffset: number;
  margin: number;
}) {
  const footTarget = barTop + height + margin - viewportHeight;
  const end = scrollsToPageEnd ? pageEnd : footTarget;
  return Math.min(
    Math.max(start, end),
    calculateBarTopLimit({ barTop, stickyOffset, margin }),
  );
}
