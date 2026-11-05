// Whether an element can be animated: the browser supports element
// animations and the person has not asked for reduced motion.
export function canAnimate(element: HTMLElement) {
  return (
    typeof element.animate === "function" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
