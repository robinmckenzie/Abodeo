import { useEffect, useRef } from "react";

import type { Route } from "./+types/dashboard";
import logo from "../images/abodeo-home-logo.jpeg";

export const meta: Route.MetaFunction = () => [
  { title: "Dashboard - Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Dashboard() {
  const mainRef = useRef<HTMLElement>(null);

  // The Get Started link disappears when it is used, so focus moves to the
  // dashboard's content and screen readers announce the new screen.
  useEffect(() => {
    mainRef.current?.focus();
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>
          <img
            src={logo}
            alt="Abodeo - Your home, sorted."
            width={997}
            height={868}
          />
        </h1>
      </header>
      <main ref={mainRef} tabIndex={-1}>
        <p>No projects added yet.</p>
      </main>
    </div>
  );
}
