import type { CalendarEvent, DigestOptions, ResolvedEvent, ResolvedOptions } from "./types.js";
import { resolveEvents, resolveOptions } from "./events.js";
import { addDays, addMonths, startOfDay, startOfMonth, startOfWeek } from "./tz.js";

export type BinName =
  | "today"
  | "tomorrow"
  | "restOfWeek"
  | "thisWeek"
  | "nextWeek"
  | "restOfMonth"
  | "thisMonth"
  | "nextMonth";

export interface ResolvedBin {
  name: BinName;
  /** Human phrase used in text digests, e.g. "later this week". */
  label: string;
  start: Date;
  /** Exclusive. */
  end: Date;
}

export interface BinnedEvents {
  bin: ResolvedBin;
  events: ResolvedEvent[];
}

export interface BinDigest {
  bins: BinnedEvents[];
  /** Events that fell outside every requested bin. */
  unbinned: ResolvedEvent[];
}

const LABELS: Record<BinName, string> = {
  today: "today",
  tomorrow: "tomorrow",
  restOfWeek: "later this week",
  thisWeek: "this week",
  nextWeek: "next week",
  restOfMonth: "later this month",
  thisMonth: "this month",
  nextMonth: "next month",
};

/** The concrete [start, end) window a named bin covers, relative to now. */
export function resolveBin(name: BinName, opts: ResolvedOptions): ResolvedBin {
  const { now, timeZone: tz, weekStartsOn } = opts;
  const range = (start: Date, end: Date): ResolvedBin => ({ name, label: LABELS[name], start, end });
  const sod = startOfDay(now, tz);
  switch (name) {
    case "today":
      return range(sod, addDays(sod, 1, tz));
    case "tomorrow":
      return range(addDays(sod, 1, tz), addDays(sod, 2, tz));
    case "thisWeek": {
      const sow = startOfWeek(now, tz, weekStartsOn);
      return range(sow, addDays(sow, 7, tz));
    }
    case "nextWeek": {
      const sow = startOfWeek(now, tz, weekStartsOn);
      return range(addDays(sow, 7, tz), addDays(sow, 14, tz));
    }
    case "restOfWeek": {
      const sow = startOfWeek(now, tz, weekStartsOn);
      return range(now, addDays(sow, 7, tz));
    }
    case "thisMonth": {
      const som = startOfMonth(now, tz);
      return range(som, addMonths(som, 1, tz));
    }
    case "nextMonth": {
      const som = startOfMonth(now, tz);
      return range(addMonths(som, 1, tz), addMonths(som, 2, tz));
    }
    case "restOfMonth": {
      const som = startOfMonth(now, tz);
      return range(now, addMonths(som, 1, tz));
    }
  }
}

/**
 * Assign each event to the FIRST bin (in the order given) whose window
 * contains its start, so overlapping bins like ["today", "thisWeek"]
 * disaggregate cleanly instead of double-counting.
 */
export function binEvents(
  events: CalendarEvent[],
  bins: BinName[],
  options?: DigestOptions,
): BinDigest {
  const opts = resolveOptions(options);
  const resolved = resolveEvents(events, opts.timeZone);
  const groups = bins.map((name) => ({ bin: resolveBin(name, opts), events: [] as ResolvedEvent[] }));
  const unbinned: ResolvedEvent[] = [];
  for (const event of resolved) {
    const t = event.start.getTime();
    const match = groups.find(({ bin }) => t >= bin.start.getTime() && t < bin.end.getTime());
    if (match) match.events.push(event);
    else unbinned.push(event);
  }
  return { bins: groups, unbinned };
}
