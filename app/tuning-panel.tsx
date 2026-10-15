// A panel for tuning the Get Started button's movement, shown and hidden with
// T on the welcome screen. It overrides the values in app.css with a style
// element in the page's head, and its starting values match them.
import { useEffect, useState } from "react";

import {
  buildSpringEasing,
  calculateSpringProgress,
  type Spring,
} from "./spring-easing";

type Values = {
  hoverScale: number;
  hoverDuration: number;
  hoverSpring: Spring;
  pressScale: number;
  pressDuration: number;
  pressSpring: Spring;
  releaseDuration: number;
  releaseSpring: Spring;
  fadeDuration: number;
};

export const defaultValues: Values = {
  hoverScale: 1.05,
  hoverDuration: 0.31,
  hoverSpring: { first: 0.8, dip: 0.16, second: 0.1, peakAt: 0.25 },
  pressScale: 0.95,
  pressDuration: 0.31,
  pressSpring: { first: 0.45, dip: 0.16, second: 0.1, peakAt: 0.3 },
  releaseDuration: 0.3,
  releaseSpring: { first: 0.45, dip: 0.16, second: 0.06, peakAt: 0.3 },
  fadeDuration: 1,
};

// Kept outside the component so that values survive going to the dashboard
// and back. A page reload resets them.
let saved = defaultValues;
let savedVisible = false;

function buildCss(v: Values) {
  return `
@media (prefers-reduced-motion: no-preference) {
  @media (hover: hover) {
    .get-started:hover {
      transform: scale(${v.hoverScale});
      transition-duration: ${v.hoverDuration}s;
      transition-timing-function: ${buildSpringEasing(v.hoverSpring)};
    }
  }
  .get-started:active {
    transform: scale(${v.pressScale});
    transition-duration: ${v.pressDuration}s;
    transition-timing-function: ${buildSpringEasing(v.pressSpring)};
  }
  .get-started.is-released {
    transform: scale(${v.pressScale});
  }
  ::view-transition-group(root),
  ::view-transition-old(root),
  ::view-transition-new(root),
  ::view-transition-group(get-started) {
    animation-duration: ${v.fadeDuration}s;
  }
  ::view-transition-old(get-started) {
    animation:
      tune-release ${v.releaseDuration}s ${buildSpringEasing(v.releaseSpring)} both,
      get-started-fade-out ${v.fadeDuration}s ease-out both;
  }
  .get-started-hovered::view-transition-old(get-started) {
    animation-name: tune-release-hovered, get-started-fade-out;
  }
}
@keyframes tune-release {
  to { transform: scale(${1 / v.pressScale}); }
}
@keyframes tune-release-hovered {
  to { transform: scale(${v.hoverScale / v.pressScale}); }
}
.tuning-panel {
  width: 100%;
  max-width: 1100px;
  margin-top: 32px;
  display: grid;
  gap: 16px;
  font-size: 14px;
}
.tuning-panel fieldset {
  display: grid;
  gap: 6px;
  min-inline-size: 0;
  margin: 0;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
}
.tuning-panel legend {
  font-weight: 700;
  padding: 0 4px;
}
.tuning-panel svg {
  display: block;
  width: 100%;
  height: auto;
}
/* On a phone in landscape the panel goes below the logo and button, which
   stay side by side and shrink to fit. */
@media (orientation: landscape) and (max-height: 500px) {
  .welcome:has(> .tuning-panel) {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: center;
    align-content: center;
    align-items: center;
    column-gap: 2rem;
  }
  .tuning-panel {
    grid-column: 1 / -1;
  }
}`;
}

// Puts the CSS in a style element in the page's head rather than in the
// panel, so that it still applies while the welcome screen fades out and the
// panel is removed with it.
function applyCss(css: string) {
  let style = document.getElementById("tuning-panel-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "tuning-panel-css";
    document.head.append(style);
  }
  style.textContent = css;
}

const formatPercent = (s: number) => `${(s * 100).toFixed(1)}%`;

function Graph({
  title,
  from,
  to,
  duration,
  spring,
  fadeDuration,
}: {
  title: string;
  from: number;
  to: number;
  duration: number;
  spring: Spring;
  fadeDuration?: number;
}) {
  const width = 340;
  const height = 170;
  const pad = 32;
  const maxTime = Math.max(duration, fadeDuration ?? 0, 0.4);
  const points: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    points.push([
      t * duration,
      from + (to - from) * calculateSpringProgress(spring, t),
    ]);
  }
  points.push([maxTime, to]);
  const scales = points.map(([, s]) => s);
  const extreme = to > from ? Math.max(...scales) : Math.min(...scales);
  const lo = Math.min(0.85, ...scales, from, to) - 0.01;
  const hi = Math.max(1.15, ...scales, from, to) + 0.01;
  const px = (t: number) => pad + (t / maxTime) * (width - pad - 8);
  const py = (s: number) =>
    height - pad + 8 - ((s - lo) / (hi - lo)) * (height - pad);
  const toPath = (line: [number, number][]) =>
    line
      .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
  const ticks = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15].filter(
    (s) => s >= lo && s <= hi,
  );
  // The screen's ease-out fade, from fully visible at the top to gone at the
  // bottom.
  const fade: [number, number][] = [];
  if (fadeDuration !== undefined) {
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const u = 1 - t;
      const x = 3 * u * t * t * 0.58 + t * t * t;
      const y = 3 * u * t * t + t * t * t;
      fade.push([px(x * fadeDuration), 8 + y * (height - pad)]);
    }
  }

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600 }}>
        {title}: {formatPercent(from)} → {formatPercent(to)}, peaks at{" "}
        {formatPercent(extreme)}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ background: "#fff", border: "1px solid #ddd" }}
      >
        {ticks.map((s) => (
          <g key={s}>
            <line x1={pad} x2={width - 8} y1={py(s)} y2={py(s)} stroke="#eee" />
            <text x={2} y={py(s) + 4} fontSize={10} fill="#888">
              {formatPercent(s)}
            </text>
          </g>
        ))}
        <line
          x1={pad}
          x2={width - 8}
          y1={py(to)}
          y2={py(to)}
          stroke="#2a7"
          strokeDasharray="4 3"
        />
        {fade.length > 0 && (
          <path
            d={toPath(fade)}
            fill="none"
            stroke="#c84"
            strokeDasharray="2 3"
          />
        )}
        <path
          d={toPath(points.map(([t, s]) => [px(t), py(s)]))}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth={2}
        />
        <text x={pad} y={height - 6} fontSize={10} fill="#888">
          0s
        </text>
        <text x={width - 40} y={height - 6} fontSize={10} fill="#888">
          {maxTime.toFixed(2)}s
        </text>
      </svg>
      {/* Every graph has this line, empty except for the fade, so that the
          three graphs line up. */}
      <div style={{ fontSize: 12, color: "#c84" }}>
        {fadeDuration !== undefined
          ? "Dotted: the screen fading out (top = fully visible)"
          : " "}
      </div>
    </figure>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "7.5rem minmax(0, 1fr) 3rem",
        gap: 8,
        alignItems: "center",
      }}
    >
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </label>
  );
}

function SpringSliders({
  spring,
  onChange,
}: {
  spring: Spring;
  onChange: (spring: Spring) => void;
}) {
  return (
    <>
      <Slider
        label="First bounce"
        value={spring.first}
        min={0}
        max={2}
        step={0.05}
        onChange={(first) => onChange({ ...spring, first })}
      />
      <Slider
        label="Dip"
        value={spring.dip}
        min={0}
        max={0.5}
        step={0.02}
        onChange={(dip) => onChange({ ...spring, dip })}
      />
      <Slider
        label="Second bounce"
        value={spring.second}
        min={0}
        max={0.5}
        step={0.02}
        onChange={(second) => onChange({ ...spring, second })}
      />
      <Slider
        label="First peak at"
        value={spring.peakAt}
        min={0.1}
        max={0.7}
        step={0.05}
        onChange={(peakAt) => onChange({ ...spring, peakAt })}
      />
    </>
  );
}

function formatSpring(spring: Spring) {
  return `first bounce ${spring.first}, dip ${spring.dip}, second bounce ${spring.second}, first peak at ${spring.peakAt}`;
}

export function TuningPanel() {
  const [v, setV] = useState(saved);
  const [visible, setVisible] = useState(savedVisible);

  // T shows and hides the panel. The tuned values apply either way. A held
  // key, browser shortcuts and typing into a text field are ignored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextField(e.target)) return;
      savedVisible = !savedVisible;
      setVisible(savedVisible);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    applyCss(buildCss(v));
  }, [v]);

  const update = (patch: Partial<Values>) => {
    saved = { ...v, ...patch };
    setV(saved);
  };

  if (!visible) return null;

  // Without hover, as on a touch screen, the button starts and ends a press
  // at its normal size.
  const canHover = window.matchMedia?.("(hover: hover)").matches ?? true;
  const restingScale = canHover ? v.hoverScale : 1;

  return (
    <div className="tuning-panel">
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
          gap: 16,
        }}
      >
        <fieldset>
          <legend>1. Hover</legend>
          <Slider
            label="Size"
            value={v.hoverScale}
            min={1}
            max={1.2}
            step={0.005}
            onChange={(hoverScale) => update({ hoverScale })}
          />
          <Slider
            label="Duration (s)"
            value={v.hoverDuration}
            min={0.05}
            max={1.5}
            step={0.01}
            onChange={(hoverDuration) => update({ hoverDuration })}
          />
          <SpringSliders
            spring={v.hoverSpring}
            onChange={(hoverSpring) => update({ hoverSpring })}
          />
          <Graph
            title="Hover"
            from={1}
            to={v.hoverScale}
            duration={v.hoverDuration}
            spring={v.hoverSpring}
          />
        </fieldset>
        <fieldset>
          <legend>2. Mouse down</legend>
          <Slider
            label="Size"
            value={v.pressScale}
            min={0.8}
            max={1}
            step={0.005}
            onChange={(pressScale) => update({ pressScale })}
          />
          <Slider
            label="Duration (s)"
            value={v.pressDuration}
            min={0.05}
            max={1.5}
            step={0.01}
            onChange={(pressDuration) => update({ pressDuration })}
          />
          <SpringSliders
            spring={v.pressSpring}
            onChange={(pressSpring) => update({ pressSpring })}
          />
          <Graph
            title="Mouse down"
            from={restingScale}
            to={v.pressScale}
            duration={v.pressDuration}
            spring={v.pressSpring}
          />
        </fieldset>
        <fieldset>
          <legend>3. Mouse up</legend>
          <Slider
            label="Duration (s)"
            value={v.releaseDuration}
            min={0.05}
            max={1.5}
            step={0.01}
            onChange={(releaseDuration) => update({ releaseDuration })}
          />
          <SpringSliders
            spring={v.releaseSpring}
            onChange={(releaseSpring) => update({ releaseSpring })}
          />
          <Slider
            label="Screen fade (s)"
            value={v.fadeDuration}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(fadeDuration) => update({ fadeDuration })}
          />
          <Graph
            title="Mouse up"
            from={v.pressScale}
            to={restingScale}
            duration={v.releaseDuration}
            spring={v.releaseSpring}
            fadeDuration={v.fadeDuration}
          />
        </fieldset>
      </div>
      <fieldset>
        <legend>Current values</legend>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
          {`Hover: size ${v.hoverScale}, ${v.hoverDuration}s, ${formatSpring(v.hoverSpring)}
Mouse down: size ${v.pressScale}, ${v.pressDuration}s, ${formatSpring(v.pressSpring)}
Mouse up: ${v.releaseDuration}s, ${formatSpring(v.releaseSpring)}
Screen fade: ${v.fadeDuration}s`}
        </pre>
      </fieldset>
    </div>
  );
}

export function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input:not([type=range]), textarea, select"))
  );
}
