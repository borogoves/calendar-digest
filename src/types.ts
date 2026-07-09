/** An event as supplied by the developer (e.g. mapped from a Google Calendar item). */
export interface CalendarEvent {
  /** Stable identifier, passed through untouched for drill-down. */
  id?: string;
  name: string;
  /**
   * When the event starts: a Date, an ISO 8601 datetime string (offset
   * respected), or a bare `YYYY-MM-DD` date, which marks an all-day event
   * anchored to that calendar date in the digest's display time zone.
   */
  start: Date | string;
  /** Optional end; carried through but not used for binning. */
  end?: Date | string;
  description?: string;
  link?: string;
  tags?: string[];
}

/** An event after parsing, always attached to digest output for drill-down. */
export interface ResolvedEvent {
  /** The original event object, untouched. */
  source: CalendarEvent;
  /** Start as an absolute instant. */
  start: Date;
  end?: Date;
  allDay: boolean;
}

/** Options shared by every digest function. */
export interface DigestOptions {
  /** Reference "now". Defaults to the current time. */
  now?: Date | string;
  /**
   * IANA time zone (e.g. "America/New_York") used for day/week/month
   * boundaries and for formatting times. Defaults to "UTC".
   */
  timeZone?: string;
  /** First day of the week, 0 = Sunday … 6 = Saturday. Defaults to 0. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ResolvedOptions {
  now: Date;
  timeZone: string;
  weekStartsOn: number;
}
