// Reads the first sheet of an .xlsx file, or a .csv, into rows of cells. No third-party library:
// an .xlsx is a zip of XML files. Only what's needed for tabular datasets (no formulas evaluated —
// the cached values Excel stores are used; dates stay as Excel serial numbers).
import { inflateRawSync } from "node:zlib";

export type Cell = string | number | null;
export type Sheet = { rows: Cell[][]; sheetName: string; sheetNames: string[] };

const MAX_UNZIPPED = 150 * 1024 * 1024; // protects against zip bombs
const MAX_ROWS = 60000;

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: scan back (comment can be up to 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("No es un archivo .xlsx válido (zip sin directorio).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Directorio del zip dañado.");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + elen + clen;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml))$/.test(name)) continue;
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error("Entrada del zip dañada.");
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    total += usize;
    if (total > MAX_UNZIPPED) throw new Error("El archivo descomprimido es demasiado grande.");
    out.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) : (() => { throw new Error("Compresión no soportada."); })());
  }
  return out;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]));
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const colIndex = (ref: string) => { const l = /^[A-Z]+/.exec(ref)?.[0] ?? "A"; let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Drops namespace prefixes (<x:row> → <row>) that some generators use. */
const plain = (xml: string) => xml.replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, "<$1");

/** Reads one sheet. Without `sheet`, the one with the most cells (data usually isn't on a cover/summary sheet). */
export function readXlsx(buf: Buffer, sheet?: string): Sheet {
  const files = unzip(buf);
  const wbRaw = files.get("xl/workbook.xml")?.toString("utf8");
  if (!wbRaw) throw new Error("El .xlsx no tiene libro de trabajo.");
  const wb = plain(wbRaw);
  const rels = plain(files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "");
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = unxml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "Hoja");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const rel = rid ? [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((r) => r[0]).find((r) => r.includes(`Id="${rid}"`)) : undefined;
    const target = rel ? /\bTarget="([^"]+)"/.exec(rel)?.[1] : undefined;
    const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : undefined;
    return { name, path };
  }).filter((x) => x.path && files.has(x.path));
  if (!sheets.length) throw new Error("No se encontró ninguna hoja.");
  const sizeOf = (path: string) => (files.get(path)!.toString("utf8").match(/<(?:\w+:)?c\b/g) ?? []).length;
  const chosen = (sheet && sheets.find((x) => x.name === sheet)) || sheets.map((x) => ({ ...x, n: sizeOf(x.path!) })).sort((a, b) => b.n - a.n)[0];
  const sheetName = chosen.name;
  const xml = plain(files.get(chosen.path!)!.toString("utf8"));
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8");
  const shared = ss ? [...plain(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  const rows: Cell[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    if (rows.length >= MAX_ROWS) throw new Error(`El archivo tiene más de ${MAX_ROWS} filas.`);
    const rAttr = /\br="(\d+)"/.exec(rm[1] ?? rm[3] ?? "")?.[1];
    const rowIdx = rAttr ? Number(rAttr) - 1 : rows.length;
    while (rows.length < rowIdx) rows.push([]);
    const row: Cell[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const ci = ref ? colIndex(ref) : row.length;
      const t = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val: Cell = null;
      if (t === "s") val = v != null ? shared[Number(v)] ?? null : null;
      else if (t === "inlineStr") val = textOf(body);
      else if (t === "str" || t === "e") val = v != null ? unxml(v) : null;
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v != null) { const n = Number(v); val = Number.isFinite(n) ? n : unxml(v); }
      while (row.length < ci) row.push(null);
      row[ci] = typeof val === "string" ? val.trim() || null : val;
    }
    rows[rowIdx] = row;
  }
  return { rows, sheetName, sheetNames: sheets.map((x) => x.name) };
}

/** CSV with auto-detected delimiter (, ; tab) and encoding (UTF-8, else Windows-1252 as Colombian public files often are). */
export function readCsv(buf: Buffer): Sheet {
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
  text = text.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0 || text.length);
  const delim = [";", "\t", ","].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: Cell[][] = [];
  let row: Cell[] = [], cur = "", q = false;
  const push = () => { const v = cur.trim(); row.push(v === "" ? null : v); cur = ""; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"' && cur.trim() === "") { q = true; cur = ""; }
    else if (ch === delim) push();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; push(); rows.push(row); row = []; if (rows.length > MAX_ROWS) throw new Error(`El archivo tiene más de ${MAX_ROWS} filas.`); }
    else cur += ch;
  }
  if (cur !== "" || row.length) { push(); rows.push(row); }
  return { rows: rows.filter((r) => r.some((c) => c != null)), sheetName: "CSV", sheetNames: ["CSV"] };
}

export function readSheet(fileName: string, buf: Buffer, sheet?: string): Sheet {
  if (buf.subarray(0, 2).toString("latin1") === "PK" || /\.xlsx$/i.test(fileName)) return readXlsx(buf, sheet);
  if (/\.xls$/i.test(fileName)) throw new Error("El formato .xls antiguo no se puede leer: ábrelo en Excel y guárdalo como .xlsx o .csv.");
  return readCsv(buf);
}
