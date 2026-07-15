import type { Direction } from "./shape.js";
import type { CalendarEvent, DigestOptions, ResolvedEvent } from "./types.js";
import { resolveEvents, resolveOptions } from "./events.js";
import { addDays } from "./tz.js";

export interface Tier {
  /** Calendar days from now that this tier extends to (cumulative). */
  days: number;
  label?: string;
}

export interface TierResult {
  label: string;
  start: Date;
  /** Exclusive. */
  end: Date;
  count: number;
  events: ResolvedEvent[];
}

export interface TieredWindow {
  /** Each tier holds only events not already counted by an earlier tier. */
  tiers: TierResult[];
  /** Events past the last tier. */
  beyond: { count: number; events: ResolvedEvent[] };
}

// No explicit labels: the direction-aware default in tieredWindow generates
// them ("the next 7 days" / "the last 7 days", …), so this set works
// correctly in both directions instead of baking in forward-only text.
export const DEFAULT_TIERS: Tier[] = [{ days: 7 }, { days: 30 }, { days: 365 }];

export interface TieredWindowOptions extends DigestOptions {
  tiers?: Tier[];
  /**
   * Hard cap, in days from now, on the whole window — events beyond it are
   * excluded entirely (not counted anywhere, including `beyond`). Tiers
   * that reach past the cap are clipped to it; tiers already within it are
   * untouched. Unset by default: the tiers themselves define the horizon.
   */
  days?: number;
  /**
   * Default "forward" (tiers count outward into the future: "the next 7
   * days", "the next 30 days"). "backward" counts into the past instead
   * ("the last 7 days", …) and `beyond` becomes events older than the
   * outermost tier. Explicit tier `label`s are used verbatim either way.
   */
  direction?: Direction;
}

/**
 * The default "tiered window" view: nested time horizons where closer events
 * get finer granularity — e.g. 3 events in the next 7 days, 5 more in the
 * next 30 days, 26 more in the next year. Events before now are ignored.
 */
export function tieredWindow(events: CalendarEvent[], options?: TieredWindowOptions): TieredWindow {
  const opts = resolveOptions(options);
  const forward = (options?.direction ?? "forward") === "forward";
  let tiers = [...(options?.tiers ?? DEFAULT_TIERS)].sort((a, b) => a.days - b.days);
  const cap = options?.days;
  if (cap !== undefined) {
    tiers = tiers.filter((t) => t.days <= cap);
    const lastDays = tiers.length > 0 ? tiers[tiers.length - 1]!.days : 0;
    if (lastDays < cap) tiers.push({ days: cap });
  }
  const sign = forward ? 1 : -1;
  // 365 days reads as "a year", forward or back; everything else is
  // mechanical ("the next/last N days").
  const defaultLabel = (days: number): string => {
    if (days === 365) return forward ? "the next year" : "the last year";
    return forward ? `the next ${days} days` : `the last ${days} days`;
  };
  const capEnd = cap === undefined ? undefined : addDays(opts.now, sign * cap, opts.timeZone).getTime();
  const relevant = resolveEvents(events, opts.timeZone).filter((e) => {
    const t = e.start.getTime();
    const pastNow = forward ? t >= opts.now.getTime() : t < opts.now.getTime();
    const withinCap = capEnd === undefined || (forward ? t < capEnd : t >= capEnd);
    return pastNow && withinCap;
  });

  const results: TierResult[] = [];
  let cursor = opts.now;
  for (const tier of tiers) {
    const end = addDays(opts.now, sign * tier.days, opts.timeZone);
    const rangeStart = forward ? cursor : end;
    const rangeEnd = forward ? end : cursor;
    const inTier = relevant.filter(
      (e) => e.start.getTime() >= rangeStart.getTime() && e.start.getTime() < rangeEnd.getTime(),
    );
    results.push({
      label: tier.label ?? defaultLabel(tier.days),
      start: rangeStart,
      end: rangeEnd,
      count: inTier.length,
      events: inTier,
    });
    cursor = end;
  }
  const beyondEvents = relevant.filter((e) =>
    forward ? e.start.getTime() >= cursor.getTime() : e.start.getTime() < cursor.getTime(),
  );
  return { tiers: results, beyond: { count: beyondEvents.length, events: beyondEvents } };
}
