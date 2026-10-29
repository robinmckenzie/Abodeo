// When the window narrows past the point where the menu moves above the
// screen, the screen is pushed down the page by the menu's height. This moves
// the page by the same amount, so that what Robin was looking at stays where
// it was. A page at its very top is left alone, to show the menu.
import { useEffect } from "react";

export function useKeepScrollOnResize() {
  useEffect(() => {
    const page = document.scrollingElement;
    if (!page) return;
    // The distance from the top of the page to where the screen's content
    // starts: the menu's height when the menu is above the panel, and the
    // space the screen leaves above its title, which differs between the two
    // layouts.
    const findPanelTop = () => {
      const panel = document.querySelector(".screen-panel");
      if (!panel) return null;
      const root = getComputedStyle(document.documentElement);
      const screenTop =
        Number.parseFloat(root.getPropertyValue("--screen-top")) *
        Number.parseFloat(root.fontSize);
      return (
        panel.getBoundingClientRect().top +
        page.scrollTop +
        (Number.isFinite(screenTop) ? screenTop : 0)
      );
    };
    let panelTop = findPanelTop();
    const keep = () => {
      const now = findPanelTop();
      if (now !== null && panelTop !== null && page.scrollTop > 0) {
        page.scrollTop += now - panelTop;
      }
      panelTop = now;
    };
    const remember = () => {
      panelTop = findPanelTop();
    };
    window.addEventListener("resize", keep);
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.removeEventListener("resize", keep);
      window.removeEventListener("scroll", remember);
    };
  }, []);
}
