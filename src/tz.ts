/**
 * Time zone math on top of Intl.DateTimeFormat — no runtime dependencies.
 * All boundaries (start of day/week/month) are computed as wall-clock times
 * in a given IANA zone, then converted back to absolute instants.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock time that `date` reads as in `timeZone`. */
export function wallTime(date: Date, timeZone: string): WallTime {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function offsetAt(date: Date, timeZone: string): number {
  const w = wallTime(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which the given wall-clock time occurs in `timeZone`.
 * Month/day values outside their normal range roll over (Date.UTC semantics),
 * which is how addDays/addMonths cross boundaries safely, including DST.
 */
export function fromWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetAt(new Date(asUtc), timeZone);
  const second = asUtc - offsetAt(new Date(first), timeZone);
  return new Date(second);
}

export function startOfDay(date: Date, timeZone: string): Date {
  const w = wallTime(date, timeZone);
  return fromWallTime(w.year, w.month, w.day, 0, 0, timeZone);
}

export function addDays(date: Date, days: number, timeZone: string): Date {
  const w = wallTime(date, timeZone);
  return fromWallTime(w.year, w.month, w.day + days, w.hour, w.minute, timeZone);
}

export function startOfWeek(date: Date, timeZone: string, weekStartsOn: number): Date {
  const w = wallTime(date, timeZone);
  const diff = (weekdayOf(w.year, w.month, w.day) - weekStartsOn + 7) % 7;
  return fromWallTime(w.year, w.month, w.day - diff, 0, 0, timeZone);
}

export function startOfMonth(date: Date, timeZone: string): Date {
  const w = wallTime(date, timeZone);
  return fromWallTime(w.year, w.month, 1, 0, 0, timeZone);
}

export function addMonths(date: Date, months: number, timeZone: string): Date {
  const w = wallTime(date, timeZone);
  return fromWallTime(w.year, w.month + months, w.day, w.hour, w.minute, timeZone);
}

/** Weekday (0 = Sunday) of a calendar date; independent of time zone. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Days since the epoch of the calendar date `date` falls on in `timeZone`. */
export function dayNumber(date: Date, timeZone: string): number {
  const w = wallTime(date, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day) / 86_400_000;
}

/** The `YYYY-MM-DD` string of a day number. */
export function dayNumberToDate(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** The calendar date (`YYYY-MM-DD`) that `date` falls on in `timeZone`. */
export function dateKey(date: Date, timeZone: string): string {
  const w = wallTime(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(w.year).padStart(4, "0")}-${pad(w.month)}-${pad(w.day)}`;
}
