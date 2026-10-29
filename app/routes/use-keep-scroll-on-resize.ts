// When the window narrows past the point where the menu moves above the
// screen, the screen is pushed down the page by the menu's height. This moves
// the page by the same amount, so that what Robin was looking at stays where
// it was. A page at its very top is left alone, to show the menu.
import { useEffect } from "react";

export function useKeepScrollOnResize() {
  useEffect(() => {
    const page = document.scrollingElement;
    if (!page) return;
    // The distance from the top of the page to the content below the screen's
    // title, which moves with the menu above the panel and with the space the
    // title leaves above itself, whatever those come to.
    const findPanelTop = () => {
      const content = document.querySelector(".screen-title + *");
      return content
        ? content.getBoundingClientRect().top + page.scrollTop
        : null;
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
