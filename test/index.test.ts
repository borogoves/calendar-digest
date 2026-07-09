import { describe, expect, it } from "vitest";
import {
  binEvents,
  calendarDigest,
  resolveEvents,
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

  it("detects weekly and monthly cadences", () => {
    const weekly = resolve(
      ["2026-07-10", "2026-07-17", "2026-07-24"].map((d) =>
        ev("Zoom", `${d}T15:00:00Z`, { seriesId: "zoom" }),
      ),
    );
    expect(summarizeSeries(weekly, TZ).series[0]!.cadence).toBe("weekly");

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
