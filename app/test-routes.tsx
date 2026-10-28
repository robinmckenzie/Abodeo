// Tests render a screen inside the shared layout (AD #99), as the app does,
// since a screen takes its account from the layout.
import type { createRoutesStub } from "react-router";

import AppLayout from "./routes/app-layout";

type StubRoutes = Parameters<typeof createRoutesStub>[0];

export function withAppLayout(screens: StubRoutes): StubRoutes {
  return [{ Component: AppLayout, children: screens }];
}
