import { resolveOptions } from "./events.js";
import { formatMonthDay, formatTime } from "./format.js";
import type { ShapeDigestOptions } from "./shape.js";
import { shapeDigest } from "./shape.js";
import { dayNumber } from "./tz.js";
import type { CalendarEvent, ResolvedEvent } from "./types.js";

/** Character budgets for common surfaces. */
export type BriefPreset = "watch" | "banner" | "widget" | "spoken" | "display";

const PRESETS: Record<BriefPreset, number> = {
  watch: 40,
  banner: 80,
  widget: 140,
  spoken: 170,
  display: 300,
};

export interface BriefDigestOptions extends ShapeDigestOptions {
  /** Character budget, or a surface preset. Default "widget" (140). */
  budget?: number | BriefPreset;
  /** Clusters with at least this many events narrate as a stretch. Default 3. */
  burstThreshold?: number;
}

export interface BriefFragment {
  kind: "quiet" | "next" | "burst" | "event" | "series" | "more";
  text: string;
  /** The events this fragment accounts for, for drill-down. */
  events: ResolvedEvent[];
}

export interface BriefDigest {
  text: string;
  fragments: BriefFragment[];
  /** The resolved character budget the text was packed into. */
  budget: number;
}

interface Candidate {
  kind: BriefFragment["kind"];
  /** Renderings, most to least verbose; the packer takes the largest that fits. */
  prose: string[];
  compact: string[];
  events: ResolvedEvent[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A calendar summary packed into a fixed character budget. Fragments are
 * prioritized (what's next → busy stretches → one-off events → recurring
 * background) and each degrades to shorter renderings before being dropped.
 * Honesty guarantee: events that don't fit are counted in a trailing
 * "+N" / "and N more" fragment — the summary never hides them silently.
 */
export function briefDigest(events: CalendarEvent[], options?: BriefDigestOptions): BriefDigest {
  const opts = resolveOptions(options);
  const tz = opts.timeZone;
  const budget =
    typeof options?.budget === "number" ? options.budget : PRESETS[options?.budget ?? "widget"];
  const compact = budget <= 80;
  const burstThreshold = options?.burstThreshold ?? 3;
  const horizonDays = options?.days ?? 90;
  const shape = shapeDigest(events, options);
  const todayDay = dayNumber(opts.now, tz);

  const dateOfDay = (day: number) => new Date(day * 86_400_000);
  const dayLabel = (day: number): string => {
    const delta = day - todayDay;
    if (delta === 0) return "today";
    if (delta === 1) return "tomorrow";
    if (delta <= 6) return WEEKDAYS[dateOfDay(day).getUTCDay()]!;
    return formatMonthDay(dateOfDay(day), "UTC");
  };
  const rangeLabel = (firstDay: number, lastDay: number): string => {
    if (lastDay - todayDay <= 6) return `${dayLabel(firstDay)}–${dayLabel(lastDay)}`;
    const a = dateOfDay(firstDay);
    const b = dateOfDay(lastDay);
    if (a.getUTCMonth() === b.getUTCMonth()) return `${formatMonthDay(a, "UTC")}–${b.getUTCDate()}`;
    return `${formatMonthDay(a, "UTC")} – ${formatMonthDay(b, "UTC")}`;
  };
  const imminentMinutes = (e: ResolvedEvent): number | undefined => {
    if (e.allDay) return undefined;
    const mins = Math.round((e.start.getTime() - opts.now.getTime()) / 60_000);
    return mins >= 0 && mins < 90 ? mins : undefined;
  };
  const whenShort = (e: ResolvedEvent): string => {
    const mins = imminentMinutes(e);
    if (mins !== undefined) return `in ${mins} min`;
    const label = dayLabel(dayNumber(e.start, tz));
    return e.allDay ? label : `${label} ${formatTime(e.start, tz).replace(":00 ", " ")}`;
  };
  const whenLong = (e: ResolvedEvent): string => {
    const mins = imminentMinutes(e);
    if (mins !== undefined) return `in ${mins} min`;
    const day = dayNumber(e.start, tz);
    const label = dayLabel(day);
    const prefix = day - todayDay <= 1 ? label : `on ${label}`;
    return e.allDay ? prefix : `${prefix} at ${formatTime(e.start, tz)}`;
  };

  // --- Candidates, in priority order ------------------------------------
  const candidates: Candidate[] = [];
  const totalEvents =
    shape.clusters.reduce((n, c) => n + c.count, 0) +
    shape.background.reduce((n, s) => n + s.events.length, 0);

  if (shape.clusters.length === 0) {
    if (shape.background.length > 0) {
      candidates.push({ kind: "quiet", prose: ["just the usual"], compact: ["Usual only"], events: [] });
    } else {
      candidates.push({
        kind: "quiet",
        prose: [`no events in the next ${horizonDays} days`],
        compact: [`Free ${horizonDays}d`],
        events: [],
      });
    }
  } else if (shape.leadingQuietDays >= 2) {
    const firstDay = dayNumber(shape.clusters[0]!.events[0]!.start, tz);
    candidates.push({
      kind: "quiet",
      prose: [`nothing until ${dayLabel(firstDay)}`],
      compact: [`Quiet til ${dayLabel(firstDay)}`],
      events: [],
    });
  } else {
    const next = shape.nextEvent!;
    const name = next.source.name;
    candidates.push({
      kind: "next",
      prose: [`next up: ${name} ${whenLong(next)}`, `next: ${name} ${whenShort(next)}`],
      compact: [`Next: ${name} ${whenShort(next)}`, `${name} ${whenShort(next)}`],
      events: [next],
    });
  }

  let named = 0;
  for (const cluster of shape.clusters) {
    const firstDay = dayNumber(cluster.events[0]!.start, tz);
    const lastDay = dayNumber(cluster.events[cluster.events.length - 1]!.start, tz);
    if (cluster.count >= burstThreshold) {
      const range = rangeLabel(firstDay, lastDay);
      candidates.push({
        kind: "burst",
        prose: [
          `a busy stretch ${range}: ${cluster.count} events, incl. ${cluster.events[0]!.source.name}`,
          `${cluster.count} events ${range}`,
        ],
        compact: [`${cluster.count} in ${cluster.days}d`],
        events: cluster.events,
      });
    } else {
      for (const e of cluster.events) {
        if (e === shape.nextEvent && candidates[0]!.kind === "next") continue;
        if (named >= 8) break;
        named += 1;
        candidates.push({
          kind: "event",
          prose: [`${e.source.name} ${whenLong(e)}`, `${e.source.name} ${whenShort(e)}`],
          compact: [`${e.source.name} ${whenShort(e)}`, `${e.source.name} ${dayLabel(dayNumber(e.start, tz))}`],
          events: [e],
        });
      }
    }
  }
  for (const series of shape.background) {
    const detail = series.time === undefined ? series.cadence : `${series.cadence} at ${series.time}`;
    candidates.push({
      kind: "series",
      prose: [`${series.name} (${detail})`],
      compact: [`${series.name} ${series.cadence}`],
      events: series.events,
    });
  }

  // --- Packing -----------------------------------------------------------
  const connector = (prev: BriefFragment["kind"] | undefined, kind: BriefFragment["kind"]): string => {
    if (prev === undefined) return "";
    if (compact) return " · ";
    if (kind === "more") return ", and ";
    if (kind === "series") return prev === "quiet" ? ": " : ", plus ";
    if (prev === "quiet") return ", then ";
    return ", ";
  };

  const chosen: Array<{ cand: Candidate; text: string }> = [];
  const lengthOf = (): number =>
    chosen.reduce(
      (len, c, i) =>
        len + connector(i > 0 ? chosen[i - 1]!.cand.kind : undefined, c.cand.kind).length + c.text.length,
      0,
    );
  // Prose reserves one character for the closing period.
  const effective = compact ? budget : budget - 1;

  for (const cand of candidates) {
    const variants = compact ? cand.compact : cand.prose;
    const conn = connector(chosen.length > 0 ? chosen[chosen.length - 1]!.cand.kind : undefined, cand.kind);
    let picked = variants.find((v) => lengthOf() + conn.length + v.length <= effective);
    // The opening always renders, even over a tiny budget — a summary that
    // says nothing is worse than one that runs a little long.
    if (picked === undefined && chosen.length === 0) picked = variants[variants.length - 1]!;
    if (picked !== undefined) chosen.push({ cand, text: picked });
  }

  // Honesty pass: whatever isn't accounted for becomes "+N", shrinking the
  // tail of the summary if that's what it takes to fit.
  const coveredCount = (): number => {
    const set = new Set<ResolvedEvent>();
    for (const c of chosen) for (const e of c.cand.events) set.add(e);
    return set.size;
  };
  const horizonEndLabel = formatMonthDay(dateOfDay(todayDay + horizonDays - 1), "UTC");
  for (;;) {
    const n = totalEvents - coveredCount();
    if (n <= 0) break;
    const more: Candidate = {
      kind: "more",
      prose: [`${n} more by ${horizonEndLabel}`, `${n} more`],
      compact: [`+${n}`],
      events: [],
    };
    const variants = compact ? more.compact : more.prose;
    const conn = connector(chosen[chosen.length - 1]!.cand.kind, "more");
    const picked = variants.find((v) => lengthOf() + conn.length + v.length <= effective);
    if (picked !== undefined) {
      chosen.push({ cand: more, text: picked });
      break;
    }
    if (chosen.length > 1) {
      // Try shrinking the last fragment before sacrificing it entirely.
      const last = chosen[chosen.length - 1]!;
      const lastVariants = compact ? last.cand.compact : last.cand.prose;
      const shorter = lastVariants.slice(lastVariants.indexOf(last.text) + 1);
      let fitted = false;
      for (const v of shorter) {
        last.text = v;
        const fit = variants.find((m) => lengthOf() + conn.length + m.length <= effective);
        if (fit !== undefined) {
          chosen.push({ cand: more, text: fit });
          fitted = true;
          break;
        }
      }
      if (fitted) break;
      chosen.pop();
      continue;
    }
    chosen.push({ cand: more, text: variants[variants.length - 1]! });
    break;
  }

  // --- Assembly ----------------------------------------------------------
  let text = "";
  chosen.forEach((c, i) => {
    text += connector(i > 0 ? chosen[i - 1]!.cand.kind : undefined, c.cand.kind) + c.text;
  });
  if (!compact) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!text.endsWith(".")) text += ".";
  }
  return {
    text,
    fragments: chosen.map((c) => ({ kind: c.cand.kind, text: c.text, events: c.cand.events })),
    budget,
  };
}
