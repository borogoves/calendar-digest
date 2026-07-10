export type { CalendarEvent, DigestOptions, ResolvedEvent, ResolvedOptions } from "./types.js";
export { resolveEvents, resolveOptions } from "./events.js";
export type { BinName, ResolvedBin, BinnedEvents, BinDigest } from "./bins.js";
export { binEvents, resolveBin } from "./bins.js";
export type { Tier, TierResult, TieredWindow, TieredWindowOptions } from "./tiers.js";
export { tieredWindow, DEFAULT_TIERS } from "./tiers.js";
export type { SeriesSummary, SeriesBreakdown } from "./series.js";
export { summarizeSeries } from "./series.js";
export type { ShapeDigest, ShapeDigestOptions, EventCluster, QuietStretch } from "./shape.js";
export { shapeDigest } from "./shape.js";
export type { BriefDigest, BriefDigestOptions, BriefFragment, BriefPreset } from "./brief.js";
export { briefDigest } from "./brief.js";
export type { PriorityOptions } from "./priority.js";
export { eventPriority } from "./priority.js";
export type { TextDigest, TextDigestOptions, Sentence } from "./text.js";
export { textDigest } from "./text.js";
export type {
  TimelineDigest,
  TimelineDigestOptions,
  TimelineBucket,
  TimelineGranularity,
} from "./timeline.js";
export { timelineDigest } from "./timeline.js";
export type { CalendarDigest, CalendarDigestOptions, CalendarDay } from "./calendar.js";
export { calendarDigest } from "./calendar.js";
export type { SpecificityOptions } from "./format.js";
export { describeEvent, formatTime, formatDay, relativeDuration, vaguePeriod, vaguePeriodShort } from "./format.js";
