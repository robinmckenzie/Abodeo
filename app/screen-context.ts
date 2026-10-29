// What the shared layout (AD #99 Layout and Style Tidy) gives each screen:
// the account, which the layout looks up once, and a place to register how
// the screen is left. The account's sign-in, sign-out and the menu's links
// all leave the current screen, so each screen tells the layout how to get
// itself ready.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useOutletContext } from "react-router";

import type { Account } from "./account/use-account";

export type ScreenLeave = {
  // Gets the screen ready to be left, false if the person chose to stay.
  onBeforeLeave?: () => Promise<boolean>;
  // Just before sign-in or sign-out leaves the page.
  onLeaving?: (action: "sign-in" | "sign-out") => void;
  onLeaveFailed?: () => void;
};

export type ScreenContext = {
  account: Account;
  leaveRef: RefObject<ScreenLeave>;
  // Reads the number of projects in the Bin again, for the menu, after a
  // screen has put one in or taken one out.
  refreshBinCount: () => void;
};

export function useScreenAccount(): Account {
  return useOutletContext<ScreenContext>().account;
}

export function useRefreshBinCount(): () => void {
  return useOutletContext<ScreenContext>().refreshBinCount;
}

// Registers the screen's handlers with the layout, the latest on every
// render, and removes them when the screen goes, unless another screen has
// registered its own since.
export function useScreenLeave(leave: ScreenLeave) {
  const { leaveRef } = useOutletContext<ScreenContext>();
  const ownRef = useRef(leave);
  useLayoutEffect(() => {
    ownRef.current = leave;
    leaveRef.current = leave;
  });
  useLayoutEffect(() => {
    const own = ownRef;
    return () => {
      if (leaveRef.current === own.current) leaveRef.current = {};
    };
  }, [leaveRef]);
}
