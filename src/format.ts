import { dayNumber, wallTime } from "./tz.js";
import type { ResolvedEvent } from "./types.js";

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions, kind: string): Intl.DateTimeFormat {
  const key = `${timeZone}|${kind}`;
  let fmt = fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
    fmtCache.set(key, fmt);
  }
  return fmt;
}

// Newer ICU inserts narrow no-break spaces before AM/PM; normalize so output
// is stable across runtimes and safe for constrained displays.
function plain(text: string): string {
  return text.replace(/[  ]/g, " ");
}

/** "9:00 AM" */
export function formatTime(date: Date, timeZone: string): string {
  return plain(formatter(timeZone, { hour: "numeric", minute: "2-digit" }, "time").format(date));
}

/** "Tue, Jul 14" */
export function formatDay(date: Date, timeZone: string): string {
  return plain(formatter(timeZone, { weekday: "short", month: "short", day: "numeric" }, "day").format(date));
}

/** "Jul 14" */
export function formatMonthDay(date: Date, timeZone: string): string {
  return plain(formatter(timeZone, { month: "short", day: "numeric" }, "monthday").format(date));
}

/** "Jul 2026" */
export function formatMonthYear(date: Date, timeZone: string): string {
  return plain(formatter(timeZone, { month: "short", year: "numeric" }, "monthyear").format(date));
}

function vaguePart(date: Date, timeZone: string): "early" | "mid" | "late" {
  const day = wallTime(date, timeZone).day;
  return day <= 10 ? "early" : day <= 20 ? "mid" : "late";
}

function yearSuffix(date: Date, timeZone: string, now: Date): string {
  const year = wallTime(date, timeZone).year;
  return year === wallTime(now, timeZone).year ? "" : ` ${year}`;
}

/** "early August", or "late August 2027" when it's not the current year. */
export function vaguePeriod(date: Date, timeZone: string, now: Date): string {
  const month = plain(formatter(timeZone, { month: "long" }, "month-long").format(date));
  return `${vaguePart(date, timeZone)} ${month}${yearSuffix(date, timeZone, now)}`;
}

/** Compact form of vaguePeriod: "early Aug", or "late Aug 2027". */
export function vaguePeriodShort(date: Date, timeZone: string, now: Date): string {
  const month = plain(formatter(timeZone, { month: "short" }, "month-short").format(date));
  return `${vaguePart(date, timeZone)} ${month}${yearSuffix(date, timeZone, now)}`;
}

export interface SpecificityOptions {
  /** Events at least this many days out show a date instead of a time. Default 7. */
  dateBoundaryDays?: number;
  /** Events at least this many days out show a vague period, not a date. Default 30. */
  vagueBoundaryDays?: number;
  /**
   * "calendar" (default) describes events by date/time ("Thu at 3:00 PM",
   * "Jan 20", "first week of June" — well, "early June"). "relative"
   * describes them by duration from now ("in 2 hours", "in 5 weeks", "in
   * 3 months") instead of ever naming a date.
   */
  mode?: "calendar" | "relative";
}

interface DescribeEventOptions extends SpecificityOptions {
  /**
   * Skip the coarsening and always show the fullest form — used for
   * priority-flagged events, where flagging something as important is
   * itself a signal that its exact timing still matters no matter how far
   * out it is. In "relative" mode this means an exact day count instead of
   * a rounded week/month/year figure.
   */
  forceSpecific?: boolean;
}

/**
 * A relative duration graduated the same way as the calendar-mode
 * distance tiers: minutes/hours close in, whole days up to
 * `dateBoundaryDays`, weeks up to `vagueBoundaryDays`, then months or
 * years. `forceSpecific` pins it to hours/days, skipping the week/month/
 * year rounding — e.g. "in 52 days" instead of "in 2 months".
 */
export function relativeDuration(
  ms: number,
  dateBoundaryDays: number,
  vagueBoundaryDays: number,
  forceSpecific = false,
): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  const days = ms / 86_400_000;
  if (forceSpecific || days < dateBoundaryDays) {
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const wholeDays = Math.round(days);
    return `${wholeDays} day${wholeDays === 1 ? "" : "s"}`;
  }
  if (days < vagueBoundaryDays) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30.44);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.round(days / 365.25);
  return `${years} year${years === 1 ? "" : "s"}`;
}

/**
 * Describes an event, in either of two styles ("calendar" or "relative",
 * see SpecificityOptions.mode), with specificity graduated by distance
 * from `now`: near-term events get full precision (a time, or a duration
 * in hours), medium-distance events get less (a date with no time, or a
 * duration in weeks), and far-off events get less still (a vague period,
 * or a duration in months/years). `includeDate=false` (e.g. inside a
 * "today" bin, where the day is already implied) skips calendar-mode's
 * date entirely and just gives the bare time.
 */
export function describeEvent(
  event: ResolvedEvent,
  timeZone: string,
  now: Date,
  includeDate: boolean,
  options?: DescribeEventOptions,
): string {
  const name = event.source.name;
  const dateBoundaryDays = options?.dateBoundaryDays ?? 7;
  const vagueBoundaryDays = options?.vagueBoundaryDays ?? 30;
  const forceSpecific = options?.forceSpecific ?? false;

  if (options?.mode === "relative") {
    if (event.allDay) {
      const days = dayNumber(event.start, timeZone) - dayNumber(now, timeZone);
      if (days <= 0) return `${name} today`;
      if (days === 1) return `${name} tomorrow`;
      return `${name} in ${relativeDuration(days * 86_400_000, dateBoundaryDays, vagueBoundaryDays, forceSpecific)}`;
    }
    return `${name} in ${relativeDuration(event.start.getTime() - now.getTime(), dateBoundaryDays, vagueBoundaryDays, forceSpecific)}`;
  }

  if (!includeDate) {
    return event.allDay ? `${name} (all day)` : `${name} at ${formatTime(event.start, timeZone)}`;
  }
  if (forceSpecific) {
    return event.allDay
      ? `${name} on ${formatDay(event.start, timeZone)}`
      : `${name} on ${formatDay(event.start, timeZone)} at ${formatTime(event.start, timeZone)}`;
  }
  const delta = dayNumber(event.start, timeZone) - dayNumber(now, timeZone);

  if (delta >= vagueBoundaryDays) return `${name} in ${vaguePeriod(event.start, timeZone, now)}`;
  if (event.allDay) return `${name} on ${formatDay(event.start, timeZone)}`;
  if (delta >= dateBoundaryDays) return `${name} on ${formatDay(event.start, timeZone)}`;
  return `${name} on ${formatDay(event.start, timeZone)} at ${formatTime(event.start, timeZone)}`;
}
