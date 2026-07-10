// Thin wrapper over the Calendar API v3 REST endpoint — no need for the
// full googleapis SDK just to list events.
const BASE = "https://www.googleapis.com/calendar/v3";

export async function fetchEvents(client, { calendarId, timeMin, timeMax }) {
  const items = [];
  let pageToken;
  do {
    const { token } = await client.getAccessToken();
    const url = new URL(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true"); // expands recurring events into instances
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Calendar API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

/** Maps raw Calendar API items to this library's CalendarEvent shape. */
export function toCalendarEvents(items) {
  return items
    .filter((e) => e.status !== "cancelled" && (e.start?.date || e.start?.dateTime))
    .map((e) => ({
      id: e.id,
      name: e.summary ?? "(untitled)",
      start: e.start.date ?? e.start.dateTime,
      ...(e.end?.dateTime ? { end: e.end.dateTime } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.htmlLink ? { link: e.htmlLink } : {}),
      ...(e.recurringEventId ? { seriesId: e.recurringEventId } : {}),
      tags: [e.eventType ?? "default"],
    }));
}
