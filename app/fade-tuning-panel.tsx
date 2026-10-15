// A panel for tuning the welcome screen's fade-in, shown and hidden with F.
// Unlike the T panel, it keeps its values in local storage, so that they
// survive the reload that replays the fades. The values in app.css are the
// defaults, and the tuned ones override them with a style element in the
// page's head, which fadeTuningScript adds before the page first appears.
import { useEffect, useSyncExternalStore } from "react";

import { isTextField, Slider } from "./tuning-panel";

type Values = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  logoEnd: number;
  buttonStart: number;
  buttonEnd: number;
};

type Saved = { visible: boolean; values: Values };

const defaultValues: Values = {
  x1: 0.42,
  y1: 0,
  x2: 0.58,
  y2: 1,
  logoEnd: 1,
  buttonStart: 0.5,
  buttonEnd: 1.5,
};

const ranges: Record<keyof Values, [number, number]> = {
  x1: [0, 1],
  y1: [0, 1],
  x2: [0, 1],
  y2: [0, 1],
  logoEnd: [0.1, 3],
  buttonStart: [0, 3],
  buttonEnd: [0.1, 4],
};

const storageKey = "abodeo-fade-tuning";
const styleId = "fade-tuning-css";

type CssValues = Record<keyof Values | "buttonDuration", number | string>;

function formatCurve(v: Pick<CssValues, "x1" | "y1" | "x2" | "y2">) {
  return `cubic-bezier(${v.x1}, ${v.y1}, ${v.x2}, ${v.y2})`;
}

// :root makes the tuned fades win over app.css wherever its styles end up in
// the head, as the dev server adds them after fadeTuningScript's.
function buildFadeCss(v: CssValues) {
  return `
@media (prefers-reduced-motion: no-preference) {
  :root .welcome h1 {
    animation-duration: ${v.logoEnd}s;
    animation-timing-function: ${formatCurve(v)};
  }
  :root .get-started {
    animation-delay: ${v.buttonStart}s;
    animation-duration: ${v.buttonDuration}s;
    animation-timing-function: ${formatCurve(v)};
  }
}`;
}

const panelCss = `
.fade-tuning-panel {
  width: 100%;
  max-width: 1100px;
  margin-bottom: 32px;
  font-size: 14px;
}
.fade-tuning-panel fieldset {
  display: grid;
  gap: 6px;
  min-inline-size: 0;
  margin: 0;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
}
.fade-tuning-panel legend {
  font-weight: 700;
  padding: 0 4px;
}
/* On a phone in landscape the panel goes above the logo and button, which
   stay side by side and shrink to fit, as with the T panel. */
@media (orientation: landscape) and (max-height: 500px) {
  .welcome:has(> .fade-tuning-panel) {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: center;
    align-content: center;
    align-items: center;
    column-gap: 2rem;
  }
  .fade-tuning-panel {
    grid-column: 1 / -1;
  }
}`;

function buildCss(v: Values) {
  const buttonDuration = round(v.buttonEnd - v.buttonStart);
  return buildFadeCss({ ...v, buttonDuration }) + panelCss;
}

// Puts the CSS in a style element in the page's head, the same one that
// fadeTuningScript creates.
function applyCss(css: string) {
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.append(style);
  }
  style.textContent = css;
}

// Saved values outside their slider's range, or not numbers, are replaced
// with the defaults.
function loadSaved(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    const values = { ...defaultValues };
    for (const key of Object.keys(ranges) as (keyof Values)[]) {
      const value = parsed?.values?.[key];
      const [min, max] = ranges[key];
      if (typeof value === "number" && value >= min && value <= max) {
        values[key] = value;
      }
    }
    if (values.buttonEnd <= values.buttonStart) {
      values.buttonStart = defaultValues.buttonStart;
      values.buttonEnd = defaultValues.buttonEnd;
    }
    return { visible: parsed?.visible === true, values };
  } catch {
    return { visible: false, values: defaultValues };
  }
}

// Saves nothing while the panel is closed with the default values, so that
// an untouched welcome screen leaves local storage empty.
function save({ visible, values }: Saved) {
  try {
    const isDefault = (Object.keys(values) as (keyof Values)[]).every(
      (key) => values[key] === defaultValues[key],
    );
    if (!visible && isDefault) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify({ visible, values }));
    }
  } catch {
    // Without local storage the values still apply until the page reloads.
  }
}

// buildFadeCss with a placeholder such as @logoEnd@ in place of each value,
// for fadeTuningScript to fill in.
const fadeCssTemplate = buildFadeCss(
  Object.fromEntries(
    [...Object.keys(ranges), "buttonDuration"].map((key) => [key, `@${key}@`]),
  ) as CssValues,
);

// Runs in the page's head, before the page first appears, so that the fades
// start with the tuned values rather than jumping to them later. It checks
// the saved values as loadSaved does and builds the CSS from them.
export const fadeTuningScript = `try{
var s=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})),d=${JSON.stringify(defaultValues)},v=${JSON.stringify(defaultValues)},r=${JSON.stringify(ranges)},k,x;
if(s&&s.values){
for(k in r){x=s.values[k];if(typeof x==="number"&&x>=r[k][0]&&x<=r[k][1])v[k]=x}
if(v.buttonEnd<=v.buttonStart){v.buttonStart=d.buttonStart;v.buttonEnd=d.buttonEnd}
v.buttonDuration=Math.round((v.buttonEnd-v.buttonStart)*100)/100;
var e=document.createElement("style");e.id=${JSON.stringify(styleId)};
e.textContent=${JSON.stringify(fadeCssTemplate)}.replace(/@(\\w+)@/g,function(m,k){return v[k]})+${JSON.stringify(panelCss)};
document.head.appendChild(e)}
}catch(e){}`;

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// Opacity at a fraction x of a fade's duration, on the cubic Bezier curve.
// The curve's time runs from 0 to 1 without turning back, because x1 and x2
// are between 0 and 1, so it is found by halving the interval.
function calculateFadeProgress(v: Values, x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bezier = (p1: number, p2: number, t: number) =>
    3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    if (bezier(v.x1, v.x2, t) < x) lo = t;
    else hi = t;
  }
  return bezier(v.y1, v.y2, (lo + hi) / 2);
}

function Graph({ values: v }: { values: Values }) {
  const width = 640;
  const height = 200;
  const pad = 36;
  const maxTime = Math.max(v.logoEnd, v.buttonEnd);
  const px = (t: number) => pad + (t / maxTime) * (width - pad - 12);
  const py = (o: number) => height - pad + 8 - o * (height - pad);
  const buildPath = (start: number, end: number) => {
    const points = [`M${px(0)},${py(0)}`];
    for (let i = 0; i <= 200; i++) {
      const t = start + ((end - start) * i) / 200;
      points.push(`L${px(t)},${py(calculateFadeProgress(v, i / 200))}`);
    }
    points.push(`L${px(maxTime)},${py(1)}`);
    return points.join(" ");
  };
  const timeTicks: number[] = [];
  for (let t = 0; t <= maxTime + 1e-9; t += 0.5) timeTicks.push(t);

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          background: "#fff",
          border: "1px solid #ddd",
        }}
      >
        {[0, 0.5, 1].map((o) => (
          <g key={o}>
            <line
              x1={pad}
              x2={width - 12}
              y1={py(o)}
              y2={py(o)}
              stroke="#eee"
            />
            <text x={2} y={py(o) + 4} fontSize={10} fill="#888">
              {o * 100}%
            </text>
          </g>
        ))}
        {timeTicks.map((t) => (
          <text
            key={t}
            x={px(t)}
            y={height - 10}
            fontSize={10}
            fill="#888"
            textAnchor="middle"
          >
            {t}s
          </text>
        ))}
        <path
          d={buildPath(v.buttonStart, v.buttonEnd)}
          fill="none"
          stroke="#c84"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        <path
          d={buildPath(0, v.logoEnd)}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth={2}
        />
      </svg>
      <figcaption style={{ fontSize: 12 }}>
        Opacity over time. Solid: logo.{" "}
        <span style={{ color: "#c84" }}>Dashed: button.</span>
      </figcaption>
    </figure>
  );
}

// The panel's state, read from local storage when first needed in the
// browser. The server has none, so the first render matches the server's.
let current: Saved | null = null;
const listeners = new Set<() => void>();

function readSaved() {
  current ??= loadSaved();
  return current;
}

function setSaved(next: Saved) {
  current = next;
  applyCss(buildCss(next.values));
  save(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function FadeTuningPanel() {
  const saved = useSyncExternalStore(subscribe, readSaved, () => null);

  // Applies the checked values, replacing any CSS from fadeTuningScript, and
  // saves them again so that the next reload can apply them before the page
  // first appears.
  useEffect(() => {
    if (!saved) return;
    applyCss(buildCss(saved.values));
    save(saved);
  }, [saved]);

  // F shows and hides the panel. A held key, browser shortcuts and typing
  // into a text field are ignored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextField(e.target)) return;
      const s = readSaved();
      setSaved({ ...s, visible: !s.visible });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!saved?.visible) return null;
  const v = saved.values;

  // Keeps the button's end after its start, moving the other one if needed.
  const update = (patch: Partial<Values>) => {
    const next = { ...v, ...patch };
    if (next.buttonEnd <= next.buttonStart) {
      if (patch.buttonStart !== undefined) {
        next.buttonEnd = round(next.buttonStart + 0.05);
      } else {
        next.buttonStart = round(Math.max(next.buttonEnd - 0.05, 0));
      }
    }
    setSaved({ ...saved, values: next });
  };

  const slider = (key: keyof Values, label: string, step: number) => (
    <Slider
      label={label}
      value={v[key]}
      min={ranges[key][0]}
      max={ranges[key][1]}
      step={step}
      onChange={(value) => update({ [key]: value })}
    />
  );

  return (
    <div className="fade-tuning-panel">
      <fieldset>
        <legend>Fade-in (F)</legend>
        <Graph values={v} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            columnGap: 24,
            rowGap: 6,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            {slider("x1", "Curve x1", 0.01)}
            {slider("y1", "Curve y1", 0.01)}
            {slider("x2", "Curve x2", 0.01)}
            {slider("y2", "Curve y2", 0.01)}
          </div>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            {slider("logoEnd", "Logo end (s)", 0.05)}
            {slider("buttonStart", "Button start (s)", 0.05)}
            {slider("buttonEnd", "Button end (s)", 0.05)}
          </div>
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
          {`Curve: ${formatCurve(v)}
Logo: 0s to ${v.logoEnd}s. Button: ${v.buttonStart}s to ${v.buttonEnd}s.
Saved in this browser. Reload the page to replay the fades.`}
        </pre>
        <button
          type="button"
          style={{ justifySelf: "start" }}
          onClick={() => setSaved({ ...saved, values: defaultValues })}
        >
          Reset to defaults
        </button>
      </fieldset>
    </div>
  );
}
