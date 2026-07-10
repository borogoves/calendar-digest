// Explorer for the fixture datasets in this directory — no Google account
// or setup required.
//
// Interactive:   node examples/fixtures/run.mjs
// Non-interactive (for scripting/repeats): node examples/fixtures/run.mjs <dataset> [dayOffset] [days] [mode]
//   e.g. node examples/fixtures/run.mjs quiet-then-burst 6 30 relative
import { readFile } from "node:fs/promises";
import path from "node:path";
import process, { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { printReport } from "../shared/report.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const DATASETS = [
  ["empty", "Nothing on the calendar at all"],
  ["quiet-then-burst", "A quiet week, then 6 events packed into 3 days"],
  ["recurring-heavy", "Daily/weekly series burying a few one-off events"],
  ["overloaded-conference", "A 5-day, 20-event conference week"],
  ["critical-outlier", "Sparse calendar plus one far-out high-priority flight"],
];

async function loadDataset(idOrIndex) {
  const byIndex = DATASETS[Number(idOrIndex) - 1];
  const id = byIndex ? byIndex[0] : idOrIndex;
  const raw = JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8"));
  return { id, ...raw };
}

function runOne(dataset, dayOffset, days, mode) {
  const anchor = new Date(dataset.anchor);
  const now = new Date(anchor.getTime() + dayOffset * 86_400_000);
  console.log(`${dataset.id} — ${dataset.description}`);
  console.log(`(anchor "now": ${anchor.toISOString()} in ${dataset.timeZone}; using now = ${now.toISOString()}; mode = ${mode})\n`);
  printReport(dataset.events, { now, timeZone: dataset.timeZone, days, mode });
}

const [argDataset, argOffset, argDays, argMode] = process.argv.slice(2);

if (argDataset) {
  const dataset = await loadDataset(argDataset);
  runOne(dataset, Number(argOffset ?? 0), Number(argDays ?? 90), argMode ?? "calendar");
  process.exit(0);
}

console.log("Fixture datasets:\n");
DATASETS.forEach(([id, description], i) => console.log(`  ${i + 1}. ${id} — ${description}`));

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (question, fallback) => {
  const answer = (await rl.question(fallback !== undefined ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  return answer || fallback;
};

let again = true;
while (again) {
  const pick = await ask("\nWhich dataset (1-5)", "2");
  const dataset = await loadDataset(pick);
  const dayOffset = Number(await ask("Start how many days from the anchor (negative goes earlier)", "0"));
  const days = Number(await ask("How many days ahead to look", "90"));
  const mode = await ask("Mode (calendar/relative)", "calendar");
  console.log();
  runOne(dataset, dayOffset, days, mode);
  const cont = await ask("\nTry another? (y/n)", "y");
  again = (cont ?? "").toLowerCase().startsWith("y");
}
rl.close();
process.exit(0);
