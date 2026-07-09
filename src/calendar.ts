import type { CalendarEvent, DigestOptions, ResolvedEvent } from "./types.js";
import { resolveEvents, resolveOptions } from "./events.js";
import { addDays, dateKey, startOfDay, weekdayOf } from "./tz.js";

export interface CalendarDigestOptions extends DigestOptions {
  /** How many days the grid covers, starting today. Default 30. */
  days?: number;
}

export interface CalendarDay {
  /** Calendar date in the display time zone, `YYYY-MM-DD`. */
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  events: ResolvedEvent[];
}

export interface CalendarDigest {
  days: CalendarDay[];
}

/** One entry per day from today, for rendering a mini calendar or agenda. */
export function calendarDigest(events: CalendarEvent[], options?: CalendarDigestOptions): CalendarDigest {
  const opts = resolveOptions(options);
  const tz = opts.timeZone;
  const span = options?.days ?? 30;
  const resolved = resolveEvents(events, tz);

  const days: CalendarDay[] = [];
  let cursor = startOfDay(opts.now, tz);
  for (let i = 0; i < span; i++) {
    const next = addDays(cursor, 1, tz);
    const date = dateKey(cursor, tz);
    const [y, m, d] = date.split("-").map(Number);
    days.push({
      date,
      weekday: weekdayOf(y!, m!, d!),
      events: resolved.filter(
        (e) => e.start.getTime() >= cursor.getTime() && e.start.getTime() < next.getTime(),
      ),
    });
    cursor = next;
  }
  return { days };
}
