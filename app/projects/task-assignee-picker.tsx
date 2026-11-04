// Who a task is assigned to, shown on its row, and a list to choose someone
// else from, styled like the project's Assigned to (AD #66 Assign Tasks To
// People). The list opens in the browser's top layer, so that the task list's
// scrolling does not cut it off, even in the floating project window.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import {
  describePerson,
  findAssigneeName,
  findSubtitle,
  isKnownAssignee,
  unassignedName,
  type Person,
} from "./people";
import { AssigneeIcon } from "./project-form";
import { unassignedId } from "./projects";

// The gap between the button and the list, in pixels.
const listGap = 4;

export function TaskAssigneePicker({
  taskId,
  taskTitle,
  assignee,
  people,
  onChoose,
}: {
  taskId: string;
  taskTitle: string;
  assignee: string;
  people: readonly Person[];
  onChoose: (assignee: string) => void;
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Someone no longer in the list shows as Unassigned.
  const assigned = isKnownAssignee(people, assignee) ? assignee : unassignedId;
  const name = findAssigneeName(people, assigned);
  const options: Person[] = [
    { id: unassignedId, name: unassignedName },
    ...people,
  ];

  const close = (isFocusReturned: boolean) => {
    setIsOpen(false);
    if (isFocusReturned) buttonRef.current?.focus();
  };

  const choose = (chosen: string) => {
    close(true);
    if (chosen !== assignee) onChoose(chosen);
  };

  // Shown in the top layer, below the button with its right edges level, or
  // above it if there is no room below. The chosen person is focused, and
  // scrolled to if the list is long.
  useLayoutEffect(() => {
    const list = listRef.current;
    const button = buttonRef.current;
    if (!isOpen || !list || !button) return;
    list.showPopover?.();
    const place = button.getBoundingClientRect();
    const height = list.offsetHeight;
    const isBelow =
      place.bottom + listGap + height <= window.innerHeight ||
      place.top - listGap - height < 0;
    list.style.top = `${isBelow ? place.bottom + listGap : place.top - listGap - height}px`;
    list.style.left = `${Math.max(listGap, place.right - list.offsetWidth)}px`;
    const chosen = list.querySelector<HTMLElement>('[aria-checked="true"]');
    if (chosen) {
      list.scrollTop = chosen.offsetTop - list.clientHeight / 2;
      chosen.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // Closes on a press outside, and when the page or the task list scrolls,
  // which would leave the list behind.
  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !listRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        close(false);
      }
    };
    const closeOnScroll = (event: Event) => {
      if (!listRef.current?.contains(event.target as Node)) close(false);
    };
    const closeOnResize = () => close(false);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [isOpen]);

  // Up and Down, Home and End move between the people. Escape and Tab close
  // the list, back to the button.
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLElement>(
        "[role=menuitemradio]",
      ) ?? []),
    ];
    const from = items.indexOf(document.activeElement as HTMLElement);
    const steps: Partial<Record<string, number>> = {
      ArrowDown: Math.min(from + 1, items.length - 1),
      ArrowUp: Math.max(from - 1, 0),
      Home: 0,
      End: items.length - 1,
    };
    const to = steps[event.key];
    if (to !== undefined) {
      event.preventDefault();
      items[to]?.focus();
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      // Kept from the form, so that Escape does not also close the project.
      event.preventDefault();
      close(true);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={
          assigned === unassignedId
            ? "task-assignee is-unassigned"
            : "task-assignee"
        }
        data-task-assignee={taskId}
        aria-label={`${taskTitle} is assigned to ${name}. Change`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${id}-list` : undefined}
        onClick={() => (isOpen ? close(false) : setIsOpen(true))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || isOpen) return;
          event.preventDefault();
          setIsOpen(true);
        }}
      >
        {name}
      </button>
      {isOpen && (
        <div
          ref={listRef}
          id={`${id}-list`}
          className="task-assignee-list"
          popover="manual"
          role="menu"
          aria-label={`Assign ${taskTitle} to`}
          onKeyDown={moveFocus}
        >
          {options.map((person) => (
            <button
              key={person.id}
              type="button"
              className="assignee-option"
              role="menuitemradio"
              aria-checked={assigned === person.id}
              tabIndex={-1}
              onClick={() => choose(person.id)}
            >
              <AssigneeIcon isSelected={assigned === person.id} />
              <span>
                {describePerson(person)}
                {findSubtitle(person) && (
                  <span className="assignee-job-title">
                    {findSubtitle(person)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
