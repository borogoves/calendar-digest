import { dayNumber, wallTime } from "./tz.js";
import type { ResolvedEvent } from "./types.js";

/** Default locale for every formatter below — unchanged output if callers never pass one. */
const DEFAULT_LOCALE = "en-US";

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  kind: string,
  locale = DEFAULT_LOCALE,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${kind}`;
  let fmt = fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    fmtCache.set(key, fmt);
  }
  return fmt;
}

// Newer ICU inserts a narrow no-break space (U+202F) or no-break space
// (U+00A0) before AM/PM; normalize to a plain space so output is stable
// across runtimes and safe for constrained displays.
function plain(text: string): string {
  return text.replace(/[  ]/g, " ");
}

function timeFormatter(timeZone: string, locale: string, hour12: boolean | undefined): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (hour12 !== undefined) opts.hour12 = hour12;
  const kind = hour12 === undefined ? "time" : hour12 ? "time-12" : "time-24";
  return formatter(timeZone, opts, kind, locale);
}

/**
 * "9:00 AM" (locale-dependent — many locales render this as "9:00" or with
 * their own day-period text). `hour12` overrides the locale's own 12/24-hour
 * default when a caller wants one explicitly, regardless of locale.
 */
export function formatTime(date: Date, timeZone: string, locale = DEFAULT_LOCALE, hour12?: boolean): string {
  return plain(timeFormatter(timeZone, locale, hour12).format(date));
}

/**
 * The tightest correct rendering of a time for a character-constrained
 * surface. For a short, Latin-script day period (English "AM"/"PM",
 * Spanish "a. m."/"p. m.", etc.) this glues a lowercase initial straight
 * onto the number — "9a", "9:30p" — and drops ":00" on the hour. Locales
 * with no day period (24-hour clocks, or `hour12: false` forced) or a
 * non-Latin one (e.g. CJK, which already renders in 2 characters) are
 * returned as Intl formats them, since there's no verifiable universal
 * shortening for those scripts.
 */
export function formatTimeCompact(date: Date, timeZone: string, locale = DEFAULT_LOCALE, hour12?: boolean): string {
  const parts = timeFormatter(timeZone, locale, hour12).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  if (hour === undefined) return plain(parts.map((p) => p.value).join(""));

  const time = minute === "00" ? hour : `${hour}:${minute}`;
  if (dayPeriod !== undefined && /^[A-Za-z][A-Za-z.\s]{0,5}$/.test(dayPeriod)) {
    const initial = dayPeriod.replace(/[.\s]/g, "").charAt(0).toLowerCase();
    return `${time}${initial}`;
  }
  return plain(dayPeriod ? `${time} ${dayPeriod}` : time);
}

/** "Tue" */
export function formatWeekdayShort(date: Date, timeZone: string, locale = DEFAULT_LOCALE): string {
  return plain(formatter(timeZone, { weekday: "short" }, "weekday", locale).format(date));
}

/** "Tue, Jul 14" */
export function formatDay(date: Date, timeZone: string, locale = DEFAULT_LOCALE): string {
  return plain(
    formatter(timeZone, { weekday: "short", month: "short", day: "numeric" }, "day", locale).format(date),
  );
}

/** "Jul 14" */
export function formatMonthDay(date: Date, timeZone: string, locale = DEFAULT_LOCALE): string {
  return plain(formatter(timeZone, { month: "short", day: "numeric" }, "monthday", locale).format(date));
}

/** "Jul 2026" */
export function formatMonthYear(date: Date, timeZone: string, locale = DEFAULT_LOCALE): string {
  return plain(formatter(timeZone, { month: "short", year: "numeric" }, "monthyear", locale).format(date));
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
export function vaguePeriod(date: Date, timeZone: string, now: Date, locale = DEFAULT_LOCALE): string {
  const month = plain(formatter(timeZone, { month: "long" }, "month-long", locale).format(date));
  return `${vaguePart(date, timeZone)} ${month}${yearSuffix(date, timeZone, now)}`;
}

/** Compact form of vaguePeriod: "early Aug", or "late Aug 2027". */
export function vaguePeriodShort(date: Date, timeZone: string, now: Date, locale = DEFAULT_LOCALE): string {
  const month = plain(formatter(timeZone, { month: "short" }, "month-short", locale).format(date));
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
  /**
   * BCP 47 locale tag (e.g. "es", "fr-CA", "ja"). Governs every Intl-driven
   * piece of output — weekday/month names, list joining, pluralization —
   * and, for the compact time form, whether a day period like "AM" gets
   * shortened to a glued letter. Default "en-US"; unset behaves exactly as
   * before this option existed.
   */
  locale?: string;
  /**
   * Force 12-hour ("2:00 PM") or 24-hour ("14:00") time, overriding the
   * locale's own default. Unset: the locale decides, same as before this
   * option existed.
   */
  hour12?: boolean;
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
  const locale = options?.locale ?? DEFAULT_LOCALE;
  const hour12 = options?.hour12;

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
    return event.allDay ? `${name} (all day)` : `${name} at ${formatTime(event.start, timeZone, locale, hour12)}`;
  }
  if (forceSpecific) {
    return event.allDay
      ? `${name} on ${formatDay(event.start, timeZone, locale)}`
      : `${name} on ${formatDay(event.start, timeZone, locale)} at ${formatTime(event.start, timeZone, locale, hour12)}`;
  }
  const delta = dayNumber(event.start, timeZone) - dayNumber(now, timeZone);

  if (delta >= vagueBoundaryDays) return `${name} in ${vaguePeriod(event.start, timeZone, now, locale)}`;
  if (event.allDay) return `${name} on ${formatDay(event.start, timeZone, locale)}`;
  if (delta >= dateBoundaryDays) return `${name} on ${formatDay(event.start, timeZone, locale)}`;
  return `${name} on ${formatDay(event.start, timeZone, locale)} at ${formatTime(event.start, timeZone, locale, hour12)}`;
}
