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

// Where the page scrolls to: the bar centred in the window below any sticky
// title, or the page's end for a new project, but never so far down that the
// bar's top goes out of sight. A bar too tall to centre therefore has its top
// kept in sight, and its foot goes off the bottom.
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
  const centreTarget =
    barTop - stickyOffset - (viewportHeight - stickyOffset - height) / 2;
  const end = scrollsToPageEnd
    ? Math.max(start, pageEnd)
    : Math.max(0, centreTarget);
  return Math.min(end, calculateBarTopLimit({ barTop, stickyOffset, margin }));
}
