// The frame every screen after the home page shares (AD #99 Layout and Style
// Tidy): the left-hand column with the logo, the account area and the menu,
// and the signed-in account, looked up once. The screen itself is the outlet,
// and tells the layout how it is left through useScreenLeave.
import { useRef } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { useAccount } from "../account/use-account";
import { AppMenu, useScreenLinkClick, type MenuScreen } from "../app-menu";
import logo from "../images/abodeo-home-logo.jpeg";
import type { ScreenContext, ScreenLeave } from "../screen-context";

// Whether each screen's title stays in view while its content scrolls. One
// switch, so that it can be tried and taken away: the style is under the
// data-sticky-titles attribute.
const isScreenTitleSticky = true;

export default function AppLayout() {
  const pathname = useLocation().pathname;
  const current = pathname as MenuScreen;
  const leaveRef = useRef<ScreenLeave>({});
  const account = useAccount({
    onBeforeLeave: async () => (await leaveRef.current.onBeforeLeave?.()) ?? true,
    onLeaving: (action) => leaveRef.current.onLeaving?.(action),
    onLeaveFailed: () => leaveRef.current.onLeaveFailed?.(),
  });
  const getClickHandler = useScreenLinkClick(
    async () => (await leaveRef.current.onBeforeLeave?.()) ?? true,
  );
  const context: ScreenContext = { account, leaveRef };

  return (
    <div
      className="app-layout"
      data-sticky-titles={isScreenTitleSticky ? "" : undefined}
    >
      <header>
        <h1>
          <Link to="/dashboard" onClick={getClickHandler("/dashboard", current)}>
            <img
              src={logo}
              alt="Abodeo - Your home, sorted."
              width={997}
              height={868}
            />
          </Link>
        </h1>
        <AppMenu
          current={current}
          account={account}
          onBeforeLeave={async () =>
            (await leaveRef.current.onBeforeLeave?.()) ?? true
          }
          onLeaveFailed={() => leaveRef.current.onLeaveFailed?.()}
        />
      </header>
      <Outlet context={context} />
    </div>
  );
}
