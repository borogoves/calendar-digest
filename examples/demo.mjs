// Run every digest against a JSON file of Google Calendar events.
// Usage: node examples/demo.mjs <events.json> [timeZone]
// The JSON may be a raw Google Calendar API/MCP response ({ events: [...] }
// or { items: [...] }) or a plain array of CalendarEvent objects.
import { readFileSync } from "node:fs";
import {
  binEvents,
  calendarDigest,
  shapeDigest,
  textDigest,
  tieredWindow,
  timelineDigest,
} from "../dist/index.js";

const [path, timeZone = "UTC"] = process.argv.slice(2);
if (!path) {
  console.error("Usage: node examples/demo.mjs <events.json> [timeZone]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, "utf8"));
const items = Array.isArray(raw) ? raw : (raw.events ?? raw.items ?? []);

// Map Google Calendar events to CalendarEvent. All-day events arrive with a
// `date` (sometimes serialized as midnight-UTC ISO); keep just the calendar
// date so the library anchors them in the display zone.
// Recurring instances share the ID prefix before "_<timestamp>"; use it as
// the seriesId (the API's recurringEventId, when present, works the same).
const seriesIdOf = (e) =>
  e.recurringEventId ?? /^(.+)_\d{8}(?:T\d{6}Z?)?$/.exec(e.id ?? "")?.[1];

const events = items
  .filter((e) => e.status !== "cancelled" && (e.start?.date || e.start?.dateTime))
  .map((e) => ({
    id: e.id,
    name: e.summary ?? "(untitled)",
    start: e.start.date ? e.start.date.slice(0, 10) : e.start.dateTime,
    ...(e.end?.dateTime ? { end: e.end.dateTime } : {}),
    ...(e.htmlLink ? { link: e.htmlLink } : {}),
    ...(seriesIdOf(e) ? { seriesId: seriesIdOf(e) } : {}),
    tags: [e.eventType ?? "default"],
  }));

const options = { timeZone };
console.log(`${events.length} events | display zone: ${timeZone}\n`);

console.log("— textDigest (default tiered window, 3 sentences) —");
console.log(textDigest(events, options).text);

console.log("\n— textDigest (bins: today / tomorrow / restOfWeek / nextWeek) —");
console.log(textDigest(events, { ...options, bins: ["today", "tomorrow", "restOfWeek", "nextWeek"], maxSentences: 4 }).text);

console.log("\n— tieredWindow —");
const window = tieredWindow(events, options);
for (const tier of window.tiers) console.log(`  ${tier.count} in ${tier.label}`);
console.log(`  ${window.beyond.count} beyond`);

console.log("\n— timelineDigest (90 days, weekly density) —");
const timeline = timelineDigest(events, { ...options, days: 90 });
for (const bucket of timeline.buckets) {
  const bar = "█".repeat(bucket.count) || "·";
  console.log(`  ${bucket.label.padEnd(16)} ${bar} ${bucket.count || ""}`);
}

console.log("\n— calendarDigest (next 14 days) —");
for (const day of calendarDigest(events, { ...options, days: 14 }).days) {
  const names = day.events.map((e) => e.source.name).join(", ");
  console.log(`  ${day.date} ${"SMTWTFS"[day.weekday]} ${day.events.length ? `(${day.events.length}) ${names}` : ""}`);
}

console.log("\n— shapeDigest (90 days; recurring series as background) —");
const shape = shapeDigest(events, { ...options, days: 90 });
console.log(`  next: ${shape.nextEvent?.source.name ?? "nothing"} | leading quiet: ${shape.leadingQuietDays} day(s)`);
for (const c of shape.clusters) {
  const names = [...new Set(c.events.map((e) => e.source.name))].slice(0, 3).join(", ");
  console.log(`  cluster ${c.startDate} → ${c.endDate}: ${c.count} over ${c.days}d (intensity ${c.intensity.toFixed(1)}) — ${names}`);
}
for (const q of shape.quietStretches) console.log(`  quiet   ${q.startDate} → ${q.endDate} (${q.days}d)`);
for (const s of shape.background) console.log(`  background: ${s.name} (${s.cadence})`);

console.log("\n— drill-down: events behind the first tiered sentence —");
const digest = textDigest(events, options);
for (const e of digest.sentences[0]?.events ?? []) {
  console.log(`  ${e.source.name} — ${e.start.toISOString()}${e.source.link ? `\n    ${e.source.link}` : ""}`);
}
