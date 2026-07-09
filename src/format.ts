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

/** "Standup at 9:00 AM" or, with the date, "Standup on Tue, Jul 14 at 9:00 AM". */
export function describeEvent(event: ResolvedEvent, timeZone: string, includeDate: boolean): string {
  const name = event.source.name;
  if (event.allDay) {
    return includeDate ? `${name} on ${formatDay(event.start, timeZone)}` : `${name} (all day)`;
  }
  const time = formatTime(event.start, timeZone);
  return includeDate ? `${name} on ${formatDay(event.start, timeZone)} at ${time}` : `${name} at ${time}`;
}
