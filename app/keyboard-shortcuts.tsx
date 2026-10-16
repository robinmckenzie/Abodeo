// A small panel at the bottom left of the screen listing its keyboard
// shortcuts, each key as a keycap followed by what it does. A shortcut that
// applies only some of the time, such as Esc while a project is open, keeps
// its row's space while it is not shown, so that the panel does not change
// size. Part of an action can be marked with the is-current class, which
// underlines it, such as the current presentation on the dashboard. The
// panel shows in every build.
//
// Each keycap is also a button. Clicking it presses its key, for the
// handlers listening on the window, or calls onPress for a key handled
// elsewhere, such as Esc in the project form.
import { useId } from "react";

export type Shortcut = {
  keyboardKeyLabel: string;
  action: React.ReactNode;
  isShown?: boolean;
  onPress?: () => void;
};

export function KeyboardShortcuts({ shortcuts }: { shortcuts: Shortcut[] }) {
  const id = useId();
  return (
    <aside className="keyboard-shortcuts" aria-label="Keyboard shortcuts">
      <ul>
        {shortcuts.map(
          ({ keyboardKeyLabel, action, isShown = true, onPress }) => (
            <li
              key={keyboardKeyLabel}
              style={isShown ? undefined : { visibility: "hidden" }}
            >
              <button
                type="button"
                aria-describedby={`${id}-${keyboardKeyLabel}`}
                onClick={onPress ?? (() => pressKey(keyboardKeyLabel))}
              >
                <kbd>{keyboardKeyLabel}</kbd>
              </button>
              <span id={`${id}-${keyboardKeyLabel}`}>{action}</span>
            </li>
          ),
        )}
      </ul>
    </aside>
  );
}

function pressKey(keyboardKeyLabel: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: keyboardKeyLabel.toLowerCase() }),
  );
}
