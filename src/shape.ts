import { resolveEvents, resolveOptions } from "./events.js";
import type { SeriesSummary } from "./series.js";
import { summarizeSeries } from "./series.js";
import { addDays, dayNumber, dayNumberToDate, startOfDay } from "./tz.js";
import type { CalendarEvent, DigestOptions, ResolvedEvent } from "./types.js";

/**
 * "forward": the horizon runs from now to now+days ("what's coming up").
 * "backward": from now-days to now ("what did I miss"). Shared by every
 * digest that has a notion of "closest to now" or nested time tiers.
 */
export type Direction = "forward" | "backward";

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
  /**
   * Default "forward". In "backward" mode, `nextEvent`/`leadingQuietDays`
   * describe what happened most recently instead of what's coming up.
   * Clustering and quiet-stretch detection are identical either way; only
   * which end of the window "now" sits at changes.
   */
  direction?: Direction;
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
  /**
   * The considered event closest to now: soonest-upcoming in forward mode,
   * most-recent in backward mode.
   */
  nextEvent?: ResolvedEvent;
  /**
   * Full empty days between now and `nextEvent` — from now until it, in
   * forward mode; from it until now, in backward mode.
   */
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
  const direction = options?.direction ?? "forward";
  const forward = direction === "forward";

  const todayStart = startOfDay(opts.now, tz);
  const horizonStart = forward ? opts.now : addDays(todayStart, -horizonDays, tz);
  const horizonEnd = forward ? addDays(todayStart, horizonDays, tz) : opts.now;
  const inWindow = resolveEvents(events, tz).filter(
    (e) => e.start.getTime() >= horizonStart.getTime() && e.start.getTime() < horizonEnd.getTime(),
  );

  const { oneOffs, series } = summarizeSeries(inWindow, tz);
  const considered = options?.includeSeries ? inWindow : oneOffs;
  const background = options?.includeSeries ? [] : series;

  const todayDay = dayNumber(opts.now, tz);
  // The clustering below only needs to know which end of the day-range
  // "now" sits at — everything else about how clusters form is identical
  // in either direction.
  const walkStart = forward ? todayDay : todayDay - horizonDays;
  const walkEnd = forward ? todayDay + horizonDays : todayDay; // exclusive

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
  let cursor = walkStart;
  for (const range of clusterRanges) {
    addQuiet(cursor, range.first);
    cursor = range.last + 1;
  }
  addQuiet(cursor, walkEnd);

  // The event/day nearest "now" sits at the small end of busyDays in
  // forward mode (all days are >= todayDay) and the large end in backward
  // mode (all days are <= todayDay).
  const nearestDay = busyDays.length > 0 ? (forward ? busyDays[0]! : busyDays[busyDays.length - 1]!) : undefined;

  const digest: ShapeDigest = {
    horizonStart,
    horizonEnd,
    leadingQuietDays: nearestDay !== undefined ? Math.abs(nearestDay - todayDay) : horizonDays,
    clusters,
    quietStretches,
    background,
  };
  if (considered.length > 0) {
    digest.nextEvent = forward ? considered[0]! : considered[considered.length - 1]!;
  }
  return digest;
}
