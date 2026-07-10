// Prints every digest the library offers for a given event set + options.
// Shared by the fixture explorer and the live Google Calendar harness so
// both tools show exactly the same view of the data.
import {
  briefDigest,
  calendarDigest,
  shapeDigest,
  textDigest,
  timelineDigest,
} from "../../dist/index.js";

const PRESETS = ["watch", "banner", "widget", "spoken", "display"];

export function printReport(events, options) {
  const nowLabel = options.now instanceof Date ? options.now.toISOString() : (options.now ?? "now");
  console.log(`${events.length} events | zone ${options.timeZone} | as of ${nowLabel} | horizon ${options.days ?? 90}d\n`);

  console.log("— brief, at each budget —");
  for (const preset of PRESETS) {
    const brief = briefDigest(events, { ...options, budget: preset });
    console.log(`  ${preset.padEnd(8)} [${String(brief.text.length).padStart(3)}/${brief.budget}] ${brief.text}`);
  }

  console.log("\n— text (tiered) —");
  console.log(textDigest(events, options).text);

  console.log("\n— shape —");
  const shape = shapeDigest(events, options);
  console.log(`  next: ${shape.nextEvent?.source.name ?? "nothing"} | leading quiet: ${shape.leadingQuietDays}d`);
  for (const c of shape.clusters) {
    const names = [...new Set(c.events.map((e) => e.source.name))].slice(0, 3).join(", ");
    console.log(`  cluster ${c.startDate} → ${c.endDate}: ${c.count} over ${c.days}d (intensity ${c.intensity.toFixed(1)}) — ${names}`);
  }
  for (const q of shape.quietStretches) console.log(`  quiet   ${q.startDate} → ${q.endDate} (${q.days}d)`);
  for (const s of shape.background) console.log(`  background: ${s.name} (${s.cadence})`);

  console.log("\n— timeline (density) —");
  const timeline = timelineDigest(events, { ...options, days: options.days ?? 90 });
  for (const b of timeline.buckets) {
    const bar = "█".repeat(b.count) || "·";
    console.log(`  ${b.label.padEnd(16)} ${bar} ${b.count || ""}`);
  }

  const calendarDays = Math.min(options.days ?? 90, 14);
  console.log(`\n— next ${calendarDays} day${calendarDays === 1 ? "" : "s"} —`);
  for (const day of calendarDigest(events, { ...options, days: calendarDays }).days) {
    const names = day.events.map((e) => e.source.name).join(", ");
    console.log(`  ${day.date} ${"SMTWTFS"[day.weekday]} ${day.events.length ? `(${day.events.length}) ${names}` : ""}`);
  }
}
