import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { useUsageLabel } from "./account/use-usage-label";
import { fadeTuningScript } from "./fade-tuning-panel";
import { hasProjectsScript } from "./projects/project-storage";
import { sizeTuningScript } from "./size-sliders";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // hasProjectsScript marks this element before the app loads, which React
    // would otherwise report as a hydration mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Apply values saved by the fade tuning panel and the size sliders
            before the page first appears. */}
        <script dangerouslySetInnerHTML={{ __html: fadeTuningScript }} />
        <script dangerouslySetInnerHTML={{ __html: sizeTuningScript }} />
        {/* Hides the Get Started button from the first frame when projects
            are saved. */}
        <script dangerouslySetInnerHTML={{ __html: hasProjectsScript }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useUsageLabel();
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="error">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
