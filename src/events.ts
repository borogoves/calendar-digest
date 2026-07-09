import type { CalendarEvent, DigestOptions, ResolvedEvent, ResolvedOptions } from "./types.js";
import { fromWallTime } from "./tz.js";

export function resolveOptions(options?: DigestOptions): ResolvedOptions {
  const now = options?.now === undefined ? new Date() : toDate(options.now);
  return {
    now,
    timeZone: options?.timeZone ?? "UTC",
    weekStartsOn: options?.weekStartsOn ?? 0,
  };
}

/** Parse and sort events by start time. */
export function resolveEvents(events: CalendarEvent[], timeZone: string): ResolvedEvent[] {
  const resolved = events.map((source) => {
    const start = parseWhen(source.start, timeZone);
    const out: ResolvedEvent = { source, start: start.date, allDay: start.allDay };
    if (source.end !== undefined) out.end = parseWhen(source.end, timeZone).date;
    return out;
  });
  resolved.sort((a, b) => a.start.getTime() - b.start.getTime());
  return resolved;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseWhen(value: Date | string, timeZone: string): { date: Date; allDay: boolean } {
  if (value instanceof Date) return { date: value, allDay: false };
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const date = fromWallTime(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      0,
      0,
      timeZone,
    );
    return { date, allDay: true };
  }
  return { date: toDate(value), allDay: false };
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(value)}`);
  return date;
}
