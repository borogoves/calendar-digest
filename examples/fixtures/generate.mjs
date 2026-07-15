// Regenerates the fixture JSON files in this directory. Run with:
//   node examples/fixtures/generate.mjs
//
// Each fixture is anchored to a fixed "now" (Thursday, July 9 2026, noon
// Eastern) so the scenario stays reproducible regardless of when you run
// the explorer. Edit here and re-run rather than hand-editing the JSON.
//
// The scenarios are drawn from two operational domains where a deadline
// sneaking up on you has real consequences — bank treasury operations and
// software project management — plus one empty calendar. Each fixture keeps
// a distinct *distribution shape* (quiet-then-crunch, routine-buried,
// overloaded, sparse-with-outlier); the domain supplies the content.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

const ANCHOR = Date.parse("2026-07-09T16:00:00Z"); // Thu, noon EDT
const TZ = "America/New_York";

async function write(name, description, events) {
  const dataset = { description, anchor: iso(ANCHOR), timeZone: TZ, events };
  await writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`wrote ${name}.json (${events.length} events)`);
}

// 1. Nothing on the books at all.
await write(
  "empty",
  "No deadlines in range — the digest still has to say something useful ('No events in the next 90 days' / 'Free 90d').",
  [],
);

// 2. Treasury: five quiet days, then a funding cycle lands all at once.
// Six tasks across three days — the shape that ambushes an operations desk.
await write(
  "quiet-then-crunch",
  "A treasury desk with nothing on the books until next Tuesday, then a funding cycle drops 6 tasks across Tue–Thu. Slide 'now' from 0 to 6 to watch the digest flip from 'quiet, then a crunch' to being inside it.",
  [
    { name: "Pledge collateral — Meridian Mfg #4471", start: iso(Date.parse("2026-07-14T15:00:00Z")), tags: ["collateral"] },
    { name: "Borrowing base cert due — Northgate Retail", start: iso(Date.parse("2026-07-14T18:00:00Z")), tags: ["filing"] },
    { name: "Request overnight advance — FHLB", start: iso(Date.parse("2026-07-15T22:00:00Z")), tags: ["funding"] },
    { name: "Rate reset — Term Loan B", start: iso(Date.parse("2026-07-15T23:00:00Z")), tags: ["funding"] },
    { name: "Wire cutoff — Harbor Point closing", start: iso(Date.parse("2026-07-16T14:00:00Z")), tags: ["funding"] },
    { name: "Treasury committee review", start: iso(Date.parse("2026-07-16T15:00:00Z")) },
  ],
);

// 3. Treasury: the daily grind hides the deadlines that actually matter.
// A daily reconciliation and a weekly report outnumber the real work 18:1.
{
  const events = [];
  for (let i = 0; i < 60; i++) {
    events.push({
      name: "Cash position reconciliation",
      start: iso(ANCHOR + (1 + i) * DAY + 60 * 60_000), // 1pm ET daily
      seriesId: "cash-recon",
    });
  }
  for (let i = 0; i < 12; i++) {
    events.push({
      name: "Pledged collateral report",
      start: iso(Date.parse("2026-07-13T14:00:00Z") + i * 7 * DAY), // Mondays, 10am ET
      seriesId: "collateral-report",
    });
  }
  events.push(
    { name: "Submit FFIEC Call Report", start: iso(Date.parse("2026-07-16T15:00:00Z")), tags: ["filing"] },
    { name: "Loan maturity — Harbor Point #2298", start: iso(Date.parse("2026-07-20T17:00:00Z")), tags: ["funding"] },
    { name: "FHLB advance rollover", start: iso(Date.parse("2026-08-05T12:00:00Z")), tags: ["funding"] },
    { name: "Regulatory exam fieldwork begins", start: iso(Date.parse("2026-09-02T14:00:00Z")), tags: ["audit"] },
  );
  await write(
    "buried-by-routine",
    "72 routine items — a daily cash reconciliation and a weekly collateral report — against 4 real deadlines (Call Report, loan maturity, advance rollover, exam fieldwork). The routine collapses to background so the deadlines stay visible.",
    events,
  );
}

// 4. Project management: release week, 20 ceremonies over 5 days, quiet
// either side. The overloaded shape, where naming events is hopeless and
// only the stretch itself can be described.
{
  const events = [];
  const weekStart = Date.parse("2026-08-03T00:00:00Z"); // Monday
  const perDay = [
    { name: "Build cut", hour: 13 },
    { name: "QA regression pass", hour: 15 },
    { name: "Staging deploy", hour: 18 },
    { name: "Go/no-go checkpoint", hour: 20 },
  ];
  for (let d = 0; d < 5; d++) {
    for (const { name, hour } of perDay) {
      events.push({ name: `${name} (Day ${d + 1})`, start: iso(weekStart + d * DAY + hour * 60 * 60_000) });
    }
  }
  events.push(
    { name: "Design freeze", start: iso(Date.parse("2026-07-13T15:00:00Z")), tags: ["milestone"] },
    { name: "Post-launch retro", start: iso(Date.parse("2026-09-10T23:00:00Z")) },
  );
  await write(
    "release-week",
    "A 20-event release week (Aug 3–7) bracketed by quiet stretches, plus a design freeze and a retro. Tests burst narration and how hard the character budgets get squeezed.",
    events,
  );
}

// 5. Project management: a calm quarter with one external dependency that
// will ruin it. The sparse-with-outlier shape — the case where a critical
// item must break through nearer, lesser noise.
await write(
  "sneaky-dependency",
  "A calm project calendar plus a vendor API sunset 7 weeks out, flagged priority 2 (tags: dependency). Untick 'Respect priority' to watch it get buried behind nearer trivia — that burial is exactly what the priority model exists to prevent. Also carries all-day contributor PTO.",
  [
    { name: "Design review — checkout flow", start: iso(Date.parse("2026-07-15T23:00:00Z")) },
    { name: "Contractor invoice cutoff", start: iso(Date.parse("2026-07-25T14:00:00Z")) },
    { name: "Sprint 14 demo", start: iso(Date.parse("2026-08-05T23:00:00Z")), tags: ["milestone"] },
    { name: "Priya PTO", start: "2026-08-20", tags: ["pto"] },
    { name: "Vendor API v1 sunset — migrate by", start: iso(Date.parse("2026-08-30T13:00:00Z")), priority: 2, tags: ["dependency"] },
    { name: "Beta milestone", start: iso(Date.parse("2026-09-10T23:00:00Z")), tags: ["milestone"] },
    { name: "SOC 2 evidence due", start: iso(Date.parse("2026-09-25T23:00:00Z")), tags: ["audit"] },
  ],
);
