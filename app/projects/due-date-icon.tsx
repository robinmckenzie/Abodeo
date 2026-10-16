// A project's due date on the dashboard, as a spiral-bound calendar page,
// after Robin's reference: the full weekday above a large date number, and a
// strip in the month's own colour with its name. Screen readers hear the date
// in the bar's name instead.
import {
  findWeekday,
  monthColours,
  monthNames,
  readCalendarDate,
} from "./due-date";

const ringCount = 6;

export function DueDateIcon({ dueDate }: { dueDate: string }) {
  const { month, day } = readCalendarDate(dueDate);
  return (
    <span
      className="due-date-icon"
      style={{ "--month-colour": monthColours[month] } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg className="due-date-icon-rings" viewBox="0 0 72 8">
        {Array.from({ length: ringCount }, (_, index) => {
          const x = 8 + (index * 56) / (ringCount - 1);
          return (
            <g key={index}>
              <circle className="due-date-icon-hole" cx={x} cy="6" r="1.4" />
              <path d={`M${x} 6.2V1.2`} />
            </g>
          );
        })}
      </svg>
      <span className="due-date-icon-weekday">{findWeekday(dueDate)}</span>
      <span className="due-date-icon-day">{day}</span>
      <span className="due-date-icon-month">{monthNames[month]}</span>
    </span>
  );
}
