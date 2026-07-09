import type { CalendarEvent, ResolvedEvent } from "./types.js";
import type { BinName } from "./bins.js";
import { binEvents } from "./bins.js";
import { describeEvent } from "./format.js";
import type { SeriesSummary } from "./series.js";
import { summarizeSeries } from "./series.js";
import type { TieredWindowOptions } from "./tiers.js";
import { tieredWindow } from "./tiers.js";

export interface TextDigestOptions extends TieredWindowOptions {
  /** Hard cap on sentences (the "space budget"). Default 3. */
  maxSentences?: number;
  /**
   * Group by these bins instead of the default tiered window.
   * Events fall into the first matching bin, in this order.
   */
  bins?: BinName[];
  /** Name events individually when a group has at most this many. Default 3. */
  maxNamed?: number;
}

export interface Sentence {
  text: string;
  /** The events this sentence summarizes, for drill-down. */
  events: ResolvedEvent[];
}

export interface TextDigest {
  /** All sentences joined with spaces. */
  text: string;
  sentences: Sentence[];
}

const DAY_MS = 86_400_000;

/**
 * A prose summary sized to fit a small display. Groups events by the given
 * bins, or by the default tiered window, and emits at most `maxSentences`
 * sentences, each carrying its events for drill-down.
 */
export function textDigest(events: CalendarEvent[], options?: TextDigestOptions): TextDigest {
  const maxSentences = options?.maxSentences ?? 3;
  const maxNamed = options?.maxNamed ?? 3;
  const timeZone = options?.timeZone ?? "UTC";

  interface Group {
    phrase: string;
    events: ResolvedEvent[];
    spansDays: boolean;
    more: boolean;
  }
  const groups: Group[] = [];

  if (options?.bins) {
    const { bins } = binEvents(events, options.bins, options);
    for (const { bin, events: binned } of bins) {
      groups.push({
        phrase: bin.label,
        events: binned,
        spansDays: bin.end.getTime() - bin.start.getTime() > 1.5 * DAY_MS,
        more: false,
      });
    }
  } else {
    const window = tieredWindow(events, options);
    let first = true;
    for (const tier of window.tiers) {
      groups.push({
        phrase: `in ${tier.label}`,
        events: tier.events,
        spansDays: tier.end.getTime() - tier.start.getTime() > 1.5 * DAY_MS,
        more: !first && tier.count > 0,
      });
      if (tier.count > 0) first = false;
    }
    groups.push({ phrase: "after that", events: window.beyond.events, spansDays: true, more: !first });
  }

  const sentences: Sentence[] = [];
  for (const group of groups) {
    if (sentences.length >= maxSentences) break;
    if (group.events.length === 0) continue;
    sentences.push({
      text: groupSentence(group.events, group.phrase, group.more, group.spansDays, timeZone, maxNamed),
      events: group.events,
    });
  }

  if (sentences.length === 0) return { text: "No upcoming events.", sentences: [] };
  return { text: sentences.map((s) => s.text).join(" "), sentences };
}

/**
 * One-off events are privileged: they are named first, while recurring
 * series each collapse to a single mention ("call mom (daily at 4:00 PM)").
 * Whatever doesn't fit in `maxNamed` of each kind folds into "and N more".
 */
function groupSentence(
  events: ResolvedEvent[],
  phrase: string,
  more: boolean,
  includeDate: boolean,
  timeZone: string,
  maxNamed: number,
): string {
  const count = events.length;
  const noun = count === 1 ? "event" : "events";
  const countPhrase = more ? `${count} more ${noun}` : `${count} ${noun}`;

  const { oneOffs, series } = summarizeSeries(events, timeZone);
  const namedOneOffs = oneOffs.slice(0, maxNamed);
  const namedSeries = series.slice(0, maxNamed);
  const covered =
    namedOneOffs.length + namedSeries.reduce((n, s) => n + s.events.length, 0);
  const overflow = count - covered;

  const items = [
    ...namedOneOffs.map((e) => describeEvent(e, timeZone, includeDate)),
    ...namedSeries.map((s) => describeSeries(s)),
  ];
  if (overflow > 0) items.push(`${overflow} more`);

  const sentence = `${countPhrase} ${phrase}: ${joinList(items)}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function describeSeries(series: SeriesSummary): string {
  const detail = series.time === undefined ? series.cadence : `${series.cadence} at ${series.time}`;
  return `${series.name} (${detail})`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
