// The common menu in the left-hand column of every screen (AD #61 Manage
// People): the sign-in or account area, then a link to each of the app's
// screens. Each is an ordinary link, so it works from the keyboard, and one
// that leaves a screen with unsaved changes first lets that screen save them.
import { Link, useNavigate } from "react-router";

import { AccountControl } from "./account/account-control";
import type { Account } from "./account/use-account";
import { BinScreenIcon, PeopleIcon, ProjectsIcon } from "./ui/icons";

const screens = [
  { path: "/dashboard", name: "Projects", Icon: ProjectsIcon },
  { path: "/people", name: "People", Icon: PeopleIcon },
  // Deleted projects (AD #62 Delete Projects), only for an account, as signed
  // out there is no Bin.
  { path: "/bin", name: "Bin", Icon: BinScreenIcon },
] as const;

export type MenuScreen = (typeof screens)[number]["path"];

// The click on a link to a screen, which lets the current screen save before
// the app moves on. A link to the screen already shown does nothing.
export function useScreenLinkClick(onBeforeLeave: () => Promise<boolean>) {
  const navigate = useNavigate();
  return (path: string, current: string) =>
    async (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Opening in another tab or window is left to the browser.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      // Staying on the screen needs no leave.
      if (path === current) return;
      if (await onBeforeLeave()) void navigate(path);
    };
}

export function AppMenu({
  current,
  account,
  binCount = 0,
  onBeforeLeave,
  onLeaveFailed,
}: {
  current: MenuScreen;
  account: Account;
  // The number of projects in the Bin, shown after its name when not zero.
  binCount?: number;
  // Gets the screen ready to be left, false if the person chose to stay.
  onBeforeLeave: () => Promise<boolean>;
  onLeaveFailed?: () => void;
}) {
  const getClickHandler = useScreenLinkClick(onBeforeLeave);
  const shownScreens = screens.filter(
    ({ path }) => path !== "/bin" || account.view.kind === "signed-in",
  );

  return (
    <>
      <AccountControl account={account} onBeforeLeave={onBeforeLeave} onLeaveFailed={onLeaveFailed} />
      <nav className="app-menu" aria-label="Main">
        <ul className="app-menu-list">
          {shownScreens.map(({ path, name, Icon }) => (
            <li key={path}>
              <Link
                to={path}
                aria-current={path === current ? "page" : undefined}
                onClick={getClickHandler(path, current)}
              >
                <Icon />
                {path === "/bin" && binCount > 0
                  ? `${name} (${binCount})`
                  : name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
