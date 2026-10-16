// A project's due date: a calendar date with no time of day, saved as
// "YYYY-MM-DD". Its weekday is worked out in UTC, so that the same saved date
// shows the same day in every time zone.

export const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// Monday first, as the calendar's weeks start on Monday.
export const weekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// The month strips' colours on the dashboard, following Robin's reference:
// muted blue, pink, red, green, coral pink, light green, golden yellow,
// orange, brown, deep pink, purple and deep blue.
export const monthColours = [
  "#4a78b5",
  "#e88cc0",
  "#d8261c",
  "#2a9a32",
  "#ee8a8a",
  "#7dbd55",
  "#e5b43a",
  "#ec7816",
  "#7a4a1f",
  "#c8245c",
  "#8a4f9f",
  "#1f5ea8",
] as const;

// Month is 0 for January, as in Date.
export type CalendarDate = { year: number; month: number; day: number };

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const { year, month, day } = readCalendarDate(value);
  return formatCalendarDate(toCalendarDate(toUtc(year, month, day))) === value;
}

export function readCalendarDate(date: string): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month: month - 1, day };
}

export function formatCalendarDate({ year, month, day }: CalendarDate) {
  return [
    String(year).padStart(4, "0"),
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

// Today in the browser's own time zone, as the user sees it.
export function findToday(now = new Date()) {
  return formatCalendarDate({
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  });
}

export function addDays(date: string, days: number) {
  const { year, month, day } = readCalendarDate(date);
  return formatCalendarDate(toCalendarDate(toUtc(year, month, day + days)));
}

// The same day of another month, or that month's last day if it is shorter.
export function addMonths(date: string, months: number) {
  const { year, month, day } = readCalendarDate(date);
  const target = toCalendarDate(toUtc(year, month + months, 1));
  const length = toCalendarDate(toUtc(year, month + months + 1, 0)).day;
  return formatCalendarDate({ ...target, day: Math.min(day, length) });
}

export function findWeekday(date: string) {
  const { year, month, day } = readCalendarDate(date);
  return weekdayNames[(new Date(toUtc(year, month, day)).getUTCDay() + 6) % 7];
}

// Such as "Friday 16 October 2026".
export function describeDueDate(date: string) {
  const { year, month, day } = readCalendarDate(date);
  return `${findWeekday(date)} ${day} ${monthNames[month]} ${year}`;
}

// The month's dates in weeks from Monday, with null for the days before the
// 1st and after the last day.
export function listMonthWeeks(year: number, month: number) {
  const first = formatCalendarDate({ year, month, day: 1 });
  const leading = weekdayNames.indexOf(findWeekday(first));
  const length = new Date(toUtc(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(leading).fill(null);
  for (let day = 1; day <= length; day++) {
    cells.push(formatCalendarDate({ year, month, day }));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Unlike Date.UTC, this does not read years 0 to 99 as 1900 to 1999. Days and
// months beyond their range carry over, as in Date.
function toUtc(year: number, month: number, day: number) {
  return new Date(0).setUTCFullYear(year, month, day);
}

function toCalendarDate(time: number): CalendarDate {
  const date = new Date(time);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}
