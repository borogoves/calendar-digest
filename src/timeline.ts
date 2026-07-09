import type { CalendarEvent, DigestOptions, ResolvedEvent } from "./types.js";
import { resolveEvents, resolveOptions } from "./events.js";
import { formatMonthDay, formatMonthYear } from "./format.js";
import { addDays, addMonths, startOfDay, startOfMonth } from "./tz.js";

export type TimelineGranularity = "day" | "week" | "month";

export interface TimelineDigestOptions extends DigestOptions {
  /** How far ahead the timeline reaches, in calendar days. Default 90. */
  days?: number;
  /** Bucket size; defaults by span (≤31 days → day, ≤180 → week, else month). */
  granularity?: TimelineGranularity;
}

export interface TimelineBucket {
  start: Date;
  /** Exclusive. */
  end: Date;
  label: string;
  count: number;
  events: ResolvedEvent[];
}

export interface TimelineDigest {
  start: Date;
  end: Date;
  granularity: TimelineGranularity;
  buckets: TimelineBucket[];
  /** Largest bucket count, for scaling a density display. */
  maxCount: number;
}

/**
 * Near-term density view: fixed buckets from the start of today, each with
 * its event count and events, ready to render as a density strip or chart.
 */
export function timelineDigest(events: CalendarEvent[], options?: TimelineDigestOptions): TimelineDigest {
  const opts = resolveOptions(options);
  const tz = opts.timeZone;
  const days = options?.days ?? 90;
  const granularity =
    options?.granularity ?? (days <= 31 ? "day" : days <= 180 ? "week" : "month");

  const start = startOfDay(opts.now, tz);
  const end = addDays(start, days, tz);
  const resolved = resolveEvents(events, tz);

  const buckets: TimelineBucket[] = [];
  let cursor = start;
  while (cursor.getTime() < end.getTime()) {
    let next: Date;
    let label: string;
    if (granularity === "day") {
      next = addDays(cursor, 1, tz);
      label = formatMonthDay(cursor, tz);
    } else if (granularity === "week") {
      next = addDays(cursor, 7, tz);
      const clipped = next.getTime() < end.getTime() ? next : end;
      label = `${formatMonthDay(cursor, tz)} – ${formatMonthDay(addDays(clipped, -1, tz), tz)}`;
    } else {
      next = addMonths(startOfMonth(cursor, tz), 1, tz);
      label = formatMonthYear(cursor, tz);
    }
    const bucketEnd = next.getTime() < end.getTime() ? next : end;
    const inBucket = resolved.filter(
      (e) => e.start.getTime() >= cursor.getTime() && e.start.getTime() < bucketEnd.getTime(),
    );
    buckets.push({ start: cursor, end: bucketEnd, label, count: inBucket.length, events: inBucket });
    cursor = bucketEnd;
  }

  const maxCount = buckets.reduce((max, b) => Math.max(max, b.count), 0);
  return { start, end, granularity, buckets, maxCount };
}
