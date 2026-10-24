// The application menu, on the dashboard and the People screen (AD #61 Manage
// People): a button that opens a short list of the app's screens. Each is an
// ordinary link, so it works from the keyboard, and one that leaves a screen
// with unsaved changes first lets that screen save them.
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

const screens = [
  { path: "/dashboard", name: "Projects" },
  { path: "/people", name: "People" },
] as const;

export type MenuScreen = (typeof screens)[number]["path"];

export function AppMenu({
  current,
  onBeforeLeave,
}: {
  current: MenuScreen;
  // Gets the screen ready to be left, false if the person chose to stay.
  onBeforeLeave?: () => Promise<boolean>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A press anywhere outside the menu closes it.
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isOpen]);

  return (
    <nav
      ref={menuRef}
      className="app-menu"
      aria-label="Main"
      // Esc closes the menu, not a project open beside it.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="app-menu-button"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      >
        Menu
      </button>
      {isOpen && (
        <ul id={menuId} className="app-menu-list">
          {screens.map(({ path, name }) => (
            <li key={path}>
              <Link
                to={path}
                aria-current={path === current ? "page" : undefined}
                onClick={async (event) => {
                  // Staying on the screen needs no leave.
                  if (path === current) {
                    event.preventDefault();
                    setIsOpen(false);
                    return;
                  }
                  if (!onBeforeLeave) return;
                  event.preventDefault();
                  if (await onBeforeLeave()) void navigate(path);
                }}
              >
                {name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
