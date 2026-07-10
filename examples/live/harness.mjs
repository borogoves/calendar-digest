// Interactive test harness that connects to your real Google Calendar.
// One-time setup: see the instructions printed if credentials.json is
// missing (also documented in this directory's auth.mjs).
// Usage: node examples/live/harness.mjs
import process, { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { getAuthedClient } from "./auth.mjs";
import { fetchEvents, toCalendarEvents } from "./calendarApi.mjs";
import { printReport } from "../shared/report.mjs";

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (question, fallback) => {
  const answer = (await rl.question(fallback !== undefined ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  return answer || fallback;
};

const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

console.log("Connecting to Google Calendar...");
const client = await getAuthedClient();
console.log("Connected.\n");

let again = true;
while (again) {
  const calendarId = await ask("Calendar ID", "primary");
  const timeZone = await ask("Display time zone (IANA)", systemTimeZone);
  const startInput = await ask("Start date (YYYY-MM-DD, or 'today')", "today");
  const days = Number(await ask("How many days ahead", "90"));

  const now = startInput === "today" ? new Date() : new Date(`${startInput}T00:00:00Z`);
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 86_400_000).toISOString();

  console.log(`\nFetching events from "${calendarId}"...`);
  let events;
  try {
    const items = await fetchEvents(client, { calendarId, timeMin, timeMax });
    events = toCalendarEvents(items);
  } catch (err) {
    console.error(`\nCouldn't fetch events: ${err.message}\n`);
    const cont = await ask("Try again? (y/n)", "y");
    again = cont.toLowerCase().startsWith("y");
    continue;
  }
  console.log();

  printReport(events, { now, timeZone, days });

  const cont = await ask("\nRun another query? (y/n)", "y");
  again = cont.toLowerCase().startsWith("y");
}
rl.close();
process.exit(0);
