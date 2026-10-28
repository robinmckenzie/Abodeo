// A month calendar for choosing a project's due date, or clearing it. Days are
// circles, as the assignees are, and the month arrows sit in the same thin
// circles. The days are one stop for Tab, and the arrow keys move between
// them, into the next or previous month where needed. Every day button is
// named dueDate, so that the form remembers focus in the calendar; only the
// one Tab reaches is focusable from code. The day the arrow keys move from is
// reported and can be given back, so that switching
// presentation keeps the calendar where it was. Moves past the dates that
// can be saved, years 0 to 9999, are ignored.
import { useEffect, useId, useRef, useState } from "react";

import { ArrowIcon } from "../ui/icons";

import {
  addDays,
  addMonths,
  describeDueDate,
  findToday,
  isCalendarDate,
  listMonthWeeks,
  monthNames,
  readCalendarDate,
  weekdayNames,
} from "./due-date";

const arrowKeySteps: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

export function DueDatePicker({
  value,
  onChange,
  startDate = null,
  onActiveDateChange,
  className,
  style,
}: {
  value: string | null;
  onChange: (dueDate: string | null) => void;
  // The day to start from instead of the due date or today.
  startDate?: string | null;
  onActiveDateChange?: (date: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const [today] = useState(findToday);
  // The day the arrow keys move from, which sets the month shown.
  const [activeDate, setActiveDate] = useState(startDate ?? value ?? today);
  const daysRef = useRef<HTMLDivElement>(null);
  const isMovingFocusRef = useRef(false);

  const { year, month } = readCalendarDate(activeDate);

  // Reported from the start too, as clearing the due date keeps the day.
  useEffect(() => {
    onActiveDateChange?.(activeDate);
  });

  const moveTo = (date: string) => {
    if (!isCalendarDate(date)) return false;
    setActiveDate(date);
    return true;
  };
  const weeks = listMonthWeeks(year, month);

  // Focus follows the arrow keys into a newly shown month.
  useEffect(() => {
    if (!isMovingFocusRef.current) return;
    isMovingFocusRef.current = false;
    daysRef.current
      ?.querySelector<HTMLElement>('[tabindex="0"]')
      ?.focus({ preventScroll: true });
  });

  return (
    <fieldset
      className={["due-date-picker", className].filter(Boolean).join(" ")}
      style={style}
    >
      <legend>Due date</legend>
      <div className="due-date-month">
        <MonthButton
          direction="previous"
          onClick={() => moveTo(addMonths(activeDate, -1))}
        />
        <span id={`${id}-month`} aria-live="polite">
          {monthNames[month]} {year}
        </span>
        <MonthButton
          direction="next"
          onClick={() => moveTo(addMonths(activeDate, 1))}
        />
      </div>
      <div className="due-date-weekdays" aria-hidden="true">
        {weekdayNames.map((name) => (
          <span key={name}>{name[0]}</span>
        ))}
      </div>
      <div
        ref={daysRef}
        className="due-date-days"
        role="group"
        aria-labelledby={`${id}-month`}
        onKeyDown={(event) => {
          const step = arrowKeySteps[event.key];
          if (step === undefined) return;
          event.preventDefault();
          if (moveTo(addDays(activeDate, step))) {
            isMovingFocusRef.current = true;
          }
        }}
      >
        {weeks.flat().map((date, index) =>
          date === null ? (
            <span key={`blank-${index}`} />
          ) : (
            <button
              key={date}
              type="button"
              name="dueDate"
              className={date === today ? "is-today" : undefined}
              tabIndex={date === activeDate ? 0 : -1}
              aria-label={describeDueDate(date)}
              aria-pressed={date === value}
              aria-current={date === today ? "date" : undefined}
              onClick={() => {
                moveTo(date);
                onChange(date);
              }}
            >
              {readCalendarDate(date).day}
            </button>
          ),
        )}
      </div>
      {/* Level with the heading, at the right edge, where it takes no room
          of its own, so that its coming and going does not change the height
          of the form's left column. */}
      {value !== null && (
        <button
          type="button"
          name="dueDate-clear"
          className="button-secondary button-small due-date-clear"
          onClick={() => {
            onChange(null);
            isMovingFocusRef.current = true;
          }}
        >
          Clear
        </button>
      )}
    </fieldset>
  );
}

// The assignee icon's thin circle and three-line arrow, pointing left or
// right.
function MonthButton({
  direction,
  onClick,
}: {
  direction: "previous" | "next";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      name={`dueDate-${direction}`}
      className={`icon-button due-date-${direction}`}
      aria-label={direction === "previous" ? "Previous month" : "Next month"}
      onClick={onClick}
    >
      <ArrowIcon direction={direction === "previous" ? "left" : "right"} />
    </button>
  );
}
