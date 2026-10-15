// Vertical sliders to the right of the welcome screen's logo and Get Started
// button, shown with the T panel, that scale each from its normal size. The
// sizes are kept in local storage, and sizeTuningScript applies them before
// the page first appears, so that nothing visibly changes size afterwards.
import { useLayoutEffect, useRef, useState } from "react";

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

function loadSizes() {
  try {
    return parseSizes(localStorage.getItem(storageKey));
  } catch {
    return defaultSizes;
  }
}

const formatPercent = (size: number) => `${Math.round(size * 100)}%`;

// Keeps a slider beside the element it sizes, in page coordinates, and as
// tall as that element, moving it whenever the page's layout changes. It
// stays on screen, over the element if there is no room beside it.
function usePositionBeside(
  selector: string,
  ref: React.RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const target = document.querySelector(selector);
    const slider = ref.current;
    if (!target || !slider) return;
    // The percentage and slider span the element's height, and anything
    // after them, such as the reset button, hangs below it.
    const position = () => {
      const rect = target.getBoundingClientRect();
      const input = slider.querySelector("input");
      const percent = slider.querySelector("span");
      if (input && percent) {
        const height = rect.height - percent.offsetHeight - 4;
        input.style.height = `${Math.max(height, 48)}px`;
      }
      const maxLeft =
        document.documentElement.clientWidth - slider.offsetWidth - 4;
      const left = Math.min(rect.right + 12, maxLeft);
      slider.style.left = `${left + window.scrollX}px`;
      slider.style.top = `${rect.top + window.scrollY}px`;
    };
    position();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(target);
    observer.observe(document.body);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [selector, ref]);
}

function SizeSlider({
  label,
  selector,
  value,
  onChange,
  children,
}: {
  label: string;
  selector: string;
  value: number;
  onChange: (value: number) => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePositionBeside(selector, ref);
  return (
    <div className="size-slider" ref={ref}>
      <span>{formatPercent(value)}</span>
      <input
        type="range"
        aria-label={label}
        min={minSize}
        max={maxSize}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {children}
    </div>
  );
}

export function SizeSliders() {
  const [sizes, setSizes] = useState(loadSizes);

  const update = (next: Sizes) => {
    applySizes(next);
    saveSizes(next);
    setSizes(next);
  };

  return (
    <>
      <SizeSlider
        label="Logo size"
        selector=".welcome h1 img"
        value={sizes.logo}
        onChange={(logo) => update({ ...sizes, logo })}
      />
      <SizeSlider
        label="Button size"
        selector=".get-started"
        value={sizes.button}
        onChange={(button) => update({ ...sizes, button })}
      >
        <button type="button" onClick={() => update(defaultSizes)}>
          Reset to default
        </button>
      </SizeSlider>
    </>
  );
}
