// Regenerates the fixture JSON files in this directory. Run with:
//   node examples/fixtures/generate.mjs
//
// Each fixture is anchored to a fixed "now" (Thursday, July 9 2026, noon
// Eastern) so the scenario stays reproducible regardless of when you run
// the explorer. Edit here and re-run rather than hand-editing the JSON.
//
// Two sets of scenarios, paired by the distribution *shape* they
// demonstrate rather than domain: an everyday personal calendar (mixed
// personal + work), a quiet week then a pile-up, routine tasks burying the
// real ones, an overloaded stretch, and a sparse calendar with one critical
// outlier — each shown once as an ordinary personal calendar and once in an
// operational domain where a missed deadline has real consequences (bank
// treasury operations, project management). Plus one empty calendar.
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

// ============================== Personal ==================================

// 1. Nothing on the calendar at all.
await write(
  "empty",
  "No events anywhere in range — tests the empty-horizon copy ('No events in the next 90 days' / 'Free 90d').",
  [],
);

// 2. Five quiet days, then six events packed into three days.
await write(
  "quiet-then-burst",
  "Nothing until next Tuesday, then 6 events across Tue–Thu. Try dayOffset 0 vs 6 to see the shape flip from 'quiet, then a burst' to being inside the burst.",
  [
    { name: "Dentist", start: iso(Date.parse("2026-07-14T15:00:00Z")) },
    { name: "Board meeting", start: iso(Date.parse("2026-07-14T18:00:00Z")) },
    { name: "Recital", start: iso(Date.parse("2026-07-15T22:00:00Z")) },
    { name: "Party", start: iso(Date.parse("2026-07-15T23:00:00Z")) },
    { name: "Hike", start: iso(Date.parse("2026-07-16T14:00:00Z")) },
    { name: "Brunch", start: iso(Date.parse("2026-07-16T15:00:00Z")) },
  ],
);

// 3. An everyday calendar: two recurring series (one personal, one work)
// that would swamp every summary if counted at face value, plus a real mix
// of personal errands, family, social, and work one-offs threaded through.
{
  const events = [];
  for (let i = 0; i < 60; i++) {
    events.push({
      name: "Call mom",
      start: iso(ANCHOR + (1 + i) * DAY + 60 * 60_000), // 1pm EDT daily
      seriesId: "mom",
      tags: ["family"],
    });
  }
  for (let i = 0; i < 12; i++) {
    events.push({
      name: "Team sync",
      start: iso(Date.parse("2026-07-13T14:00:00Z") + i * 7 * DAY), // Mondays, 10am EDT
      seriesId: "sync",
      tags: ["work"],
    });
  }
  for (let i = 0; i < 6; i++) {
    events.push({
      name: "1:1 with manager",
      start: iso(Date.parse("2026-07-15T19:00:00Z") + i * 14 * DAY), // every other Wed, 3pm EDT
      seriesId: "oneonone",
      tags: ["work"],
    });
  }
  events.push(
    { name: "Dentist", start: iso(Date.parse("2026-07-16T15:00:00Z")) },
    { name: "Mia's soccer game", start: iso(Date.parse("2026-07-18T14:00:00Z")), tags: ["family"] },
    { name: "Haircut", start: iso(Date.parse("2026-07-20T17:00:00Z")) },
    { name: "Dinner with the Kwans", start: iso(Date.parse("2026-07-25T23:00:00Z")), tags: ["social"] },
    { name: "Q3 planning kickoff", start: iso(Date.parse("2026-07-27T13:00:00Z")), tags: ["work"] },
    { name: "Flight to Denver", start: iso(Date.parse("2026-08-05T12:00:00Z")), tags: ["travel"] },
    { name: "Client call — Acme renewal", start: iso(Date.parse("2026-08-12T15:00:00Z")), tags: ["work"] },
    { name: "Car inspection", start: iso(Date.parse("2026-08-14T13:00:00Z")) },
    { name: "Performance review", start: iso(Date.parse("2026-08-26T18:00:00Z")), tags: ["work"] },
    { name: "Weekend trip — Asheville", start: "2026-09-05", tags: ["travel"] },
    { name: "Annual checkup", start: iso(Date.parse("2026-09-02T14:00:00Z")) },
  );
  await write(
    "recurring-heavy",
    "A real mixed calendar: daily 'Call mom' and weekly 'Team sync' would dominate every summary at face value — they collapse to background, along with a new biweekly '1:1 with manager' (a good look at the 'every other Wednesday' cadence naming) — so the dentist, a kid's soccer game, dinner plans, a flight, and work deadlines all stay visible and interleaved.",
    events,
  );
}

// 4. A dense 5-day conference, quiet before and after.
await write(
  "overloaded-conference",
  "A 20-event, 5-day conference (Aug 3–7) surrounded by quiet stretches — tests burst narration and how hard the character budgets get squeezed.",
  (() => {
    const events = [];
    const confStart = Date.parse("2026-08-03T00:00:00Z"); // Monday
    const dayEvents = [
      { name: "Keynote", hour: 13 },
      { name: "Workshop A", hour: 15 },
      { name: "Workshop B", hour: 18 },
      { name: "Sponsor demo", hour: 20 },
    ];
    for (let d = 0; d < 5; d++) {
      for (const { name, hour } of dayEvents) {
        events.push({ name: `${name} (Day ${d + 1})`, start: iso(confStart + d * DAY + hour * 60 * 60_000) });
      }
    }
    events.push(
      { name: "Dentist", start: iso(Date.parse("2026-07-13T15:00:00Z")) },
      { name: "Concert", start: iso(Date.parse("2026-09-10T23:00:00Z")) },
    );
    return events;
  })(),
);

// 5. Sparse, ordinary events, plus one far-out high-priority flight.
await write(
  "critical-outlier",
  "An ordinary sparse calendar, plus a flight 7 weeks out flagged priority:2 (tags: travel). Run with tagPriorities:{travel:2} to see it break through nearer, lesser events at watch size instead of being buried past a '+N'.",
  [
    { name: "Dinner with Sam", start: iso(Date.parse("2026-07-15T23:00:00Z")) },
    { name: "Car service", start: iso(Date.parse("2026-07-25T14:00:00Z")) },
    { name: "Book club", start: iso(Date.parse("2026-08-05T23:00:00Z")) },
    { name: "Flight to Tokyo", start: iso(Date.parse("2026-08-30T13:00:00Z")), priority: 2, tags: ["travel"] },
    { name: "Haircut", start: iso(Date.parse("2026-08-20T17:00:00Z")) },
    { name: "Dinner party", start: iso(Date.parse("2026-09-10T23:00:00Z")) },
    { name: "Movie night", start: iso(Date.parse("2026-09-25T23:00:00Z")) },
  ],
);

// ============================= Operational =================================
// Same five shapes, in domains where a missed deadline has real consequences.

// 2'. Treasury: five quiet days, then a funding cycle lands all at once.
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

// 3'. Treasury: the daily grind hides the deadlines that actually matter.
await write(
  "buried-by-routine",
  "72 routine items — a daily cash reconciliation and a weekly collateral report — against 4 real deadlines (Call Report, loan maturity, advance rollover, exam fieldwork). The routine collapses to background so the deadlines stay visible.",
  (() => {
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
    return events;
  })(),
);

// 4'. Project management: release week, 20 ceremonies over 5 days.
await write(
  "release-week",
  "A 20-event release week (Aug 3–7) bracketed by quiet stretches, plus a design freeze and a retro. Tests burst narration and how hard the character budgets get squeezed.",
  (() => {
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
    return events;
  })(),
);

// 5'. Project management: a calm quarter with one external dependency that
// will ruin it.
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
