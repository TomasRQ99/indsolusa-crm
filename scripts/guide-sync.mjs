// Copies the step-by-step instructions of the "Guía de campo SOLU USA" page into the app,
// so the search bar can guide a person on screen with the same words the team already tests.
//
// Usage:  node scripts/guide-sync.mjs <saved copy of the Guía de campo .html>
// Writes: src/lib/guide-data.json   (run again every time the Guía de campo changes)
//
// A button named in a step is kept as [[Button text]]: the on-screen guide lights up the
// element with that text.
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";

const src = process.argv[2];
if (!src) { console.error("Usage: node scripts/guide-sync.mjs <guia.html>"); process.exit(1); }
const html = readFileSync(src, "utf8");

function arrayLiteral(name) {
  const start = html.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`No encontré ${name} en el archivo`);
  const from = html.indexOf("[", start);
  const end = html.indexOf("\n  ];", from);
  if (end < 0) throw new Error(`No encontré el final de ${name}`);
  return html.slice(from, end + 4).replace(/;$/, "");
}
// The arrays are plain data plus the helper ui(); they are evaluated alone, with nothing else in reach.
const ctx = vm.createContext(Object.freeze({ ui: (s) => `[[${s}]]` }));
const run = (code) => vm.runInContext(`(${code})`, ctx, { timeout: 2000 });
const MODULES = run(arrayLiteral("MODULES"));
const F = run(arrayLiteral("F"));

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const clean = (s) => String(s ?? "")
  .replace(/<span class="ui">(.*?)<\/span>/g, "[[$1]]")
  .replace(/<[^>]+>/g, "")
  .replace(/&[a-z#0-9]+;/g, (e) => ENT[e] ?? e)
  .replace(/\s+/g, " ")
  .trim();

const out = {
  modules: MODULES.map((m) => ({ id: String(m.id), name: clean(m.name), where: clean(m.where) })),
  features: F.map((f) => ({
    id: String(f.id), m: String(f.m), t: clean(f.t), path: clean(f.path), why: clean(f.why),
    steps: (Array.isArray(f.steps) ? f.steps : []).map(clean).filter(Boolean),
    expect: clean(f.expect),
  })),
};
const ids = new Set();
for (const f of out.features) { if (ids.has(f.id)) throw new Error(`Id repetido: ${f.id}`); ids.add(f.id); }
const left = out.features.filter((f) => /[<>]|&[a-z]+;/.test(JSON.stringify([f.t, f.path, f.why, f.steps, f.expect])));
const dest = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src", "lib", "guide-data.json");
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n", "utf8");
console.log(`${out.features.length} funciones, ${out.modules.length} módulos -> src/lib/guide-data.json`);
if (left.length) console.log("Revisar (queda HTML):", left.map((f) => f.id).join(", "));
if (process.argv.includes("--list")) for (const f of out.features) console.log(`${f.id} | ${f.m} | ${f.path} | ${f.steps.length}`);
