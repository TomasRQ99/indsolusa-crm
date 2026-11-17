// Checks the English guide (src/lib/guide-data-en.json) against the Spanish one (src/lib/guide-data.json):
// every guide is there, with the same number of steps and the same [[buttons]] in each step.
// A guide that fails is shown in Spanish by SOLU until its English text is fixed.
//
// Usage: node scripts/guide-en-check.mjs     (run after changing either file)
import { readFileSync } from "node:fs";
import path from "node:path";
const lib = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src", "lib");
const es = JSON.parse(readFileSync(path.join(lib, "guide-data.json"), "utf8")).features;
const en = JSON.parse(readFileSync(path.join(lib, "guide-data-en.json"), "utf8"));
const labels = (s) => [...String(s ?? "").matchAll(/\[\[(.+?)\]\]/g)].map((x) => x[1]).sort().join(" | ");
const bad = [];
for (const f of es) {
  const e = en[f.id];
  if (!e) { bad.push(`${f.id}: no English text`); continue; }
  if (e.steps.length !== f.steps.length) { bad.push(`${f.id}: ${e.steps.length} steps in English, ${f.steps.length} in Spanish`); continue; }
  f.steps.forEach((s, i) => { if (labels(s) !== labels(e.steps[i])) bad.push(`${f.id} step ${i + 1}: the buttons named are different`); });
  if (labels(f.expect) !== labels(e.expect)) bad.push(`${f.id}: "what you should see" names different buttons`);
}
for (const id of Object.keys(en)) if (!es.some((f) => f.id === id)) bad.push(`${id}: only in English`);
console.log(bad.length ? `${bad.length} to fix:\n` + bad.join("\n") : `${es.length} guides: English matches Spanish (steps and buttons).`);
process.exit(bad.length ? 1 : 0);
