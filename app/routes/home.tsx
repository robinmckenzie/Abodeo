import { Link } from "react-router";

import type { Route } from "./+types/home";
import getStartedButton from "../images/get-started-button.png";
import logo from "../images/abodeo-home-logo.jpeg";

export const meta: Route.MetaFunction = () => [
  { title: "Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Home() {
  return (
    <main className="welcome">
      <h1>
        <img
          src={logo}
          alt="Abodeo - Your home, sorted."
          width={997}
          height={868}
        />
      </h1>
      {/* Loads the dashboard's code straight away, so that the crossfade
          starts as soon as the button is released. */}
      <Link
        to="/dashboard"
        className="get-started"
        prefetch="render"
        viewTransition
      >
        <img
          src={getStartedButton}
          alt="Get Started"
          width={457}
          height={136}
        />
      </Link>
    </main>
  );
}
