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

export const DEFAULT_TIERS: Tier[] = [
  { days: 7, label: "the next 7 days" },
  { days: 30, label: "the next 30 days" },
  { days: 365, label: "the next year" },
];

export interface TieredWindowOptions extends DigestOptions {
  tiers?: Tier[];
}

/**
 * The default "tiered window" view: nested time horizons where closer events
 * get finer granularity — e.g. 3 events in the next 7 days, 5 more in the
 * next 30 days, 26 more in the next year. Events before now are ignored.
 */
export function tieredWindow(events: CalendarEvent[], options?: TieredWindowOptions): TieredWindow {
  const opts = resolveOptions(options);
  const tiers = [...(options?.tiers ?? DEFAULT_TIERS)].sort((a, b) => a.days - b.days);
  const upcoming = resolveEvents(events, opts.timeZone).filter(
    (e) => e.start.getTime() >= opts.now.getTime(),
  );

  const results: TierResult[] = [];
  let cursor = opts.now;
  for (const tier of tiers) {
    const end = addDays(opts.now, tier.days, opts.timeZone);
    const inTier = upcoming.filter(
      (e) => e.start.getTime() >= cursor.getTime() && e.start.getTime() < end.getTime(),
    );
    results.push({
      label: tier.label ?? `the next ${tier.days} days`,
      start: cursor,
      end,
      count: inTier.length,
      events: inTier,
    });
    cursor = end;
  }
  const beyondEvents = upcoming.filter((e) => e.start.getTime() >= cursor.getTime());
  return { tiers: results, beyond: { count: beyondEvents.length, events: beyondEvents } };
}
