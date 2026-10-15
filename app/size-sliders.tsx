// A panel fixed to the right-hand edge of the window, shown with the T panel,
// with vertical sliders that scale the welcome screen's logo and Get Started
// button from their normal sizes. It stays put as they change size. The
// sizes are kept in local storage, and sizeTuningScript applies them before
// the page first appears, so that nothing visibly changes size afterwards.
import { useEffect, useState } from "react";

type Sizes = { logo: number; button: number };

// 100% is the default size, which app.css sets, so these match its
// fallbacks.
export const defaultSizes: Sizes = { logo: 1, button: 1 };
const minSize = 0.5;
const maxSize = 1.5;

// Sizes were once saved as "abodeo-size-tuning", measured from the sizes
// before Robin's tuned ones, so they are not read.
const storageKey = "abodeo-welcome-sizes";
const styleId = "size-tuning-css";

function buildCss(sizes: Record<keyof Sizes, number | string>) {
  return `:root { --logo-size: ${sizes.logo}; --button-size: ${sizes.button}; }`;
}

// Saved sizes that are not numbers in the slider's range are replaced with
// the defaults.
export function parseSizes(json: string | null): Sizes {
  const sizes = { ...defaultSizes };
  try {
    const parsed = JSON.parse(json ?? "null");
    for (const key of Object.keys(sizes) as (keyof Sizes)[]) {
      const value = parsed?.[key];
      if (typeof value === "number" && value >= minSize && value <= maxSize) {
        sizes[key] = value;
      }
    }
  } catch {
    // Unreadable saved data counts as nothing saved.
  }
  return sizes;
}

// Runs in the page's head, before the page first appears. It checks the
// saved sizes as parseSizes does and fills them into buildCss's CSS.
export const sizeTuningScript = `try{
var s=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})),v=${JSON.stringify(defaultSizes)},k,x;
if(s){
for(k in v){x=s[k];if(typeof x==="number"&&x>=${minSize}&&x<=${maxSize})v[k]=x}
var e=document.createElement("style");e.id=${JSON.stringify(styleId)};
e.textContent=${JSON.stringify(buildCss({ logo: "@logo@", button: "@button@" }))}.replace(/@(\\w+)@/g,function(m,k){return v[k]});
document.head.appendChild(e)}
}catch(e){}`;

// Puts the CSS in a style element in the page's head, the same one that
// sizeTuningScript creates.
function applySizes(sizes: Sizes) {
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.append(style);
  }
  style.textContent = buildCss(sizes);
}

// Saves nothing while both sizes are at their defaults.
function saveSizes(sizes: Sizes) {
  try {
    if (
      sizes.logo === defaultSizes.logo &&
      sizes.button === defaultSizes.button
    ) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(sizes));
    }
  } catch {
    // Without local storage the sizes still apply until the page reloads.
  }
}

// Kept outside the component so that the sliders show the sizes in use
// when T hides and shows them again, even without local storage.
let current: Sizes | null = null;

function readSizes() {
  if (!current) {
    try {
      current = parseSizes(localStorage.getItem(storageKey));
    } catch {
      current = defaultSizes;
    }
  }
  return current;
}

const formatPercent = (size: number) => `${Math.round(size * 100)}%`;

const targets = { logo: ".welcome h1 img", button: ".get-started" };

// The size an element is shown at, which is less than the size set when it
// would be wider than the space available, as its max-width stops it there.
// It compares the element's width with its width without that limit.
function measureShownSize(selector: string, size: number) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return size;
  const shownWidth = element.offsetWidth;
  const maxWidth = element.style.maxWidth;
  element.style.maxWidth = "none";
  const fullWidth = element.offsetWidth;
  element.style.maxWidth = maxWidth;
  return fullWidth ? (size * shownWidth) / fullWidth : size;
}

// Measures again whenever the logo or button changes width, which happens
// when a size or the window changes, or when the page's layout does.
function useShownSizes() {
  const [shown, setShown] = useState<Sizes | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const sizes = readSizes();
      setShown({
        logo: measureShownSize(targets.logo, sizes.logo),
        button: measureShownSize(targets.button, sizes.button),
      });
    });
    for (const selector of Object.values(targets)) {
      const element = document.querySelector(selector);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return shown;
}

function SizeSlider({
  label,
  name,
  value,
  shown,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  shown: number | undefined;
  onChange: (value: number) => void;
}) {
  const isCapped =
    shown !== undefined && Math.round(shown * 100) < Math.round(value * 100);
  return (
    <label className="size-slider">
      <span>{label}</span>
      <span>{formatPercent(value)}</span>
      {/* Takes up its line either way, so that the sliders do not jump. */}
      <span className="size-slider-shown">
        {isCapped ? `(${formatPercent(shown)} here)` : " "}
      </span>
      <input
        type="range"
        aria-label={name}
        min={minSize}
        max={maxSize}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SizeSliders() {
  const [sizes, setSizes] = useState(readSizes);
  const shown = useShownSizes();

  const update = (next: Sizes) => {
    current = next;
    applySizes(next);
    saveSizes(next);
    setSizes(next);
  };

  return (
    <div className="size-sliders">
      <div className="size-sliders-row">
        <SizeSlider
          label="Logo"
          name="Logo size"
          value={sizes.logo}
          shown={shown?.logo}
          onChange={(logo) => update({ ...sizes, logo })}
        />
        <SizeSlider
          label="Button"
          name="Button size"
          value={sizes.button}
          shown={shown?.button}
          onChange={(button) => update({ ...sizes, button })}
        />
      </div>
      <button type="button" onClick={() => update(defaultSizes)}>
        Reset to default
      </button>
    </div>
  );
}
