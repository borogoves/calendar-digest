# calendar-digest

**Responsive summarization for calendar data.** Give it a list of events and a space budget — a watch face, a phone widget, a spoken sentence, a full display — and it returns the right-sized summary for that space, not a truncated version of the same one.

**[▶ Try the live demo](https://claude.ai/code/artifact/64c7fb1a-abfe-4dac-9b5d-53fea590f3a7)** — drag "now" through a treasury desk's funding cycle or a project's release week and watch four devices re-summarize the same events at once, out loud included.
No build step: it's also a single self-contained file at [`examples/web/demo.html`](examples/web/demo.html) — clone the repo and open it directly in a browser.

```
npm install github:borogoves/calendar-digest   # not yet published to npm
```

```js
import { briefDigest } from "calendar-digest";

const events = [
  { name: "Pledge collateral — Meridian Mfg", start: "2026-07-14T15:00:00Z" },
  { name: "Board meeting", start: "2026-07-14T18:00:00Z" },
  { name: "Rate reset", start: "2026-07-15T22:00:00Z" },
];

briefDigest(events, { timeZone: "America/New_York", budget: "watch" }).text;
// "Quiet til Tue · 3 in 2d"

briefDigest(events, { timeZone: "America/New_York", budget: "display" }).text;
// "Nothing until Tue, then a busy stretch Tue–Wed: 3 events, incl. Pledge collateral — Meridian Mfg."
```

Same events, same call, two different summaries — sized to fit where they're going.

## Why this exists

Deadlines sneak up on people when the only place they're recorded is a calendar nobody's looking at. A treasury desk that doesn't notice a funding cycle landing until it's three days out; a project where a vendor dependency's expiration is one line in a 90-day list. The fix isn't a bigger screen — it's a summary that tells you what matters *in the space you actually have*.

That space varies by an order of magnitude: a watch complication gets ~40 characters, a smart display gets 300, a voice assistant gets nothing visual at all. Most calendar tooling doesn't treat that as a first-class problem — it either renders a full grid (fine on a desktop, useless on a watch) or truncates a string (which cuts mid-sentence and can silently drop the one event that mattered).

|                | Renders a UI | Groups events by time | Sizes output to a space budget | Prioritizes what matters |
| -------------- | :----------: | :--------------------: | :-----------------------------: | :-----------------------: |
| FullCalendar, react-big-calendar, Schedule-X | ✅ | – | – | – |
| date-fns, Day.js, `Intl.RelativeTimeFormat` | – | single date only | – | – |
| `group-by-time`, `groupbytime` | – | ✅ (fixed intervals) | – | – |
| **calendar-digest** | – (headless) | ✅ (relative + tiered) | ✅ | ✅ |

The closest prior art is academic, not a library: ["Responsive text summarization"](https://luis.leiva.name/web/docs/papers/rts-ipl18-preprint.pdf) (Leiva, 2018) proposed sizing a summary to the requesting device rather than a fixed ratio — the same idea, applied there to general prose via TextRank. Calendar data is structured, so we can do better than trimming sentences: we know what's recurring, what's imminent, and how dense a stretch is, and use that to decide what survives a shrinking budget.

## The model

Every function takes a plain array of events and an options bag; nothing here renders anything — you get text or structured data back, and decide how to display it.

```ts
interface CalendarEvent {
  name: string;
  start: Date | string;       // ISO datetime, or bare "YYYY-MM-DD" for all-day
  end?: Date | string;
  description?: string;
  link?: string;
  tags?: string[];
  seriesId?: string;          // marks recurring instances (e.g. Google's recurringEventId)
  priority?: number;          // higher breaks through a tight budget; default 0
}
```

Six digest functions, from raw grouping up to the fully space-aware summary:

- **`binEvents(events, ["today", "tomorrow", "thisWeek", …])`** — sort events into named relative windows.
- **`tieredWindow(events, opts)`** — the default nested-horizon view: N events in the next 7 days, M more in the next 30, the rest beyond. Closer events get finer granularity.
- **`shapeDigest(events, opts)`** — the density profile: where the busy clusters are, how intense each one is, and where the quiet stretches sit. Recurring series are excluded by default (`includeSeries: false`) so a daily standup doesn't flatten every day to "busy."
- **`textDigest(events, opts)`** — prose sized by sentence count (`maxSentences`), built on tiers or bins.
- **`timelineDigest`** / **`calendarDigest`** — bucketed density and day-by-day agenda views, for rendering your own chart or grid.
- **`briefDigest(events, opts)`** — the character-budget version. Takes `budget: "watch" | "banner" | "widget" | "spoken" | "display"` (40 / 80 / 140 / 170 / 300 chars) or any raw number, and packs fragments in priority order — imminent events, then priority break-throughs, then one-offs, then collapsed recurring series — degrading each to a shorter phrasing before dropping it, and always accounting for anything left over as `"+N more"` rather than silently hiding it.

`priority` (plus a `tagPriorities: { dependency: 2 }`-style map) lets one event — a vendor deadline, a compliance filing — force its way into a summary that would otherwise only have room for whatever's chronologically nearest. `mode: "relative"` swaps absolute dates for durations ("in 12 days" instead of "on Aug 5") for surfaces with no shared sense of calendar date. Every digest also takes `timeZone` (IANA, default UTC) and `now`, and every fragment carries the original events it summarizes, so a UI can drill down from "6 events" to the events themselves.

## Size & performance

No runtime dependencies — the only platform API touched is `Intl`.

| | Raw | Gzip |
| - | -: | -: |
| ESM (`dist/index.js`, for bundlers — deliberately unminified) | 34 KB | 8.5 KB |
| Minified IIFE (`dist/index.global.js`, for a plain `<script>` tag) | 17 KB | 6.5 KB |
| Tree-shaken (`briefDigest` alone, via a bundler) | 11 KB | 4.2 KB |

`"sideEffects": false` is set, so bundlers can tree-shake reliably. Importing the module does no work at load — the only top-level state is two empty formatter caches — so it costs nothing toward a page becoming interactive. The one real cost is the *first* call to any formatting function (`Intl.DateTimeFormat` construction and ICU data load, ~13ms) — paid once, cached by time zone after that; a warm call over 200 events runs under 1ms.

## Time zones

Events carry absolute instants; "today" and "tomorrow" only mean something relative to a viewer's zone. Every digest takes a `timeZone` option (default `"UTC"`) and computes day/week/month boundaries in it using `Intl`, with no dependency. Bare `YYYY-MM-DD` starts are treated as all-day and anchored to that calendar date in the display zone, matching how Google Calendar represents them.

## Exploring the library

- **`npm run explore`** — five synthetic datasets (a treasury desk's funding cycle, routine tasks burying real deadlines, a release week, a sneaky vendor dependency, an empty calendar) you can browse interactively or drive by CLI args. See [`examples/fixtures/`](examples/fixtures/).
- **`npm run live`** — a CLI harness that authenticates against your real Google Calendar and runs every digest against it. See [`examples/live/`](examples/live/) for one-time OAuth setup.
- **`examples/web/demo.html`** — the source behind the live demo above; `node examples/web/build.mjs` rebuilds it from the current library and fixtures.

## Status

Pre-1.0, 51 tests, not yet published to a registry. The API may still move.
