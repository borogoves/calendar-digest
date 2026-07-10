// Regenerates the fixture JSON files in this directory. Run with:
//   node examples/fixtures/generate.mjs
// Each fixture is anchored to a fixed "now" (Thursday, July 9 2026, noon
// Eastern) so the scenario stays reproducible regardless of when you
// actually run the explorer. Edit here and re-run rather than hand-editing
// the JSON.
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

// 3. A daily and a weekly series that would bury a handful of one-offs
// if not collapsed to background.
{
  const events = [];
  for (let i = 0; i < 60; i++) {
    events.push({
      name: "Call mom",
      start: iso(ANCHOR + (1 + i) * DAY + 60 * 60_000), // 1pm EDT daily
      seriesId: "mom",
    });
  }
  for (let i = 0; i < 12; i++) {
    events.push({
      name: "Team sync",
      start: iso(Date.parse("2026-07-13T14:00:00Z") + i * 7 * DAY), // Mondays, 10am EDT
      seriesId: "sync",
    });
  }
  events.push(
    { name: "Dentist", start: iso(Date.parse("2026-07-16T15:00:00Z")) },
    { name: "Haircut", start: iso(Date.parse("2026-07-20T17:00:00Z")) },
    { name: "Flight to Denver", start: iso(Date.parse("2026-08-05T12:00:00Z")), tags: ["travel"] },
    { name: "Annual checkup", start: iso(Date.parse("2026-09-02T14:00:00Z")) },
  );
  await write(
    "recurring-heavy",
    "Daily 'Call mom' and weekly 'Team sync' would dominate every summary if counted at face value — they collapse to background so Dentist, Haircut, the flight, and the checkup stay visible.",
    events,
  );
}

// 4. A dense 5-day conference, quiet before and after.
{
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
  await write(
    "overloaded-conference",
    "A 20-event, 5-day conference (Aug 3–7) surrounded by quiet stretches — tests burst narration and how hard the character budgets get squeezed.",
    events,
  );
}

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
