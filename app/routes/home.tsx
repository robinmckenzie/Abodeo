import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/home";
import { FadeTuningPanel } from "../fade-tuning-panel";
import { TuningPanel } from "../tuning-panel";
import getStartedButton from "../images/get-started-button.png";
import logo from "../images/abodeo-home-logo.jpeg";

export const meta: Route.MetaFunction = () => [
  { title: "Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Home() {
  const [isReleased, setIsReleased] = useState(false);

  return (
    <main className="welcome">
      <FadeTuningPanel />
      <h1>
        <img
          src={logo}
          alt="Abodeo - Your home, sorted."
          width={997}
          height={868}
        />
      </h1>
      {/* Loads the dashboard's code straight away, so that the crossfade
          starts as soon as the button is released. On release the button is
          held at its pressed size until the fade's snapshot is taken, so that
          it springs back from that size as the screen fades. A click that
          opens a new tab or window does not leave this screen, so it is not
          held. */}
      <Link
        to="/dashboard"
        className={isReleased ? "get-started is-released" : "get-started"}
        prefetch="render"
        viewTransition
        onClick={(event) => {
          if (isOpeningElsewhere(event)) return;
          document.documentElement.classList.toggle(
            "get-started-hovered",
            isMouseOver(event),
          );
          setIsReleased(true);
        }}
      >
        <img
          src={getStartedButton}
          alt="Get Started"
          width={457}
          height={136}
        />
      </Link>
      <TuningPanel />
    </main>
  );
}

// True when the button is showing its hovered size: a mouse is over it,
// whether it was clicked or used from the keyboard. A tap is excluded, because
// a touch screen can leave the button marked as hovered after the tap.
function isMouseOver(event: React.MouseEvent<HTMLElement>) {
  const pointerType = (event.nativeEvent as PointerEvent).pointerType;
  return pointerType !== "touch" && event.currentTarget.matches(":hover");
}

function isOpeningElsewhere(event: React.MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
