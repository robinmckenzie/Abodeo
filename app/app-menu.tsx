// The common menu in the left-hand column of every screen (AD #61 Manage
// People): the sign-in or account area, then a link to each of the app's
// screens. Each is an ordinary link, so it works from the keyboard, and one
// that leaves a screen with unsaved changes first lets that screen save them.
import { Link, useNavigate } from "react-router";

import { AccountControl } from "./account/account-control";
import type { Account } from "./account/use-account";

const screens = [
  { path: "/dashboard", name: "Projects" },
  { path: "/people", name: "People" },
] as const;

export type MenuScreen = (typeof screens)[number]["path"];

export function AppMenu({
  current,
  account,
  onBeforeLeave,
}: {
  current: MenuScreen;
  account: Account;
  // Gets the screen ready to be left, false if the person chose to stay.
  onBeforeLeave: () => Promise<boolean>;
}) {
  const navigate = useNavigate();

  return (
    <>
      <AccountControl account={account} onBeforeLeave={onBeforeLeave} />
      <nav className="app-menu" aria-label="Main">
        <ul className="app-menu-list">
          {screens.map(({ path, name }) => (
            <li key={path}>
              <Link
                to={path}
                aria-current={path === current ? "page" : undefined}
                onClick={async (event) => {
                  // Staying on the screen needs no leave.
                  if (path === current) {
                    event.preventDefault();
                    return;
                  }
                  event.preventDefault();
                  if (await onBeforeLeave()) void navigate(path);
                }}
              >
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
