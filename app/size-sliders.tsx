// A panel fixed to the right-hand edge of the window, shown with the T panel,
// with vertical sliders that scale the welcome screen's logo and Get Started
// button from their normal sizes. It stays put as they change size. The
// sizes are kept in local storage, and sizeTuningScript applies them before
// the page first appears, so that nothing visibly changes size afterwards.
import { useState } from "react";

type Sizes = { logo: number; button: number };

export const defaultSizes: Sizes = { logo: 1, button: 1 };
const minSize = 0.5;
const maxSize = 1.5;

const storageKey = "abodeo-size-tuning";
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

function SizeSlider({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="size-slider">
      <span>{label}</span>
      <span>{formatPercent(value)}</span>
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
          onChange={(logo) => update({ ...sizes, logo })}
        />
        <SizeSlider
          label="Button"
          name="Button size"
          value={sizes.button}
          onChange={(button) => update({ ...sizes, button })}
        />
      </div>
      <button type="button" onClick={() => update(defaultSizes)}>
        Reset to default
      </button>
    </div>
  );
}
