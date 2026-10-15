// A panel for tuning the Get Started button's movement, shown and hidden with
// T on the welcome screen. It overrides the values in app.css with a style
// element, and its starting values match them.
import { useEffect, useState } from "react";

type Curve = { x1: number; y1: number; x2: number; y2: number };

type Values = {
  hoverScale: number;
  hoverDuration: number;
  hoverCurve: Curve;
  pressScale: number;
  pressDuration: number;
  pressCurve: Curve;
  releaseDuration: number;
  releaseCurve: Curve;
  fadeDuration: number;
};

// Kept outside the component so that values survive going to the dashboard
// and back. A page reload resets them.
let savedVisible = false;

let saved: Values = {
  hoverScale: 1.05,
  hoverDuration: 0.2,
  hoverCurve: { x1: 0.3, y1: 3.35, x2: 0.6, y2: 1 },
  pressScale: 0.95,
  pressDuration: 0.2,
  pressCurve: { x1: 0.3, y1: 2.5, x2: 0.6, y2: 1 },
  releaseDuration: 0.3,
  releaseCurve: { x1: 0.3, y1: 2.5, x2: 0.6, y2: 1 },
  fadeDuration: 1,
};

const formatBezier = (c: Curve) =>
  `cubic-bezier(${c.x1}, ${c.y1}, ${c.x2}, ${c.y2})`;

function buildCss(v: Values) {
  return `
@media (prefers-reduced-motion: no-preference) {
  @media (hover: hover) {
    .get-started:hover {
      transform: scale(${v.hoverScale});
      transition-duration: ${v.hoverDuration}s;
      transition-timing-function: ${formatBezier(v.hoverCurve)};
    }
  }
  .get-started:active {
    transform: scale(${v.pressScale});
    transition-duration: ${v.pressDuration}s;
    transition-timing-function: ${formatBezier(v.pressCurve)};
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
      tune-release ${v.releaseDuration}s ${formatBezier(v.releaseCurve)} both,
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
.tuning-panel svg {
  display: block;
  width: 100%;
  height: auto;
}
/* On a phone in landscape the panel goes below the logo and button, not
   beside them. */
@media (orientation: landscape) and (max-height: 500px) {
  .welcome:has(> .tuning-panel) {
    flex-wrap: wrap;
    align-content: center;
  }
  .tuning-panel {
    flex-basis: 100%;
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

// Samples a CSS cubic-bezier as (time fraction, progress) points.
function sampleCurve(c: Curve, steps = 200) {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t;
    const y = 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t;
    points.push([x, y]);
  }
  return points;
}

function Graph({
  title,
  from,
  to,
  duration,
  curve,
  fadeDuration,
}: {
  title: string;
  from: number;
  to: number;
  duration: number;
  curve: Curve;
  fadeDuration?: number;
}) {
  const width = 340;
  const height = 170;
  const pad = 32;
  const maxTime = Math.max(duration, fadeDuration ?? 0, 0.4);
  const points = sampleCurve(curve).map(
    ([x, y]) => [x * duration, from + (to - from) * y] as const,
  );
  const scales = points.map(([, s]) => s);
  const extreme = to > from ? Math.max(...scales) : Math.min(...scales);
  const lo = Math.min(0.85, ...scales, from, to) - 0.01;
  const hi = Math.max(1.15, ...scales, from, to) + 0.01;
  const px = (t: number) => pad + (t / maxTime) * (width - pad - 8);
  const py = (s: number) =>
    height - pad + 8 - ((s - lo) / (hi - lo)) * (height - pad);
  const path = [...points, [maxTime, to] as const]
    .map(
      ([t, s], i) => `${i ? "L" : "M"}${px(t).toFixed(1)},${py(s).toFixed(1)}`,
    )
    .join(" ");
  const ticks = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15].filter(
    (s) => s >= lo && s <= hi,
  );

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
        {fadeDuration !== undefined && (
          <path
            d={sampleCurve({ x1: 0, y1: 0, x2: 0.58, y2: 1 }, 50)
              .map(
                ([x, y], i) =>
                  `${i ? "L" : "M"}${px(x * fadeDuration).toFixed(1)},${(8 + y * (height - pad)).toFixed(1)}`,
              )
              .join(" ")}
            fill="none"
            stroke="#c84"
            strokeDasharray="2 3"
          />
        )}
        <path d={path} fill="none" stroke="#1a1a1a" strokeWidth={2} />
        <text x={pad} y={height - 6} fontSize={10} fill="#888">
          0s
        </text>
        <text x={width - 40} y={height - 6} fontSize={10} fill="#888">
          {maxTime.toFixed(2)}s
        </text>
      </svg>
      {fadeDuration !== undefined && (
        <div style={{ fontSize: 12, color: "#c84" }}>
          Dotted: the screen fading out (opacity, top = fully visible)
        </div>
      )}
    </figure>
  );
}

const formatPercent = (s: number) => `${(s * 100).toFixed(1)}%`;

function Slider({
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

function CurveSliders({
  curve,
  onChange,
}: {
  curve: Curve;
  onChange: (c: Curve) => void;
}) {
  return (
    <>
      <Slider
        label="Bounce (y1)"
        value={curve.y1}
        min={1}
        max={5}
        step={0.05}
        onChange={(y1) => onChange({ ...curve, y1 })}
      />
      <Slider
        label="Attack (x1)"
        value={curve.x1}
        min={0}
        max={1}
        step={0.01}
        onChange={(x1) => onChange({ ...curve, x1 })}
      />
      <Slider
        label="Settle (x2)"
        value={curve.x2}
        min={0}
        max={1}
        step={0.01}
        onChange={(x2) => onChange({ ...curve, x2 })}
      />
    </>
  );
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

  const section: React.CSSProperties = {
    display: "grid",
    gap: 6,
    padding: 12,
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fff",
  };

  return (
    visible && (
      <div className="tuning-panel">
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            gap: 16,
          }}
        >
          <div style={section}>
            <strong>1. Hover</strong>
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
              max={1}
              step={0.01}
              onChange={(hoverDuration) => update({ hoverDuration })}
            />
            <CurveSliders
              curve={v.hoverCurve}
              onChange={(hoverCurve) => update({ hoverCurve })}
            />
            <Graph
              title="Hover"
              from={1}
              to={v.hoverScale}
              duration={v.hoverDuration}
              curve={v.hoverCurve}
            />
          </div>
          <div style={section}>
            <strong>2. Mouse down</strong>
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
              max={1}
              step={0.01}
              onChange={(pressDuration) => update({ pressDuration })}
            />
            <CurveSliders
              curve={v.pressCurve}
              onChange={(pressCurve) => update({ pressCurve })}
            />
            <Graph
              title="Mouse down"
              from={v.hoverScale}
              to={v.pressScale}
              duration={v.pressDuration}
              curve={v.pressCurve}
            />
          </div>
          <div style={section}>
            <strong>3. Mouse up</strong>
            <Slider
              label="Duration (s)"
              value={v.releaseDuration}
              min={0.05}
              max={1}
              step={0.01}
              onChange={(releaseDuration) => update({ releaseDuration })}
            />
            <CurveSliders
              curve={v.releaseCurve}
              onChange={(releaseCurve) => update({ releaseCurve })}
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
              to={v.hoverScale}
              duration={v.releaseDuration}
              curve={v.releaseCurve}
              fadeDuration={v.fadeDuration}
            />
          </div>
        </div>
        <div style={section}>
          <strong>Current values</strong>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
            {`Hover: size ${v.hoverScale}, ${v.hoverDuration}s, ${formatBezier(v.hoverCurve)}
Mouse down: size ${v.pressScale}, ${v.pressDuration}s, ${formatBezier(v.pressCurve)}
Mouse up: ${v.releaseDuration}s, ${formatBezier(v.releaseCurve)}
Screen fade: ${v.fadeDuration}s`}
          </pre>
        </div>
      </div>
    )
  );
}

function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input:not([type=range]), textarea, select"))
  );
}
