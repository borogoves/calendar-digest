// Assembles the self-contained demo page: bundles the library to an IIFE,
// inlines it and the fixture datasets into template.html, and writes
// demo.html. The output has no external requests — library, data, styles,
// and script all live in the one file.
// Usage: node examples/web/build.mjs
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixtureDir = path.join(root, "examples/fixtures");

// Short, human labels for the picker — the fixture files carry a long
// description meant for the CLI explorer, which is too wordy for a <select>.
const DATASETS = [
  ["quiet-then-burst", "Quiet week, then a burst", "a quiet stretch, then 6 events in 3 days"],
  ["critical-outlier", "One critical flight", "sparse, plus a priority flight 7 weeks out"],
  ["recurring-heavy", "Buried by repeats", "daily + weekly series hiding the one-offs"],
  ["overloaded-conference", "Conference week", "a 5-day, 20-event pile-up"],
  ["empty", "Nothing at all", "an empty calendar"],
];

const bundlePath = path.join(here, ".bundle.tmp.js");
execFileSync(
  "npx",
  [
    "esbuild",
    path.join(root, "src/index.ts"),
    "--bundle",
    "--format=iife",
    "--global-name=CalendarDigest",
    "--minify",
    `--outfile=${bundlePath}`,
  ],
  { cwd: root, stdio: "inherit" },
);

const bundle = await readFile(bundlePath, "utf8");
const fixtures = {};
for (const [id, title, blurb] of DATASETS) {
  const raw = JSON.parse(await readFile(path.join(fixtureDir, `${id}.json`), "utf8"));
  fixtures[id] = { title, blurb, anchor: raw.anchor, timeZone: raw.timeZone, events: raw.events };
}

const template = await readFile(path.join(here, "template.html"), "utf8");
const html = template
  .replace("/*__BUNDLE__*/", () => bundle.trim())
  .replace("/*__FIXTURES__*/", () => JSON.stringify(fixtures));

const outPath = path.join(here, "demo.html");
await writeFile(outPath, html);
await execFileSync("rm", [bundlePath]);
console.log(`wrote ${path.relative(root, outPath)} (${(html.length / 1024).toFixed(1)} KB, no external requests)`);
