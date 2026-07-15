import { resolveOptions } from "./events.js";
import {
  formatMonthDay,
  formatTime,
  formatTimeCompact,
  formatWeekdayShort,
  relativeDuration,
  vaguePeriod,
  vaguePeriodShort,
} from "./format.js";
import type { SpecificityOptions } from "./format.js";
import type { PriorityOptions } from "./priority.js";
import { eventPriority } from "./priority.js";
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

export interface BriefDigestOptions extends ShapeDigestOptions, PriorityOptions, SpecificityOptions {
  /** Character budget, or a surface preset. Default "widget" (140). */
  budget?: number | BriefPreset;
  /** Clusters with at least this many events narrate as a stretch. Default 3. */
  burstThreshold?: number;
  /**
   * Events with effective priority at or above this always break through:
   * they are packed before everything except the opening, so they get
   * named even when nearer, lesser events don't fit. Default 2.
   */
  breakThroughAt?: number;
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
  /** Packing order: lower ranks claim budget first. */
  rank: number;
  /** Display order: chronological, regardless of rank. */
  index: number;
  /** Renderings, most to least verbose; the packer takes the largest that fits. */
  prose: string[];
  compact: string[];
  events: ResolvedEvent[];
}

interface Chosen {
  cand: Candidate;
  text: string;
}

const RANK = { opening: 0, breakThrough: 1, normal: 2, series: 3, more: 9 } as const;

/** Shorten to `max` characters, breaking at a word boundary where possible. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut.trimEnd();
  return `${body}…`;
}

/**
 * A calendar summary packed into a fixed character budget. Fragments are
 * packed by priority (opening → break-through events → busy stretches and
 * one-offs → recurring background) but always displayed chronologically.
 * Each fragment degrades to shorter renderings before being dropped, and
 * events that don't fit are counted in a trailing "+N" / "and N more" —
 * the summary never hides them silently.
 */
export function briefDigest(events: CalendarEvent[], options?: BriefDigestOptions): BriefDigest {
  const opts = resolveOptions(options);
  const tz = opts.timeZone;
  const budget =
    typeof options?.budget === "number" ? options.budget : PRESETS[options?.budget ?? "widget"];
  const compact = budget <= 80;
  const burstThreshold = options?.burstThreshold ?? 3;
  const breakThroughAt = options?.breakThroughAt ?? 2;
  const horizonDays = options?.days ?? 90;
  const shape = shapeDigest(events, options);
  const todayDay = dayNumber(opts.now, tz);
  const locale = options?.locale ?? "en-US";
  const hour12 = options?.hour12;
  const forward = (options?.direction ?? "forward") === "forward";

  const dateOfDay = (day: number) => new Date(day * 86_400_000);
  // "on Wed at 2pm" / "in early August" read fine as either past or future
  // (English "on"/"in" aren't tensed), so only the day label itself and the
  // near/far distance thresholds need to flip for backward mode.
  const dayLabel = (day: number): string => {
    const delta = day - todayDay;
    if (delta === 0) return "today";
    if (forward) {
      if (delta === 1) return "tomorrow";
      if (delta <= 6) return formatWeekdayShort(dateOfDay(day), "UTC", locale);
    } else {
      if (delta === -1) return "yesterday";
      if (delta >= -6) return formatWeekdayShort(dateOfDay(day), "UTC", locale);
    }
    return formatMonthDay(dateOfDay(day), "UTC", locale);
  };
  const rangeLabel = (firstDay: number, lastDay: number): string => {
    if (Math.max(Math.abs(firstDay - todayDay), Math.abs(lastDay - todayDay)) <= 6) {
      return `${dayLabel(firstDay)}–${dayLabel(lastDay)}`;
    }
    const a = dateOfDay(firstDay);
    const b = dateOfDay(lastDay);
    if (a.getUTCMonth() === b.getUTCMonth()) return `${formatMonthDay(a, "UTC", locale)}–${b.getUTCDate()}`;
    return `${formatMonthDay(a, "UTC", locale)} – ${formatMonthDay(b, "UTC", locale)}`;
  };
  const imminentMinutes = (e: ResolvedEvent): number | undefined => {
    if (e.allDay) return undefined;
    const mins = Math.round((e.start.getTime() - opts.now.getTime()) / 60_000);
    const signed = forward ? mins : -mins;
    return signed >= 0 && signed < 90 ? signed : undefined;
  };
  const dateBoundaryDays = options?.dateBoundaryDays ?? 7;
  const vagueBoundaryDays = options?.vagueBoundaryDays ?? 30;
  const mode = options?.mode ?? "calendar";
  const priorityOf = (e: ResolvedEvent): number => eventPriority(e, options?.tagPriorities);
  // Relative mode never names a date — it always describes a duration
  // from now instead ("in 2 hours", "in 5 weeks", "3 months ago").
  const relativeGap = (day: number, forceSpecific: boolean): string => {
    const delta = forward ? day - todayDay : todayDay - day;
    if (delta <= 0) return "today";
    if (delta === 1) return forward ? "tomorrow" : "yesterday";
    const duration = relativeDuration(delta * 86_400_000, dateBoundaryDays, vagueBoundaryDays, forceSpecific);
    return forward ? `in ${duration}` : `${duration} ago`;
  };
  // Priority-flagged events skip the coarsening below: flagging something
  // as important is itself a signal its exact timing still matters, no
  // matter how far out it is.
  const whenShort = (e: ResolvedEvent): string => {
    const mins = imminentMinutes(e);
    if (mins !== undefined) return forward ? `in ${mins} min` : `${mins} min ago`;
    const forceSpecific = priorityOf(e) > 0;
    const day = dayNumber(e.start, tz);
    const delta = forward ? day - todayDay : todayDay - day;
    if (mode === "relative") {
      if (e.allDay) return relativeGap(day, forceSpecific);
      const ms = Math.abs(e.start.getTime() - opts.now.getTime());
      const duration = relativeDuration(ms, dateBoundaryDays, vagueBoundaryDays, forceSpecific);
      return forward ? `in ${duration}` : `${duration} ago`;
    }
    if (!forceSpecific && delta >= vagueBoundaryDays) {
      return vaguePeriodShort(dateOfDay(day), "UTC", dateOfDay(todayDay), locale);
    }
    const label = dayLabel(day);
    if (e.allDay || (!forceSpecific && delta >= dateBoundaryDays)) return label;
    return `${label} ${formatTimeCompact(e.start, tz, locale, hour12)}`;
  };
  // `compactTime` keeps the full "on X at Y" sentence structure but uses
  // the compact time form ("2p" not "2:00 PM") — a middle rung between
  // full prose and whenShort's terser "Wed 2p" (which drops "on"/"at"
  // entirely), useful when a fragment needs to shave a few characters
  // without reading as clipped.
  const whenLong = (e: ResolvedEvent, compactTime = false): string => {
    const mins = imminentMinutes(e);
    if (mins !== undefined) return forward ? `in ${mins} min` : `${mins} min ago`;
    const forceSpecific = priorityOf(e) > 0;
    const day = dayNumber(e.start, tz);
    const delta = forward ? day - todayDay : todayDay - day;
    if (mode === "relative") {
      if (e.allDay) return relativeGap(day, forceSpecific);
      const ms = Math.abs(e.start.getTime() - opts.now.getTime());
      const duration = relativeDuration(ms, dateBoundaryDays, vagueBoundaryDays, forceSpecific);
      return forward ? `in ${duration}` : `${duration} ago`;
    }
    if (!forceSpecific && delta >= vagueBoundaryDays) {
      return `in ${vaguePeriod(dateOfDay(day), "UTC", dateOfDay(todayDay), locale)}`;
    }
    const label = dayLabel(day);
    const prefix = Math.abs(day - todayDay) <= 1 ? label : `on ${label}`;
    if (e.allDay || (!forceSpecific && delta >= dateBoundaryDays)) return prefix;
    const time = compactTime
      ? formatTimeCompact(e.start, tz, locale, hour12)
      : formatTime(e.start, tz, locale, hour12);
    return `${prefix} at ${time}`;
  };

  // --- Candidates ---------------------------------------------------------
  const candidates: Candidate[] = [];
  let index = 0;
  const totalEvents =
    shape.clusters.reduce((n, c) => n + c.count, 0) +
    shape.background.reduce((n, s) => n + s.events.length, 0);

  if (shape.clusters.length === 0) {
    if (shape.background.length > 0) {
      candidates.push({
        kind: "quiet", rank: RANK.opening, index: index++,
        prose: ["just the usual"], compact: ["Usual only"], events: [],
      });
    } else {
      candidates.push({
        kind: "quiet", rank: RANK.opening, index: index++,
        prose: [forward ? `no events in the next ${horizonDays} days` : `no events in the last ${horizonDays} days`],
        compact: [`Free ${horizonDays}d`], events: [],
      });
    }
  } else if (shape.leadingQuietDays >= 2) {
    // shape.nextEvent is already the one closest to now — soonest-upcoming
    // forward, most-recent backward — so no separate lookup is needed here.
    const anchorDay = dayNumber(shape.nextEvent!.start, tz);
    if (mode === "relative") {
      const gap = relativeGap(anchorDay, false);
      // "since 3 days ago" double-marks the past tense; a plain duration
      // ("quiet for 3 days") reads better than forcing "since" onto it.
      const duration = forward
        ? gap
        : relativeDuration(shape.leadingQuietDays * 86_400_000, dateBoundaryDays, vagueBoundaryDays, false);
      candidates.push({
        kind: "quiet", rank: RANK.opening, index: index++,
        prose: [forward ? `nothing ${duration}` : `quiet for ${duration}`],
        compact: [forward ? `Quiet ${duration}` : `Quiet for ${duration}`], events: [],
      });
    } else {
      const label = dayLabel(anchorDay);
      candidates.push({
        kind: "quiet", rank: RANK.opening, index: index++,
        // "til" only shortens the forward form; "since" has no shorter
        // synonym worth reaching for.
        prose: forward ? [`nothing until ${label}`, `nothing til ${label}`] : [`nothing since ${label}`],
        compact: [forward ? `Quiet til ${label}` : `Quiet since ${label}`], events: [],
      });
    }
  } else {
    const next = shape.nextEvent!;
    const name = next.source.name;
    candidates.push({
      kind: "next", rank: RANK.opening, index: index++,
      prose: forward
        ? [`next up: ${name} ${whenLong(next)}`, `next: ${name} ${whenLong(next, true)}`, `next: ${name} ${whenShort(next)}`]
        : [`last: ${name} ${whenLong(next)}`, `last: ${name} ${whenLong(next, true)}`, `last: ${name} ${whenShort(next)}`],
      compact: forward
        ? [`Next: ${name} ${whenShort(next)}`, `${name} ${whenShort(next)}`]
        : [`Last: ${name} ${whenShort(next)}`, `${name} ${whenShort(next)}`],
      events: [next],
    });
  }
  const openedWithNext = candidates[0]!.kind === "next";

  const eventCandidate = (e: ResolvedEvent, rank: number): Candidate => {
    const shortForm = whenShort(e);
    // Relative mode's shortest fallback just drops the leading "in " —
    // there's no shorter phrasing that's still recognizably relative.
    const fallback = mode === "relative" ? shortForm.replace(/^in /, "") : dayLabel(dayNumber(e.start, tz));
    const name = e.source.name;
    // Compact-only last resort before the fragment is dropped: keep the
    // *when* intact and clip the name. On a watch, "Vendor API v1… Aug 30"
    // beats both overrunning and saying nothing at all. Deliberately not
    // offered in prose: at those budgets there's room to write properly, a
    // clipped name just reads as broken, and the spoken preset would say
    // the ellipsis out loud.
    const clipped = clip(name, 16);
    return {
      kind: "event", rank, index: index++,
      prose: [`${name} ${whenLong(e)}`, `${name} ${whenLong(e, true)}`, `${name} ${shortForm}`],
      compact: [`${name} ${shortForm}`, `${name} ${fallback}`, `${clipped} ${fallback}`],
      events: [e],
    };
  };

  let named = 0;
  const brokeThrough = new Set<ResolvedEvent>();
  for (const cluster of shape.clusters) {
    const breakers = cluster.events
      .filter((e) => priorityOf(e) >= breakThroughAt && !(openedWithNext && e === shape.nextEvent))
      .sort((a, b) => priorityOf(b) - priorityOf(a) || a.start.getTime() - b.start.getTime());
    for (const e of breakers) {
      brokeThrough.add(e);
      candidates.push(eventCandidate(e, RANK.breakThrough));
    }
    if (cluster.count >= burstThreshold) {
      const firstDay = dayNumber(cluster.events[0]!.start, tz);
      const lastDay = dayNumber(cluster.events[cluster.events.length - 1]!.start, tz);
      const range = rangeLabel(firstDay, lastDay);
      // Headline the weightiest event not already named — by a break-through
      // or by the opening — so no fragment repeats another's event.
      const rest = cluster.events.filter(
        (e) => !brokeThrough.has(e) && !(openedWithNext && e === shape.nextEvent),
      );
      const lead = rest.reduce(
        (best, e) => (priorityOf(e) > priorityOf(best) ? e : best),
        rest[0] ?? cluster.events[0]!,
      );
      candidates.push({
        kind: "burst", rank: RANK.normal, index: index++,
        prose: [
          `a busy stretch ${range}: ${cluster.count} events, incl. ${lead.source.name}`,
          `${cluster.count} events ${range}`,
        ],
        compact: [`${cluster.count} in ${cluster.days}d`],
        events: cluster.events,
      });
    } else {
      for (const e of cluster.events) {
        if (brokeThrough.has(e) || (openedWithNext && e === shape.nextEvent)) continue;
        if (named >= 8) break;
        named += 1;
        candidates.push(eventCandidate(e, RANK.normal));
      }
    }
  }
  for (const series of shape.background) {
    const detail = series.time === undefined ? series.cadence : `${series.cadence} at ${series.time}`;
    candidates.push({
      kind: "series", rank: RANK.series, index: index++,
      prose: [`${series.name} (${detail})`],
      compact: [`${series.name} ${series.cadence}`],
      events: series.events,
    });
  }

  // --- Packing: fill by rank, display by index ----------------------------
  const connector = (prev: BriefFragment["kind"] | undefined, kind: BriefFragment["kind"]): string => {
    if (prev === undefined) return "";
    if (compact) return " · ";
    if (kind === "more") return ", and ";
    if (kind === "series") return prev === "quiet" ? ": " : ", plus ";
    if (prev === "quiet") return ", then ";
    return ", ";
  };
  const assemblyLength = (list: Chosen[]): number =>
    list.reduce(
      (len, c, i) =>
        len + connector(i > 0 ? list[i - 1]!.cand.kind : undefined, c.cand.kind).length + c.text.length,
      0,
    );
  const inserted = (list: Chosen[], entry: Chosen): Chosen[] =>
    [...list, entry].sort((a, b) => a.cand.index - b.cand.index);
  // State the relative-time convention once, rather than repeating "from
  // now" on every event; skipped on compact budgets, where it would eat
  // too much of the little space available.
  const relativePreamble = !compact && mode === "relative" ? "Times relative to now — " : "";
  // Prose reserves one character for the closing period.
  const effective = (compact ? budget : budget - 1) - relativePreamble.length;

  let chosen: Chosen[] = [];
  const packOrder = [...candidates].sort((a, b) => a.rank - b.rank || a.index - b.index);
  for (const cand of packOrder) {
    const variants = compact ? cand.compact : cand.prose;
    let picked = variants.find((v) => assemblyLength(inserted(chosen, { cand, text: v })) <= effective);
    // The budget is a physical constraint — a watch face can't show 56
    // characters, it clips them — so no fragment may overrun it. Priority
    // buys first claim on the space, not permission to exceed it.
    if (picked === undefined && cand.rank === RANK.breakThrough) {
      // ...but a flagged event does outrank the opening. If the two can't
      // coexist, the opening yields: it exists only to guarantee something
      // renders, and a break-through satisfies that. "Vendor API sunset
      // Aug 30" is worth more than "Quiet til Wed".
      const withoutOpening = chosen.filter((c) => c.cand.rank !== RANK.opening);
      if (withoutOpening.length !== chosen.length) {
        const refit = variants.find(
          (v) => assemblyLength(inserted(withoutOpening, { cand, text: v })) <= effective,
        );
        if (refit !== undefined) {
          chosen = withoutOpening;
          picked = refit;
        }
      }
    }
    // Something must render: a summary that says nothing is worse than one
    // that runs a little long.
    if (picked === undefined && chosen.length === 0) picked = variants[variants.length - 1]!;
    if (picked !== undefined) chosen = inserted(chosen, { cand, text: picked });
  }

  // Honesty pass: whatever isn't accounted for becomes "+N", shrinking or
  // sacrificing the least important fragments to make room.
  const coveredCount = (): number => {
    const set = new Set<ResolvedEvent>();
    for (const c of chosen) for (const e of c.cand.events) set.add(e);
    return set.size;
  };
  // The far edge of the horizon, in whichever direction it extends.
  const horizonEdgeLabel = formatMonthDay(
    dateOfDay(todayDay + (forward ? horizonDays - 1 : -horizonDays)),
    "UTC",
    locale,
  );
  for (;;) {
    const n = totalEvents - coveredCount();
    if (n <= 0) break;
    const more: Candidate = {
      kind: "more", rank: RANK.more, index: Number.MAX_SAFE_INTEGER,
      prose: [
        mode === "relative"
          ? `${n} more in the ${forward ? "next" : "last"} ${horizonDays} days`
          : forward
            ? `${n} more by ${horizonEdgeLabel}`
            : `${n} more before ${horizonEdgeLabel}`,
        `${n} more`,
      ],
      compact: [`+${n}`], events: [],
    };
    const variants = compact ? more.compact : more.prose;
    const picked = variants.find((v) => assemblyLength(inserted(chosen, { cand: more, text: v })) <= effective);
    if (picked !== undefined) {
      chosen = inserted(chosen, { cand: more, text: picked });
      break;
    }
    // Break-through fragments are protected, same as the opening: a count
    // is only useful if it doesn't cost us the event that mattered enough
    // to break through in the first place.
    const victims = chosen.filter((c) => c.cand.rank > RANK.breakThrough);
    if (victims.length > 0) {
      const victim = victims.reduce((worst, c) =>
        c.cand.rank > worst.cand.rank ||
        (c.cand.rank === worst.cand.rank && c.cand.index > worst.cand.index)
          ? c
          : worst,
      );
      // Try shrinking the victim before sacrificing it entirely.
      const victimVariants = compact ? victim.cand.compact : victim.cand.prose;
      const shorter = victimVariants.slice(victimVariants.indexOf(victim.text) + 1);
      let fitted = false;
      for (const v of shorter) {
        victim.text = v;
        const fit = variants.find(
          (m) => assemblyLength(inserted(chosen, { cand: more, text: m })) <= effective,
        );
        if (fit !== undefined) {
          chosen = inserted(chosen, { cand: more, text: fit });
          fitted = true;
          break;
        }
      }
      if (fitted) break;
      chosen = chosen.filter((c) => c !== victim);
      continue;
    }
    // Nothing left that can be sacrificed without undoing a protected
    // fragment (the opening or a break-through event) — better to omit
    // the count than to bump a priority event or blow the budget.
    break;
  }

  // --- Assembly ------------------------------------------------------------
  let text = "";
  chosen.forEach((c, i) => {
    text += connector(i > 0 ? chosen[i - 1]!.cand.kind : undefined, c.cand.kind) + c.text;
  });
  if (!compact) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!text.endsWith(".")) text += ".";
  }
  text = relativePreamble + text;
  return {
    text,
    fragments: chosen.map((c) => ({ kind: c.cand.kind, text: c.text, events: c.cand.events })),
    budget,
  };
}
