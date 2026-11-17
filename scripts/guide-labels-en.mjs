// Builds src/lib/guide-labels-en.json: for every button the on-screen guide names ([[Button]] in guide-data.json),
// the English text the same button shows when SOLU is in English. It is read from the screens' own code, where
// every text is written as t("español", "English"), so the guide can ring buttons in English too.
//
// Usage: node scripts/guide-labels-en.mjs      (run again after guide-data.json or button texts change)
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src");
const plain = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ]+/g, " ").trim();
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(n)) files.push(p); } };
walk(root);
const un = (s) => s.replace(/\\(["'`\\])/g, "$1");
const pairs = new Map();
const add = (es, en) => { const k = plain(es); if (k && en && !es.includes("${") && !en.includes("${") && !pairs.has(k)) pairs.set(k, un(en)); };
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*(["`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(["`])((?:\\.|(?!\3)[^\\])*)\3\s*\)/g)) add(m[2], m[4]);
  for (const m of src.matchAll(/\bes: "((?:\\.|[^"\\])*)", en: "((?:\\.|[^"\\])*)"/g)) add(m[1], m[2]);
}
// Buttons whose text carries a number or a date: the guide names how they start.
for (const [es, en] of [["Reservar los", "Reserve the"], ["Emitir el informe de", "Issue the"], ["Aprobar liquidación", "Approve settlement"], ["Ctrl K", "Ctrl K"], ["ES", "ES"], ["EN", "EN"]]) if (!pairs.has(plain(es))) pairs.set(plain(es), en);
const data = JSON.parse(readFileSync(path.join(root, "lib", "guide-data.json"), "utf8"));
const out = {}; const missing = new Set();
for (const f of data.features) for (const s of [...f.steps, f.expect ?? ""]) for (const m of s.matchAll(/\[\[(.+?)\]\]/g)) {
  const k = plain(m[1]);
  if (pairs.has(k)) { if (plain(pairs.get(k)) !== k) out[k] = pairs.get(k); } else missing.add(m[1]);
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(path.join(root, "lib", "guide-labels-en.json"), JSON.stringify(sorted, null, 1) + "\n", "utf8");
console.log(`${Object.keys(sorted).length} button names with their English text -> src/lib/guide-labels-en.json`);
if (missing.size) console.log(`No English text found for ${missing.size}: ${[...missing].join(" | ")}`);
