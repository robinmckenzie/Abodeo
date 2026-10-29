// The frame every screen after the home page shares (AD #99 Layout and Style
// Tidy): the left-hand column with the logo, the account area and the menu,
// and the signed-in account, looked up once. The screen itself is the outlet,
// and tells the layout how it is left through useScreenLeave.
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { useAccount } from "../account/use-account";
import { loadAccountBin } from "../projects/account-projects";
import { AppMenu, useScreenLinkClick, type MenuScreen } from "../app-menu";
import logo from "../images/abodeo-home-logo.jpeg";
import type { ScreenContext, ScreenLeave } from "../screen-context";
import { useKeepScrollOnResize } from "./use-keep-scroll-on-resize";

// Whether each screen's title stays in view while its content scrolls. One
// switch, so that it can be tried and taken away: the style is under the
// data-sticky-titles attribute.
const isScreenTitleSticky = true;

export default function AppLayout() {
  useKeepScrollOnResize();
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

  // How many projects are in the Bin, for the menu. Unknown until read, and
  // when it cannot be read.
  const accountId = account.view.kind === "signed-in" ? account.view.id : null;
  const [binCount, setBinCount] = useState<{
    accountId: string;
    count: number;
  } | null>(null);
  const [binReloadCount, setBinReloadCount] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    let isCurrent = true;
    void loadAccountBin(accountId).then((result) => {
      if (isCurrent && result.ok) {
        setBinCount({ accountId, count: result.projects.length });
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [accountId, binReloadCount]);
  const context: ScreenContext = {
    account,
    leaveRef,
    refreshBinCount: () => setBinReloadCount((count) => count + 1),
  };

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
          binCount={
            binCount && binCount.accountId === accountId ? binCount.count : 0
          }
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
