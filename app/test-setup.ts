import { beforeEach } from "vitest";

import { forgetLastKnownAccount } from "./account/use-account";

// Each test starts as a fresh page load, not a move between screens.
beforeEach(forgetLastKnownAccount);
