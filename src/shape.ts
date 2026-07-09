import { resolveEvents, resolveOptions } from "./events.js";
import type { SeriesSummary } from "./series.js";
import { summarizeSeries } from "./series.js";
import { addDays, dayNumber, dayNumberToDate, startOfDay } from "./tz.js";
import type { CalendarEvent, DigestOptions, ResolvedEvent } from "./types.js";

export interface ShapeDigestOptions extends DigestOptions {
  /** Horizon in calendar days from today. Default 90. */
  days?: number;
  /**
   * How many consecutive empty days split two clusters apart and qualify
   * as a quiet stretch. Default 2.
   */
  minQuietDays?: number;
  /**
   * Count recurring-series instances when computing the shape. Default
   * false: a daily series makes every day "busy" and masks the real
   * structure, so series are reported separately as `background`.
   */
  includeSeries?: boolean;
}

/** A run of busy days with no gap of minQuietDays or more inside it. */
export interface EventCluster {
  /** First busy day, `YYYY-MM-DD` in the display zone. */
  startDate: string;
  /** Last busy day, inclusive. */
  endDate: string;
  /** Calendar-day span, inclusive. */
  days: number;
  count: number;
  /** Events per day across the span — how frantic the stretch is. */
  intensity: number;
  events: ResolvedEvent[];
}

export interface QuietStretch {
  startDate: string;
  /** Last empty day, inclusive. */
  endDate: string;
  days: number;
}

export interface ShapeDigest {
  horizonStart: Date;
  horizonEnd: Date;
  /** First considered event at or after now, if any. */
  nextEvent?: ResolvedEvent;
  /** Full empty days from today until the first considered event. */
  leadingQuietDays: number;
  clusters: EventCluster[];
  /** Gaps of at least minQuietDays: leading, between clusters, trailing. */
  quietStretches: QuietStretch[];
  /** Recurring series excluded from the shape (empty when includeSeries). */
  background: SeriesSummary[];
}

/**
 * The density profile of the calendar: where the busy stretches are, how
 * intense they are, and where the quiet gaps sit. This is what lets a
 * summary say "quiet until Thursday, then 6 events in 3 days" instead of
 * pretending events arrive uniformly.
 */
export function shapeDigest(events: CalendarEvent[], options?: ShapeDigestOptions): ShapeDigest {
  const opts = resolveOptions(options);
  const tz = opts.timeZone;
  const horizonDays = options?.days ?? 90;
  const minQuietDays = options?.minQuietDays ?? 2;

  const horizonStart = opts.now;
  const horizonEnd = addDays(startOfDay(opts.now, tz), horizonDays, tz);
  const inWindow = resolveEvents(events, tz).filter(
    (e) => e.start.getTime() >= horizonStart.getTime() && e.start.getTime() < horizonEnd.getTime(),
  );

  const { oneOffs, series } = summarizeSeries(inWindow, tz);
  const considered = options?.includeSeries ? inWindow : oneOffs;
  const background = options?.includeSeries ? [] : series;

  const todayDay = dayNumber(opts.now, tz);
  const endDay = todayDay + horizonDays; // exclusive

  const byDay = new Map<number, ResolvedEvent[]>();
  for (const event of considered) {
    const day = dayNumber(event.start, tz);
    const group = byDay.get(day);
    if (group) group.push(event);
    else byDay.set(day, [event]);
  }
  const busyDays = [...byDay.keys()].sort((a, b) => a - b);

  const clusters: EventCluster[] = [];
  const clusterRanges: Array<{ first: number; last: number }> = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const clusterEvents = run.flatMap((d) => byDay.get(d)!);
    const span = last - first + 1;
    clusters.push({
      startDate: dayNumberToDate(first),
      endDate: dayNumberToDate(last),
      days: span,
      count: clusterEvents.length,
      intensity: clusterEvents.length / span,
      events: clusterEvents,
    });
    clusterRanges.push({ first, last });
    run = [];
  };
  for (const day of busyDays) {
    const prev = run[run.length - 1];
    if (prev !== undefined && day - prev - 1 >= minQuietDays) flush();
    run.push(day);
  }
  flush();

  const quietStretches: QuietStretch[] = [];
  const addQuiet = (fromDay: number, toDayExclusive: number) => {
    const days = toDayExclusive - fromDay;
    if (days >= minQuietDays) {
      quietStretches.push({
        startDate: dayNumberToDate(fromDay),
        endDate: dayNumberToDate(toDayExclusive - 1),
        days,
      });
    }
  };
  let cursor = todayDay;
  for (const range of clusterRanges) {
    addQuiet(cursor, range.first);
    cursor = range.last + 1;
  }
  addQuiet(cursor, endDay);

  const digest: ShapeDigest = {
    horizonStart,
    horizonEnd,
    leadingQuietDays: busyDays.length > 0 ? busyDays[0]! - todayDay : horizonDays,
    clusters,
    quietStretches,
    background,
  };
  if (considered.length > 0) digest.nextEvent = considered[0]!;
  return digest;
}
