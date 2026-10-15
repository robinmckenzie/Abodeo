// A panel for tuning how the project form's assignees, title field and
// notes arrive as the form appears, shown and hidden with T on the
// dashboard, and fixed to the left of the window. Tuned values are kept in
// local storage and set as CSS properties on the page's root element, which
// app.css uses in place of its defaults.
import { useEffect, useState } from "react";

import { isTextField } from "../keyboard";
import { Slider } from "../tuning-panel";

type Values = { fade: number; gap: number };

// As in app.css.
const defaultValues: Values = { fade: 1.15, gap: 0.07 };

const ranges: Record<keyof Values, [number, number]> = {
  fade: [0, 1.5],
  gap: [0, 0.3],
};

const storageKey = "abodeo-assignee-tuning";

// Saved values that are not numbers in their slider's range are replaced
// with the defaults.
function loadValues(): Values {
  const values = { ...defaultValues };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    for (const key of Object.keys(ranges) as (keyof Values)[]) {
      const value = saved?.[key];
      const [min, max] = ranges[key];
      if (typeof value === "number" && value >= min && value <= max) {
        values[key] = value;
      }
    }
  } catch {
    // Unreadable or unavailable storage counts as nothing saved.
  }
  return values;
}

// Saves nothing while both values are at their defaults.
function saveValues(values: Values) {
  try {
    if (
      values.fade === defaultValues.fade &&
      values.gap === defaultValues.gap
    ) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(values));
    }
  } catch {
    // Without local storage the values still apply until the page reloads.
  }
}

function applyValues(values: Values) {
  const root = document.documentElement.style;
  root.setProperty("--assignee-fade", `${values.fade}s`);
  root.setProperty("--assignee-gap", `${values.gap}s`);
}

// Kept outside the component, so that the panel stays open while moving
// between screens. A reload hides it.
let isVisible = false;

export function AssigneeTuningPanel() {
  // The server has no local storage, but renders nothing here, as the panel
  // starts hidden, so the first render still matches.
  const [values, setValues] = useState(() =>
    typeof window === "undefined" ? defaultValues : loadValues(),
  );
  const [visible, setVisible] = useState(isVisible);

  useEffect(() => {
    applyValues(values);
  }, [values]);

  // T shows and hides the panel. A held key, browser shortcuts and typing
  // into a field are ignored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || isTextField(e.target)) return;
      isVisible = !isVisible;
      setVisible(isVisible);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!visible) return null;

  const update = (next: Values) => {
    saveValues(next);
    setValues(next);
  };

  return (
    <div className="assignee-tuning-panel">
      <fieldset>
        <legend>Form arriving (T)</legend>
        <Slider
          label="Fade (s)"
          value={values.fade}
          min={ranges.fade[0]}
          max={ranges.fade[1]}
          step={0.05}
          onChange={(fade) => update({ ...values, fade })}
        />
        <Slider
          label="Gap (s)"
          value={values.gap}
          min={ranges.gap[0]}
          max={ranges.gap[1]}
          step={0.01}
          onChange={(gap) => update({ ...values, gap })}
        />
        <p>Open a project to see the change.</p>
        <button type="button" onClick={() => update(defaultValues)}>
          Reset to defaults
        </button>
      </fieldset>
    </div>
  );
}
