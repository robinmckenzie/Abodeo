// The demo seed's dates that move with the day (AD #138 Demo Entry And Seed).
// Saving the seed turns a date into a rule: the nth date with a weekday whose
// start is still ahead. A reset works the rule out again from the new
// visitor's today, so a seeded brunch is always on a Sunday to come.
import type { CalendarEvent } from "../calendar/google-calendar.server";

// weekday is 0 for Sunday to 6 for Saturday. nth counts from 1.
export type DateRule = { weekday: number; nth: number };

// A date or start time that has already passed, so that it cannot be saved.
export class SeedPastDateError extends Error {
  readonly code = "seed_past_date";
}

const dayMs = 24 * 60 * 60 * 1000;
// A date counts until the end of its day (UTC), whether it is a due date or
// an all-day event.
const wholeDay = "T00:00:00Z";

type EventTime = CalendarEvent["start"];

function weekdayOf(date: string) {
  return new Date(`${date}${wholeDay}`).getUTCDay();
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}${wholeDay}`) + days * dayMs)
    .toISOString()
    .slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}${wholeDay}`) - Date.parse(`${from}${wholeDay}`)) / dayMs,
  );
}

const dateTimePattern =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/;

function parseDateTime(value: string) {
  const match = dateTimePattern.exec(value);
  if (!match) throw new Error("Unreadable event time");
  return { date: match[1], time: match[2], offset: match[3] };
}

// When the date's occurrence stops counting as ahead.
type StartsAt = (date: string) => number;

function dueDateStartsAt(date: string) {
  return Date.parse(`${date}${wholeDay}`) + dayMs - 1;
}

function eventStartsAt(start: EventTime): { date: string; startsAt: StartsAt } {
  if ("date" in start) return { date: start.date, startsAt: dueDateStartsAt };
  const { date, time, offset = "Z" } = parseDateTime(start.dateTime);
  return {
    date,
    startsAt: (other) => Date.parse(`${other}T${time}${offset}`),
  };
}

// The dates with the weekday that are still ahead, soonest first, starting
// from the day before today in UTC (a start with an offset can be a day
// either side of it).
function* datesAhead(now: number, weekday: number, startsAt: StartsAt) {
  let date = addDays(new Date(now).toISOString().slice(0, 10), -1);
  for (;;) {
    if (weekdayOf(date) === weekday && startsAt(date) > now) yield date;
    date = addDays(date, 1);
  }
}

function ruleFor(date: string, startsAt: StartsAt, now: number): DateRule {
  if (startsAt(date) <= now) throw new SeedPastDateError();
  const weekday = weekdayOf(date);
  let nth = 0;
  for (const ahead of datesAhead(now, weekday, startsAt)) {
    nth += 1;
    if (ahead === date) return { weekday, nth };
  }
  throw new SeedPastDateError();
}

function dateFor({ weekday, nth }: DateRule, startsAt: StartsAt, now: number) {
  let count = 0;
  for (const ahead of datesAhead(now, weekday, startsAt)) {
    count += 1;
    if (count === nth) return ahead;
  }
  throw new Error("unreachable");
}

// A project's due date ("YYYY-MM-DD") as a rule. Throws SeedPastDateError if
// the day has gone.
export function ruleForDate(date: string, now: number) {
  return ruleFor(date, dueDateStartsAt, now);
}

export function dateFromRule(rule: DateRule, now: number) {
  return dateFor(rule, dueDateStartsAt, now);
}

// An appointment's start as a rule. Throws SeedPastDateError if the start has
// passed.
export function ruleForEvent(event: CalendarEvent, now: number) {
  const { date, startsAt } = eventStartsAt(event.start);
  return ruleFor(date, startsAt, now);
}

// The event moved to the date the rule gives now, keeping its time of day and
// length. A time with a zone name is sent as wall time and zone, so that a
// change of clocks cannot move it.
export function moveEvent(
  event: CalendarEvent,
  rule: DateRule,
  now: number,
): CalendarEvent {
  const { date, startsAt } = eventStartsAt(event.start);
  const days = daysBetween(date, dateFor(rule, startsAt, now));
  const shift = (time: EventTime): EventTime => {
    if ("date" in time) return { date: addDays(time.date, days) };
    const {
      date: day,
      time: clock,
      offset = "",
    } = parseDateTime(time.dateTime);
    const moved = addDays(day, days);
    if (time.timeZone) {
      return { dateTime: `${moved}T${clock}`, timeZone: time.timeZone };
    }
    return { dateTime: `${moved}T${clock}${offset}` };
  };
  return { ...event, start: shift(event.start), end: shift(event.end) };
}
