import { describe, expect, it } from "vitest";
import {
  binEvents,
  briefDigest,
  calendarDigest,
  resolveEvents,
  shapeDigest,
  summarizeSeries,
  textDigest,
  tieredWindow,
  timelineDigest,
  type CalendarEvent,
} from "../src/index.js";
import { addDays, startOfDay } from "../src/tz.js";

// Thursday, July 9 2026, noon in New York (16:00 UTC).
const NOW = "2026-07-09T16:00:00Z";
const NY = { now: NOW, timeZone: "America/New_York" } as const;

const ev = (name: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  name,
  start,
  ...extra,
});

describe("time zone math", () => {
  it("computes start of day in a zone", () => {
    const sod = startOfDay(new Date(NOW), "America/New_York");
    expect(sod.toISOString()).toBe("2026-07-09T04:00:00.000Z");
  });

  it("adds calendar days across a DST transition", () => {
    // DST ends Nov 1 2026 in the US; noon stays noon on the wall clock.
    const beforeNoon = new Date("2026-10-31T16:00:00Z"); // noon EDT
    const after = addDays(beforeNoon, 1, "America/New_York");
    expect(after.toISOString()).toBe("2026-11-01T17:00:00.000Z"); // noon EST
  });
});

describe("binEvents", () => {
  it("bins by the display time zone, not UTC", () => {
    // 9 PM Thursday in New York is already Friday in UTC.
    const events = [ev("Late show", "2026-07-10T01:00:00Z")];
    const inNy = binEvents(events, ["today", "tomorrow"], NY);
    expect(inNy.bins[0]!.events).toHaveLength(1);
    expect(inNy.bins[1]!.events).toHaveLength(0);

    const inUtc = binEvents(events, ["today", "tomorrow"], { now: NOW });
    expect(inUtc.bins[0]!.events).toHaveLength(0);
    expect(inUtc.bins[1]!.events).toHaveLength(1);
  });

  it("assigns each event to the first matching bin only", () => {
    const events = [
      ev("Standup", "2026-07-09T17:00:00Z"), // today
      ev("Hike", "2026-07-11T15:00:00Z"), // Saturday
    ];
    const { bins, unbinned } = binEvents(events, ["today", "thisWeek"], NY);
    expect(bins[0]!.events.map((e) => e.source.name)).toEqual(["Standup"]);
    expect(bins[1]!.events.map((e) => e.source.name)).toEqual(["Hike"]);
    expect(unbinned).toHaveLength(0);
  });

  it("ends restOfWeek at the week boundary", () => {
    const events = [
      ev("Saturday hike", "2026-07-11T15:00:00Z"),
      ev("Sunday brunch", "2026-07-12T15:00:00Z"), // next week (weekStartsOn 0)
    ];
    const { bins, unbinned } = binEvents(events, ["restOfWeek"], NY);
    expect(bins[0]!.events.map((e) => e.source.name)).toEqual(["Saturday hike"]);
    expect(unbinned.map((e) => e.source.name)).toEqual(["Sunday brunch"]);
  });

  it("anchors all-day (date-only) events to the display zone's calendar date", () => {
    const { bins } = binEvents([ev("Field trip", "2026-07-10")], ["today", "tomorrow"], NY);
    expect(bins[1]!.events).toHaveLength(1);
    expect(bins[1]!.events[0]!.allDay).toBe(true);
  });
});

describe("tieredWindow", () => {
  const events = [
    ev("Past thing", "2026-07-01T12:00:00Z"),
    ev("Soon", "2026-07-12T12:00:00Z"), // +3 days
    ev("Mid", "2026-07-20T12:00:00Z"), // +11 days
    ev("Far", "2026-10-01T12:00:00Z"), // ~+3 months
    ev("Next summer", "2027-08-01T12:00:00Z"), // beyond a year
  ];

  it("counts each event once, in the nearest tier, ignoring the past", () => {
    const window = tieredWindow(events, NY);
    expect(window.tiers.map((t) => t.count)).toEqual([1, 1, 1]);
    expect(window.tiers[0]!.events[0]!.source.name).toBe("Soon");
    expect(window.beyond.count).toBe(1);
  });

  it("accepts custom tiers", () => {
    const window = tieredWindow(events, { ...NY, tiers: [{ days: 14 }, { days: 400 }] });
    expect(window.tiers.map((t) => t.count)).toEqual([2, 2]);
    expect(window.tiers[1]!.label).toBe("the next 400 days");
    expect(window.beyond.count).toBe(0);
  });

  it("caps the whole window at 'days', excluding anything beyond it entirely", () => {
    // Default tiers are 7/30/365; a 10-day cap should clip the 30-day tier
    // down to 10 and drop the 365-day tier and "beyond" altogether.
    const window = tieredWindow(events, { ...NY, days: 10 });
    expect(window.tiers).toHaveLength(2);
    expect(window.tiers[0]).toMatchObject({ label: "the next 7 days", count: 1 });
    expect(window.tiers[1]!.end.getTime() - window.tiers[1]!.start.getTime()).toBe(3 * 86_400_000);
    expect(window.tiers.reduce((n, t) => n + t.count, 0)).toBe(1); // just "Soon" (+3 days)
    expect(window.beyond.count).toBe(0);
  });
});

describe("textDigest", () => {
  it("summarizes bins into sentences with times", () => {
    const events = [
      ev("Standup", "2026-07-09T17:00:00Z"), // 1:00 PM NY
      ev("Dentist", "2026-07-09T21:00:00Z"), // 5:00 PM NY
      ev("Brunch", "2026-07-10T14:00:00Z"), // 10:00 AM NY tomorrow
    ];
    const digest = textDigest(events, { ...NY, bins: ["today", "tomorrow"] });
    expect(digest.sentences[0]!.text).toBe(
      "2 events today: Standup at 1:00 PM and Dentist at 5:00 PM.",
    );
    expect(digest.sentences[1]!.text).toBe("1 event tomorrow: Brunch at 10:00 AM.");
    expect(digest.text).toBe(`${digest.sentences[0]!.text} ${digest.sentences[1]!.text}`);
  });

  it("carries events on each sentence for drill-down", () => {
    const events = [ev("Standup", "2026-07-09T17:00:00Z", { id: "abc", link: "https://x" })];
    const digest = textDigest(events, { ...NY, bins: ["today"] });
    expect(digest.sentences[0]!.events[0]!.source.id).toBe("abc");
    expect(digest.sentences[0]!.events[0]!.source.link).toBe("https://x");
  });

  it("uses the tiered window by default and marks later tiers as 'more'", () => {
    const events = [
      ev("Soon", "2026-07-12T12:00:00Z"),
      ev("Mid A", "2026-07-20T12:00:00Z"),
      ev("Mid B", "2026-07-25T12:00:00Z"),
      ev("Far", "2026-10-01T12:00:00Z"),
    ];
    const digest = textDigest(events, NY);
    expect(digest.sentences[0]!.text).toMatch(/^1 event in the next 7 days/);
    expect(digest.sentences[1]!.text).toMatch(/^2 more events in the next 30 days/);
    expect(digest.sentences[2]!.text).toMatch(/^1 more event in the next year/);
  });

  it("respects maxSentences and summarizes large groups by count", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      ev(`Meeting ${i + 1}`, `2026-07-09T${17 + i}:00:00Z`),
    );
    const digest = textDigest(events, { ...NY, bins: ["today", "tomorrow"], maxSentences: 1 });
    expect(digest.sentences).toHaveLength(1);
    expect(digest.sentences[0]!.text).toBe(
      "6 events today: Meeting 1 at 1:00 PM, Meeting 2 at 2:00 PM, Meeting 3 at 3:00 PM, and 3 more.",
    );
  });

  it("handles an empty list", () => {
    expect(textDigest([], NY).text).toBe("No upcoming events.");
  });
});

describe("textDigest specificity gradient", () => {
  // Anchor is Thu, Jul 9. Near (<7d): full date+time. Mid (7-30d): date
  // only. Far (30d+): a vague period.
  const events = [
    ev("Dentist", "2026-07-14T15:00:00Z"), // +5 days: near
    ev("Car service", "2026-07-25T14:00:00Z"), // +16 days: mid
    ev("Flight to Tokyo", "2026-08-30T13:00:00Z"), // +52 days: far
  ];

  it("shows full date+time near, date-only mid-range, and a vague period far out", () => {
    const digest = textDigest(events, { ...NY, maxNamed: 3 });
    const sentence = digest.sentences.map((s) => s.text).join(" ");
    expect(sentence).toContain("Dentist on Tue, Jul 14 at 11:00 AM");
    expect(sentence).toContain("Car service on Sat, Jul 25");
    expect(sentence).not.toContain("Car service on Sat, Jul 25 at");
    expect(sentence).toContain("Flight to Tokyo in late August");
  });

  it("lets the developer move the boundaries", () => {
    const digest = textDigest(events, { ...NY, maxNamed: 3, dateBoundaryDays: 20, vagueBoundaryDays: 60 });
    const sentence = digest.sentences.map((s) => s.text).join(" ");
    // Car service (+16d) now falls under the wider near-boundary (20d).
    expect(sentence).toContain("Car service on Sat, Jul 25 at 10:00 AM");
    // Flight (+52d) now falls under the mid tier since the vague boundary moved to 60d.
    expect(sentence).toContain("Flight to Tokyo on Sun, Aug 30");
    expect(sentence).not.toContain("Flight to Tokyo on Sun, Aug 30 at");
  });

  it("lets a priority-flagged far event bypass the vague coarsening", () => {
    const flagged = [...events.slice(0, 2), ev("Flight to Tokyo", "2026-08-30T13:00:00Z", { priority: 1 })];
    const digest = textDigest(flagged, { ...NY, maxNamed: 3 });
    expect(digest.sentences.map((s) => s.text).join(" ")).toContain(
      "Flight to Tokyo on Sun, Aug 30 at 9:00 AM",
    );
  });
});

describe("relative mode", () => {
  const events = [
    ev("Call mom", "2026-07-09T18:00:00Z"), // +2 hours
    ev("Dentist", "2026-07-25T14:00:00Z"), // +16 days -> ~2 weeks
    ev("Flight to Seoul", "2026-10-01T13:00:00Z"), // +84 days -> ~3 months
  ];

  it("textDigest describes events as durations from now, with a one-time preamble", () => {
    const digest = textDigest(events, { ...NY, mode: "relative", maxNamed: 3 });
    expect(digest.text.startsWith("Times below are relative to now. ")).toBe(true);
    expect(digest.text).toContain("Call mom in 2 hours");
    expect(digest.text).toContain("Dentist in 2 weeks");
    expect(digest.text).toContain("Flight to Seoul in 3 months");
    // Individual sentences don't repeat the "relative to now" framing.
    expect(digest.sentences.every((s) => !s.text.includes("relative"))).toBe(true);
  });

  it("briefDigest uses relative durations too, with the preamble only on prose budgets", () => {
    const display = briefDigest(events, { ...NY, mode: "relative", budget: "display" });
    expect(display.text.startsWith("Times relative to now — ")).toBe(true);
    expect(display.text).toContain("in 2 hours");
    expect(display.text).toContain("in 2 weeks");
    expect(display.text).toContain("in 3 months");

    const watch = briefDigest(events, { ...NY, mode: "relative", budget: "watch" });
    expect(watch.text.startsWith("Times relative")).toBe(false);
    expect(watch.text.length).toBeLessThanOrEqual(40);
  });

  it("gives priority-flagged events an exact day count instead of a rounded unit", () => {
    const flagged = [ev("Flight to Seoul", "2026-10-01T13:00:00Z", { priority: 1 })];
    const digest = textDigest(flagged, { ...NY, mode: "relative" });
    expect(digest.text).toContain("Flight to Seoul in 84 days");
  });

  it("uses today/tomorrow for near all-day events instead of '0 days'", () => {
    const digest = textDigest([ev("Field trip", "2026-07-10")], { ...NY, mode: "relative", bins: ["tomorrow"] });
    expect(digest.text).toContain("Field trip tomorrow");
  });
});

describe("summarizeSeries", () => {
  const TZ = "America/New_York";
  const resolve = (events: CalendarEvent[]) => resolveEvents(events, TZ);

  it("collapses a daily series with a consistent time", () => {
    const events = resolve(
      Array.from({ length: 5 }, (_, i) =>
        ev("Call mom", `2026-07-${10 + i}T17:00:00Z`, { seriesId: "mom" }),
      ),
    );
    const { oneOffs, series } = summarizeSeries(events, TZ);
    expect(oneOffs).toHaveLength(0);
    expect(series).toHaveLength(1);
    expect(series[0]!.cadence).toBe("daily");
    expect(series[0]!.time).toBe("1:00 PM");
  });

  it("names the weekday for weekly and biweekly series", () => {
    // Jul 10, 17, 24 2026 are Fridays.
    const weekly = resolve(
      ["2026-07-10", "2026-07-17", "2026-07-24"].map((d) =>
        ev("Zoom", `${d}T15:00:00Z`, { seriesId: "zoom" }),
      ),
    );
    expect(summarizeSeries(weekly, TZ).series[0]!.cadence).toBe("Fridays");

    const biweekly = resolve(
      ["2026-07-13", "2026-07-27", "2026-08-10"].map((d) => // Mondays, 2 weeks apart
        ev("1:1", `${d}T14:00:00Z`, { seriesId: "oneonone" }),
      ),
    );
    expect(summarizeSeries(biweekly, TZ).series[0]!.cadence).toBe("every other Monday");
  });

  it("detects the every-weekday pattern instead of a bare count", () => {
    const weekdays = resolve(
      [13, 14, 15, 16, 17, 20, 21, 22, 23, 24].map((d) => // Mon–Fri, two weeks
        ev("Standup", `2026-07-${d}T14:00:00Z`, { seriesId: "standup" }),
      ),
    );
    expect(summarizeSeries(weekdays, TZ).series[0]!.cadence).toBe("every weekday");
  });

  it("detects monthly cadence", () => {
    const monthly = resolve(
      ["2026-07-15", "2026-08-15", "2026-09-15"].map((d) =>
        ev("Rent", `${d}T12:00:00Z`, { seriesId: "rent" }),
      ),
    );
    expect(summarizeSeries(monthly, TZ).series[0]!.cadence).toBe("monthly");
  });

  it("falls back to a count for irregular series and omits inconsistent times", () => {
    const events = resolve([
      ev("Gym", "2026-07-10T11:00:00Z", { seriesId: "gym" }),
      ev("Gym", "2026-07-11T13:00:00Z", { seriesId: "gym" }),
      ev("Gym", "2026-07-15T11:00:00Z", { seriesId: "gym" }),
    ]);
    const { series } = summarizeSeries(events, TZ);
    expect(series[0]!.cadence).toBe("3×");
    expect(series[0]!.time).toBeUndefined();
  });

  it("treats a series' lone instance as a one-off", () => {
    const events = resolve([ev("Call mom", "2026-07-10T17:00:00Z", { seriesId: "mom" })]);
    const { oneOffs, series } = summarizeSeries(events, TZ);
    expect(series).toHaveLength(0);
    expect(oneOffs).toHaveLength(1);
  });
});

describe("textDigest with recurring series", () => {
  it("names one-offs first and collapses each series to one mention", () => {
    const events: CalendarEvent[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        ev("Call mom", `2026-07-${10 + i}T17:00:00Z`, { seriesId: "mom" }),
      ),
      ev("Dentist", "2026-07-13T15:00:00Z"),
    ];
    const digest = textDigest(events, NY);
    expect(digest.sentences[0]!.text).toBe(
      "7 events in the next 7 days: Dentist on Mon, Jul 13 at 11:00 AM and Call mom (daily at 1:00 PM).",
    );
    expect(digest.sentences[0]!.events).toHaveLength(7);
  });
});

describe("timelineDigest", () => {
  it("builds daily buckets with counts and a max for scaling", () => {
    const events = [
      ev("A", "2026-07-10T14:00:00Z"),
      ev("B", "2026-07-10T20:00:00Z"),
      ev("C", "2026-07-14T14:00:00Z"),
    ];
    const digest = timelineDigest(events, { ...NY, days: 14 });
    expect(digest.granularity).toBe("day");
    expect(digest.buckets).toHaveLength(14);
    expect(digest.buckets[1]!.count).toBe(2);
    expect(digest.buckets[5]!.count).toBe(1);
    expect(digest.maxCount).toBe(2);
    expect(digest.buckets[0]!.label).toBe("Jul 9");
  });

  it("defaults to weekly buckets over 90 days", () => {
    const digest = timelineDigest([], NY);
    expect(digest.granularity).toBe("week");
    expect(digest.buckets).toHaveLength(13);
    expect(digest.buckets[0]!.label).toBe("Jul 9 – Jul 15");
  });
});

describe("shapeDigest", () => {
  it("detects a quiet week followed by a burst", () => {
    const events = [
      ev("Dentist", "2026-07-16T15:00:00Z"),
      ev("Recital", "2026-07-17T22:00:00Z"),
      ev("Hike", "2026-07-18T14:00:00Z"),
    ];
    const shape = shapeDigest(events, NY);
    expect(shape.leadingQuietDays).toBe(7);
    expect(shape.nextEvent!.source.name).toBe("Dentist");
    expect(shape.clusters).toHaveLength(1);
    expect(shape.clusters[0]).toMatchObject({
      startDate: "2026-07-16",
      endDate: "2026-07-18",
      days: 3,
      count: 3,
      intensity: 1,
    });
    // Leading quiet week, then nothing after the burst until the horizon.
    expect(shape.quietStretches).toEqual([
      { startDate: "2026-07-09", endDate: "2026-07-15", days: 7 },
      { startDate: "2026-07-19", endDate: "2026-10-06", days: 80 },
    ]);
  });

  it("splits clusters on gaps of minQuietDays and merges below it", () => {
    const events = [
      ev("A", "2026-07-10T15:00:00Z"),
      ev("B", "2026-07-11T15:00:00Z"),
      ev("C", "2026-07-14T15:00:00Z"), // 2 empty days before this
    ];
    const split = shapeDigest(events, NY);
    expect(split.clusters.map((c) => c.startDate)).toEqual(["2026-07-10", "2026-07-14"]);

    const merged = shapeDigest(events, { ...NY, minQuietDays: 3 });
    expect(merged.clusters).toHaveLength(1);
    expect(merged.clusters[0]).toMatchObject({ days: 5, count: 3, intensity: 0.6 });
  });

  it("moves recurring series to background so they don't mask the shape", () => {
    const events: CalendarEvent[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        ev("Call mom", `2026-07-${10 + i}T17:00:00Z`, { seriesId: "mom" }),
      ),
      ev("Dentist", "2026-07-16T15:00:00Z"),
    ];
    const shape = shapeDigest(events, NY);
    expect(shape.leadingQuietDays).toBe(7);
    expect(shape.clusters).toHaveLength(1);
    expect(shape.clusters[0]!.count).toBe(1);
    expect(shape.background.map((s) => s.name)).toEqual(["Call mom"]);

    const withSeries = shapeDigest(events, { ...NY, includeSeries: true });
    expect(withSeries.leadingQuietDays).toBe(1);
    expect(withSeries.clusters[0]!.count).toBe(11);
    expect(withSeries.background).toHaveLength(0);
  });

  it("describes an empty horizon and ignores events beyond it", () => {
    const shape = shapeDigest([ev("Far away", "2026-11-01T12:00:00Z")], { ...NY, days: 90 });
    expect(shape.clusters).toHaveLength(0);
    expect(shape.nextEvent).toBeUndefined();
    expect(shape.leadingQuietDays).toBe(90);
    expect(shape.quietStretches).toEqual([
      { startDate: "2026-07-09", endDate: "2026-10-06", days: 90 },
    ]);
  });
});

describe("briefDigest", () => {
  // A quiet stretch, then six events across Tue–Thu of next week.
  const burst = [
    ev("dentist", "2026-07-14T15:00:00Z"),
    ev("board meeting", "2026-07-14T18:00:00Z"),
    ev("recital", "2026-07-15T22:00:00Z"),
    ev("party", "2026-07-15T23:00:00Z"),
    ev("hike", "2026-07-16T14:00:00Z"),
    ev("brunch", "2026-07-16T15:00:00Z"),
  ];

  it("narrates quiet-then-burst in prose at widget size", () => {
    const brief = briefDigest(burst, { ...NY, budget: "widget" });
    expect(brief.text).toBe(
      "Nothing until Tue, then a busy stretch Jul 14–16: 6 events, incl. dentist.",
    );
    expect(brief.text.length).toBeLessThanOrEqual(140);
    const burstFragment = brief.fragments.find((f) => f.kind === "burst");
    expect(burstFragment!.events).toHaveLength(6);
  });

  it("compresses the same story to watch size", () => {
    const brief = briefDigest(burst, { ...NY, budget: "watch" });
    expect(brief.text).toBe("Quiet til Tue · 6 in 3d");
  });

  it("leads with the next event and minutes when something is imminent", () => {
    const brief = briefDigest([ev("Standup", "2026-07-09T16:45:00Z")], NY);
    expect(brief.text).toBe("Next up: Standup in 45 min.");
  });

  it("never hides events: whatever is cut appears as a count", () => {
    const scattered = [
      ...burst,
      ev("vet", "2026-08-10T18:00:00Z"),
      ev("oil change", "2026-08-17T18:00:00Z"),
      ev("book club", "2026-08-24T18:00:00Z"),
      ev("haircut", "2026-08-31T18:00:00Z"),
      ev("tax prep", "2026-09-07T18:00:00Z"),
    ];
    const brief = briefDigest(scattered, { ...NY, budget: "watch" });
    expect(brief.text.length).toBeLessThanOrEqual(40);
    const more = brief.fragments.find((f) => f.kind === "more");
    expect(more).toBeDefined();
    const shown = new Set(brief.fragments.flatMap((f) => f.events));
    expect(shown.size + Number(more!.text.replace(/\D/g, ""))).toBe(scattered.length);
  });

  it("mentions background series in prose and absorbs them when tight", () => {
    const events: CalendarEvent[] = [
      ...Array.from({ length: 20 }, (_, i) => {
        const day = String(10 + i).padStart(2, "0");
        return ev("Call mom", `2026-07-${day}T17:00:00Z`, { seriesId: "mom" });
      }),
      ev("dentist", "2026-07-16T15:00:00Z"),
    ];
    const display = briefDigest(events, { ...NY, budget: "display" });
    // Dentist is exactly 7 days out (the date-boundary threshold), so it
    // now correctly shows a date only, no time.
    expect(display.text).toBe(
      "Nothing until Jul 16, then dentist on Jul 16, plus Call mom (daily at 1:00 PM).",
    );
    const watch = briefDigest(events, { ...NY, budget: "watch" });
    expect(watch.text.length).toBeLessThanOrEqual(40);
    expect(watch.text).toMatch(/\+\d+$/);
  });

  it("says when the horizon is empty", () => {
    expect(briefDigest([], { ...NY, budget: "display" }).text).toBe(
      "No events in the next 90 days.",
    );
    expect(briefDigest([], { ...NY, budget: "watch" }).text).toBe("Free 90d");
  });

  it("stays within every preset budget", () => {
    const events = [
      ...burst,
      ev("vet", "2026-08-10T18:00:00Z"),
      ...Array.from({ length: 10 }, (_, i) => {
        const day = String(10 + i).padStart(2, "0");
        return ev("Call mom", `2026-07-${day}T17:00:00Z`, { seriesId: "mom" });
      }),
    ];
    for (const budget of [40, 80, 140, 170, 300]) {
      const brief = briefDigest(events, { ...NY, budget });
      expect(brief.text.length, `budget ${budget}: "${brief.text}"`).toBeLessThanOrEqual(budget);
    }
  });
});

describe("briefDigest with priorities", () => {
  const burst = [
    ev("dentist", "2026-07-14T15:00:00Z"),
    ev("board meeting", "2026-07-14T18:00:00Z"),
    ev("recital", "2026-07-15T22:00:00Z"),
    ev("party", "2026-07-15T23:00:00Z"),
    ev("hike", "2026-07-16T14:00:00Z"),
    ev("brunch", "2026-07-16T15:00:00Z"),
  ];
  const flight = ev("flight", "2026-08-30T13:00:00Z", { priority: 2 }); // 9 AM NY, Sunday

  it("breaks a far high-priority event through nearer trivia at watch size", () => {
    const brief = briefDigest([...burst, flight], { ...NY, budget: "watch" });
    expect(brief.text).toBe("Quiet til Tue · flight Aug 30 9 AM · +6");
    expect(brief.text.length).toBeLessThanOrEqual(40);
  });

  it("gives tags the same power via tagPriorities", () => {
    const tagged = ev("flight", "2026-08-30T13:00:00Z", { tags: ["travel"] });
    const brief = briefDigest([...burst, tagged], {
      ...NY,
      budget: "watch",
      tagPriorities: { travel: 2 },
    });
    expect(brief.text).toBe("Quiet til Tue · flight Aug 30 9 AM · +6");
  });

  it("never evicts a break-through event to make room for the '+N' count", () => {
    // A long event name plus several other scattered events leaves no
    // room for both the break-through flight and a "+N" tail at watch
    // size — the count must give way, not the flight.
    const events = [
      ev("Dinner with Sam", "2026-07-15T23:00:00Z"),
      ev("Car service", "2026-07-25T14:00:00Z"),
      ev("Book club", "2026-08-05T23:00:00Z"),
      ev("Flight to Tokyo", "2026-08-30T13:00:00Z", { priority: 2 }),
      ev("Haircut", "2026-08-20T17:00:00Z"),
    ];
    const brief = briefDigest(events, { ...NY, budget: "watch" });
    expect(brief.text.length).toBeLessThanOrEqual(40);
    expect(brief.text).toContain("Flight to Tokyo");
    expect(brief.text).not.toMatch(/\+\d+$/);
  });

  it("drops the opening rather than the break-through when they can't both fit", () => {
    // The opening only guarantees that *something* renders; a flagged event
    // satisfies that and outranks it. So the flight appears and stays
    // inside the budget — neither omitted nor overrunning.
    const events = [
      ev("Dinner with Sam", "2026-07-15T23:00:00Z"),
      ev("Flight to Tokyo", "2026-08-30T13:00:00Z", { priority: 2 }),
    ];
    const brief = briefDigest(events, { ...NY, budget: "watch", mode: "relative" });
    expect(brief.text).toContain("Flight to Tokyo");
    expect(brief.text.length).toBeLessThanOrEqual(40);
  });

  it("does not repeat the opening's event in the burst headline", () => {
    // "now" sits inside the stretch, so the opening names the next event;
    // the burst must headline a different one.
    const brief = briefDigest(burst, {
      ...NY,
      now: "2026-07-14T17:30:00Z", // 1:30 PM, half an hour before Board meeting
      budget: "spoken",
    });
    expect(brief.text).toContain("Next up: board meeting");
    expect(brief.text).not.toContain("incl. board meeting");
    expect(brief.text.match(/board meeting/g)).toHaveLength(1);
  });

  it("never exceeds the budget, even for a long-named priority event", () => {
    // The budget is a physical constraint: priority buys first claim on the
    // space, never permission to overrun it. The name gets clipped instead.
    const events = [
      ...burst,
      ev("Vendor API v1 sunset — migrate by", "2026-08-30T13:00:00Z", { priority: 2 }),
    ];
    for (const budget of [40, 80, 140, 170, 300]) {
      const brief = briefDigest(events, { ...NY, budget });
      expect(brief.text.length, `budget ${budget}: "${brief.text}"`).toBeLessThanOrEqual(budget);
    }
    // It still earns its place on the smallest screen, just abbreviated.
    const watch = briefDigest(events, { ...NY, budget: "watch" });
    expect(watch.text).toContain("Aug 30");
    expect(watch.text).toMatch(/Vendor API/);
  });

  it("keeps chronological display order when everything fits", () => {
    const brief = briefDigest([...burst, flight], { ...NY, budget: "display" });
    expect(brief.text).toBe(
      "Nothing until Tue, then a busy stretch Jul 14–16: 6 events, incl. dentist, flight on Aug 30 at 9:00 AM.",
    );
  });

  it("headlines the burst with the next-weightiest event when its top one broke through", () => {
    const events = [
      ...burst.slice(0, 4),
      ev("flight", "2026-07-15T13:00:00Z", { priority: 2 }), // inside the stretch
      ev("recital", "2026-07-16T22:00:00Z", { priority: 1 }),
    ];
    const brief = briefDigest(events, { ...NY, budget: "display" });
    expect(brief.text).toContain("flight on Wed at 9:00 AM");
    expect(brief.text).toContain("incl. recital");
  });

  it("names high-priority events first in textDigest sentences", () => {
    const events = [
      ev("A", "2026-07-09T17:00:00Z"),
      ev("B", "2026-07-09T18:00:00Z"),
      ev("C", "2026-07-09T19:00:00Z"),
      ev("Sofia call", "2026-07-09T20:00:00Z", { tags: ["family"] }),
    ];
    const digest = textDigest(events, {
      ...NY,
      bins: ["today"],
      tagPriorities: { family: 5 },
    });
    expect(digest.sentences[0]!.text).toBe(
      "4 events today: Sofia call at 4:00 PM, A at 1:00 PM, B at 2:00 PM, and 1 more.",
    );
  });
});

describe("calendarDigest", () => {
  it("produces one entry per day with zone-local dates", () => {
    const digest = calendarDigest([ev("Party", "2026-07-20")], NY);
    expect(digest.days).toHaveLength(30);
    expect(digest.days[0]!.date).toBe("2026-07-09");
    const party = digest.days.find((d) => d.events.length > 0);
    expect(party?.date).toBe("2026-07-20");
    expect(party?.weekday).toBe(1); // Monday
  });
});
