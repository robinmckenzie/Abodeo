// When the window narrows past the point where the menu moves above the
// screen, the screen is pushed down the page by the menu's height. This moves
// the page by the same amount, so that what Robin was looking at stays where
// it was. A page at its very top is left alone, to show the menu.
import { useEffect } from "react";

export function useKeepScrollOnResize() {
  useEffect(() => {
    const page = document.scrollingElement;
    if (!page) return;
    // The panel's distance from the top of the page, which is the menu's
    // height when the menu is above it and nothing when it is beside it.
    const findPanelTop = () => {
      const panel = document.querySelector(".screen-panel");
      return panel ? panel.getBoundingClientRect().top + page.scrollTop : null;
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
