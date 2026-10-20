import { useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import type { Route } from "./+types/home";
import { FadeTuningPanel } from "../fade-tuning-panel";
import { KeyboardShortcuts } from "../keyboard-shortcuts";
import {
  hasProjectsAttribute,
  hasOwnProjects,
  isWelcomeRequested,
} from "../projects/project-storage";
import { TuningPanel } from "../tuning-panel";
import getStartedButton from "../images/get-started-button.png";
import logo from "../images/abodeo-home-logo.jpeg";

export const meta: Route.MetaFunction = () => [
  { title: "Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Home() {
  const [isReleased, setIsReleased] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // With projects of their own saved, the page shows only the logo, which fades in and
  // holds, then crossfades to the dashboard. The page is marked before it
  // first appears by hasProjectsScript, and again here for a visit to this
  // screen from within the app, before the browser paints. The timing comes
  // from a clock animation that app.css runs on the logo from when it
  // appears, so that the wait for the app to load counts towards the hold.
  // The welcome screen is replaced in the browser history, so that Back from
  // the dashboard does not return to it only to be moved on again.
  useLayoutEffect(() => {
    const isReturning =
      hasOwnProjects() && !isWelcomeRequested(location.search);
    document.documentElement.toggleAttribute(hasProjectsAttribute, isReturning);
    if (!isReturning) return;
    let isCancelled = false;
    const showDashboard = () => {
      if (!isCancelled) {
        navigate("/dashboard", { replace: true, viewTransition: true });
      }
    };
    const clock = headingRef.current
      ?.getAnimations?.()
      .find(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName === "returning-clock",
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (clock) clock.finished.then(showDashboard, () => {});
    else timer = setTimeout(showDashboard, returningHold);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [location.search, navigate]);

  return (
    <main className="welcome">
      <FadeTuningPanel />
      <h1 ref={headingRef}>
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
        state={{ openAddProject: true }}
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
      <KeyboardShortcuts
        shortcuts={[
          { keyboardKeyLabel: "T", action: "Toggle tuning panel" },
          { keyboardKeyLabel: "F", action: "Toggle fading panel" },
        ]}
      />
    </main>
  );
}

// The returning-visitor fade-in and hold, as in app.css, for browsers that
// cannot report the clock animation.
const returningHold = 1400;

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
