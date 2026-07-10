import { formatTime } from "./format.js";
import { dayNumber, wallTime, weekdayOf } from "./tz.js";
import type { ResolvedEvent } from "./types.js";

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** The weekday an event falls on in a zone, 0 = Sunday. */
function weekdayIndex(event: ResolvedEvent, timeZone: string): number {
  const w = wallTime(event.start, timeZone);
  return weekdayOf(w.year, w.month, w.day);
}

/** A recurring series collapsed to one description. */
export interface SeriesSummary {
  seriesId: string;
  name: string;
  /**
   * A human phrase for the rhythm: "daily", "Mondays", "every other
   * Monday", "every weekday", "every N days", "monthly", or "N×" when no
   * regular pattern fits.
   */
  cadence: string;
  /** Wall-clock time shared by every instance, if consistent (e.g. "4:00 PM"). */
  time?: string;
  events: ResolvedEvent[];
}

export interface SeriesBreakdown {
  /** Events with no series, or a series' lone instance in this set. */
  oneOffs: ResolvedEvent[];
  series: SeriesSummary[];
}

/**
 * Split a set of events into one-offs and collapsed recurring series.
 * A series only collapses when it has at least two instances in the set;
 * a lone instance reads better as a plain event.
 */
export function summarizeSeries(events: ResolvedEvent[], timeZone: string): SeriesBreakdown {
  const byId = new Map<string, ResolvedEvent[]>();
  const oneOffs: ResolvedEvent[] = [];
  for (const event of events) {
    const id = event.source.seriesId;
    if (!id) {
      oneOffs.push(event);
      continue;
    }
    const group = byId.get(id);
    if (group) group.push(event);
    else byId.set(id, [event]);
  }

  const series: SeriesSummary[] = [];
  for (const [seriesId, group] of byId) {
    if (group.length < 2) {
      oneOffs.push(...group);
      continue;
    }
    const summary: SeriesSummary = {
      seriesId,
      name: group[0]!.source.name,
      cadence: cadenceOf(group, timeZone),
      events: group,
    };
    const time = sharedTime(group, timeZone);
    if (time !== undefined) summary.time = time;
    series.push(summary);
  }

  oneOffs.sort((a, b) => a.start.getTime() - b.start.getTime());
  series.sort((a, b) => a.events[0]!.start.getTime() - b.events[0]!.start.getTime());
  return { oneOffs, series };
}

function cadenceOf(events: ResolvedEvent[], timeZone: string): string {
  const days = [...new Set(events.map((e) => dayNumber(e.start, timeZone)))].sort((a, b) => a - b);
  const fallback = `${events.length}×`;
  if (days.length < 2) return fallback;
  const gaps = new Set<number>();
  for (let i = 1; i < days.length; i++) gaps.add(days[i]! - days[i - 1]!);

  if ([...gaps].every((g) => g >= 28 && g <= 31)) return "monthly";
  if (gaps.size === 1) {
    const gap = [...gaps][0]!;
    if (gap === 1) return "daily";
    // A weekly (or biweekly) series always lands on the same weekday, and
    // that's the fact a reader actually wants — "Mondays" tells you when,
    // "weekly" doesn't. Name the day rather than the interval.
    const weekday = WEEKDAY_NAMES[weekdayIndex(events[0]!, timeZone)]!;
    if (gap === 7) return `${weekday}s`;
    if (gap === 14) return `every other ${weekday}`;
    return `every ${gap} days`;
  }
  if (isEveryWeekday(events, days, gaps, timeZone)) return "every weekday";
  return fallback;
}

/**
 * True when the series lands on every business day — the Mon–Fri run whose
 * gaps alternate 1 (within a week) and 3 (Fri→Mon). Common for standups and
 * work shifts, and otherwise lost to the bare-count fallback.
 */
function isEveryWeekday(
  events: ResolvedEvent[],
  days: number[],
  gaps: Set<number>,
  timeZone: string,
): boolean {
  if (![...gaps].every((g) => g === 1 || g === 3)) return false;
  const weekdays = new Set(events.map((e) => weekdayIndex(e, timeZone)));
  if ([...weekdays].some((d) => d === 0 || d === 6)) return false; // no weekends
  // Require the covered weekdays to be a contiguous run (Mon–Fri, Mon–Thu,
  // …) so a sparse Thu/Fri/Mon pattern isn't mislabeled.
  const sorted = [...weekdays].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return contiguous && weekdays.size >= 4;
}

function sharedTime(events: ResolvedEvent[], timeZone: string): string | undefined {
  if (events.some((e) => e.allDay)) return undefined;
  const minutes = new Set(
    events.map((e) => {
      const w = wallTime(e.start, timeZone);
      return w.hour * 60 + w.minute;
    }),
  );
  return minutes.size === 1 ? formatTime(events[0]!.start, timeZone) : undefined;
}
