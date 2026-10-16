// A small panel at the bottom left of the screen listing its keyboard
// shortcuts, each key as a keycap followed by what it does. A shortcut that
// applies only some of the time, such as Esc while a project is open, keeps
// its row's space while it is not shown, so that the panel does not change
// size. Part of an action can be marked with the is-current class, which
// underlines it, such as the current presentation on the dashboard. The
// panel shows in every build.
export type Shortcut = {
  key: string;
  action: React.ReactNode;
  isShown?: boolean;
};

export function KeyboardShortcuts({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <aside className="keyboard-shortcuts" aria-label="Keyboard shortcuts">
      <ul>
        {shortcuts.map(({ key, action, isShown = true }) => (
          <li
            key={key}
            style={isShown ? undefined : { visibility: "hidden" }}
          >
            <kbd>{key}</kbd>
            <span>{action}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
