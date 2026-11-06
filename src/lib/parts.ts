import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { brandIn, categoryIn, expandWords, fold, intentOf, type Intent } from "@/lib/part-lexicon";

// Spare Parts Localization: the parts catalog and its search.
// A part number is compared by its normalized key, so "6205-2RS", "6205 2rs" and "62052RS" are
// the same part. Aliases (OEM, aftermarket, cross-references, older numbers) point to one canonical part.

export const partKey = (code: string) => code.toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
export const AUTO = "SOLU (historial)";

export type MatchWhy =
  | { t: "MPN" }
  | { t: "ALIAS"; kind: string; code: string }
  | { t: "PREFIX"; code: string }
  | { t: "SIMILAR"; code: string; sim: number }
  | { t: "WORDS"; hits: { word: string; via: string }[]; fuzzy: string[] }
  | { t: "BRAND"; brand: string };

export type PartHit = {
  id: string; mpn: string; brand: string | null; name: string; nameEn: string | null; category: string | null;
  lifecycle: string | null; score: number; why: MatchWhy[];
};

type Row = { id: string; mpn: string; brand: string | null; name: string; nameEn: string | null; category: string | null; lifecycle: string | null; mergedIntoId: string | null };

let lastSync = 0;
/** Keeps the catalog in step with new quote/PO lines, at most every 10 minutes per server. */
export async function ensureCatalogFresh() {
  if (Date.now() - lastSync < 10 * 60 * 1000) return;
  lastSync = Date.now();
  try { await syncCatalogFromHistory(); } catch { lastSync = 0; }
}

export async function searchParts(q: string, limit = 20): Promise<{ intent: Intent; brand?: string; hits: PartHit[] }> {
  const query = q.trim().slice(0, 200);
  const intent = intentOf(query);
  const brand = brandIn(query);
  if (!query) return { intent, hits: [] };
  const key = partKey(query);
  const found = new Map<string, { score: number; why: MatchWhy[] }>();
  const add = (id: string, score: number, why: MatchWhy) => {
    const cur = found.get(id) ?? { score: 0, why: [] };
    cur.score = Math.max(cur.score, score) + (cur.why.length ? 2 : 0);
    if (!cur.why.some((w) => w.t === why.t)) cur.why.push(why);
    found.set(id, cur);
  };

  // 1. The query (or a token of it) as a part number: exact, starts-with, or similar (typos).
  const tokens = [...new Set([key, ...query.split(/\s+/).map(partKey)])].filter((k) => k.length >= 3 && /\d/.test(k));
  if (tokens.length) {
    const codes = await db.$queryRaw<{ id: string; code: string; k: string; kind: string; sim: number }[]>`
      SELECT p.id, p.mpn AS code, p."mpnKey" AS k, 'MPN' AS kind, MAX(similarity(p."mpnKey", t)) AS sim
        FROM "Part" p, unnest(${tokens}::text[]) t
       WHERE p."mpnKey" = t OR p."mpnKey" LIKE t || '%' OR similarity(p."mpnKey", t) > 0.4
       GROUP BY p.id
      UNION ALL
      SELECT a."partId" AS id, a.code, a."codeKey" AS k, a.kind, MAX(similarity(a."codeKey", t)) AS sim
        FROM "PartAlias" a, unnest(${tokens}::text[]) t
       WHERE a."codeKey" = t OR a."codeKey" LIKE t || '%' OR similarity(a."codeKey", t) > 0.4
       GROUP BY a.id`;
    for (const c of codes) {
      const exact = tokens.includes(c.k);
      const prefix = !exact && tokens.some((t) => c.k.startsWith(t));
      if (exact) add(c.id, c.kind === "MPN" ? 100 : 92, c.kind === "MPN" ? { t: "MPN" } : { t: "ALIAS", kind: c.kind, code: c.code });
      else if (prefix) add(c.id, 75, { t: "PREFIX", code: c.code });
      else add(c.id, Math.round(40 + Number(c.sim) * 40), { t: "SIMILAR", code: c.code, sim: Number(c.sim) });
    }
  }

  // 2. The words: every word of the query, in Spanish or English, with typo tolerance.
  const groups = expandWords(query).filter((g) => !brand || !fold(brand).split(" ").includes(g.word));
  if (groups.length) {
    const alts = [...new Set(groups.flatMap((g) => g.alts))];
    const words = groups.map((g) => g.word);
    const rows = await db.$queryRaw<(Row & { txt: string })[]>`
      SELECT p.id, p.mpn, p.brand, p.name, p."nameEn", p.category, p.lifecycle, p."mergedIntoId",
             lower(unaccent(p.name || ' ' || coalesce(p."nameEn", '') || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.notes, '') || ' ' ||
               coalesce((SELECT string_agg(a.code, ' ') FROM "PartAlias" a WHERE a."partId" = p.id AND a.kind = 'NAME'), ''))) AS txt
        FROM "Part" p
       WHERE EXISTS (SELECT 1 FROM unnest(${alts}::text[]) w WHERE lower(unaccent(p.name || ' ' || coalesce(p."nameEn", '') || ' ' || coalesce(p.notes, ''))) LIKE '%' || w || '%')
          OR EXISTS (SELECT 1 FROM unnest(${words}::text[]) w WHERE word_similarity(w, lower(unaccent(p.name || ' ' || coalesce(p."nameEn", '')))) > 0.55)
          OR EXISTS (SELECT 1 FROM "PartAlias" a, unnest(${alts}::text[]) w WHERE a."partId" = p.id AND a.kind = 'NAME' AND lower(unaccent(a.code)) LIKE '%' || w || '%')
       LIMIT 300`;
    for (const r of rows) {
      const hits: { word: string; via: string }[] = [];
      const fuzzy: string[] = [];
      for (const g of groups) {
        const via = g.alts.find((a) => r.txt.includes(a));
        if (via) hits.push({ word: g.word, via });
        else if (r.txt.split(/[^a-z0-9]+/).some((w) => w.length > 3 && near(w, g.word))) fuzzy.push(g.word);
      }
      const matched = hits.length + fuzzy.length * 0.7;
      if (!matched) continue;
      // A part number already matched as a code doesn't need to be repeated as a "description" reason.
      if (found.has(r.id) && hits.every((h) => tokens.includes(partKey(h.word))) && !fuzzy.length) continue;
      add(r.id, Math.round(25 + (45 * matched) / groups.length), { t: "WORDS", hits, fuzzy });
    }
  }

  // 3. The brand: "Siemens" alone lists Siemens parts; with other words it only adds weight (below).
  if (brand && !groups.length && !found.size) {
    const b = fold(brand);
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Part" p
       WHERE lower(unaccent(coalesce(p.brand, ''))) = ${b}
          OR lower(unaccent(p.name || ' ' || coalesce(p."nameEn", ''))) ~ ('(^|[^a-z0-9])' || ${b.replace(/[^a-z0-9 ]/g, "")} || '([^a-z0-9]|$)')
       LIMIT 200`;
    for (const r of rows) add(r.id, 58, { t: "BRAND", brand });
  }

  if (!found.size) return { intent, brand, hits: [] };
  const parts = await db.part.findMany({
    where: { id: { in: [...found.keys()] } },
    select: { id: true, mpn: true, brand: true, name: true, nameEn: true, category: true, lifecycle: true, mergedIntoId: true, mergedInto: { select: { id: true, mpn: true, brand: true, name: true, nameEn: true, category: true, lifecycle: true } } },
  });
  // A merged duplicate always answers with its canonical part.
  const out = new Map<string, PartHit>();
  for (const p of parts) {
    const f = found.get(p.id)!;
    const c = p.mergedInto ?? p;
    let score = f.score;
    const why = [...f.why];
    if (brand && c.brand && fold(c.brand) === fold(brand)) { if (!why.some((w) => w.t === "BRAND")) { score += 12; why.push({ t: "BRAND", brand: c.brand }); } }
    else if (brand && c.brand) score -= 10;
    const prev = out.get(c.id);
    if (!prev || prev.score < score) out.set(c.id, { id: c.id, mpn: c.mpn, brand: c.brand, name: c.name, nameEn: c.nameEn, category: c.category, lifecycle: c.lifecycle, score: Math.min(100, score), why });
  }
  const rank: MatchWhy["t"][] = ["MPN", "ALIAS", "PREFIX", "SIMILAR", "WORDS", "BRAND"];
  const hits = [...out.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  hits.forEach((h) => h.why.sort((a, b) => rank.indexOf(a.t) - rank.indexOf(b.t)));
  return { intent, brand, hits };
}

/** Edit distance ≤ 1 for short words, ≤ 2 for long ones (typos like "rodamieto"). */
function near(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const max = b.length > 7 ? 2 : 1;
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] <= max;
}

const mostCommon = (xs: string[]) => {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
};

/**
 * Builds and updates the catalog from what the company already quoted, sold and bought:
 * one Part per normalized code (new ones only), other spellings as VARIANT aliases, and
 * ALIAS facts from Product 360. Parts SOLU created that no longer have any history are removed.
 */
export async function syncCatalogFromHistory() {
  const [ql, di, sl, cl, facts, parts, aliases] = await Promise.all([
    db.quoteLine.findMany({ where: { code: { not: null } }, select: { code: true, description: true } }),
    db.dealItem.findMany({ where: { code: { not: null } }, select: { code: true, description: true } }),
    db.supplierPOLine.findMany({ where: { code: { not: null } }, select: { code: true, description: true } }),
    db.customerPOLine.findMany({ where: { code: { not: null } }, select: { code: true, description: true } }),
    db.productFact.findMany({ where: { kind: "ALIAS" }, select: { code: true, text: true, source: true } }),
    db.part.findMany({ select: { id: true, mpnKey: true, createdByName: true, createdAt: true, updatedAt: true } }),
    db.partAlias.findMany({ select: { partId: true, codeKey: true, kind: true, source: true } }),
  ]);
  const groups = new Map<string, { codes: string[]; descs: string[] }>();
  for (const l of [...ql, ...di, ...sl, ...cl]) {
    const k = partKey(l.code!);
    if (k.length < 3) continue;
    const g = groups.get(k) ?? { codes: [], descs: [] };
    g.codes.push(l.code!.trim());
    if (l.description?.trim()) g.descs.push(l.description.trim());
    groups.set(k, g);
  }
  const byKey = new Map(parts.map((p) => [p.mpnKey, p.id]));
  const aliasOwner = new Map(aliases.map((a) => [a.codeKey, a.partId]));
  const aliasSet = new Set(aliases.map((a) => `${a.partId}|${a.codeKey}`));
  let created = 0, linked = 0;

  for (const [k, g] of groups) {
    const owner = byKey.get(k) ?? aliasOwner.get(k);
    // Spellings of the same normalized key ("6205-2RS" / "6205 2RS") already match the part.
    if (owner) continue;
    const mpn = mostCommon(g.codes)!;
    const name = mostCommon(g.descs) ?? mpn;
    const p = await db.part.create({
      data: { mpn, mpnKey: k, name: name.slice(0, 300), brand: brandIn(g.descs.join(" ")) ?? null, category: categoryIn(g.descs.join(" ")) ?? null, createdByName: AUTO },
    });
    byKey.set(k, p.id);
    created++;
  }

  // ALIAS facts recorded on Product 360 ("Sitrans P DS III", "7MF0340-1EC00").
  for (const f of facts) {
    const owner = byKey.get(partKey(f.code)) ?? aliasOwner.get(partKey(f.code));
    if (!owner) continue;
    const token = f.text.match(/[A-Z0-9][A-Z0-9.\-/]{3,}[A-Z0-9]/i)?.[0];
    const isCode = !!token && /\d/.test(token) && partKey(token).length >= 4;
    const code = isCode ? token! : f.text.trim().slice(0, 120);
    const ck = isCode ? partKey(code) : partKey(code) || fold(code).replace(/\s/g, "");
    if (!ck || aliasSet.has(`${owner}|${ck}`) || byKey.get(ck) === owner) continue;
    await db.partAlias.create({ data: { partId: owner, code, codeKey: ck, kind: isCode ? "OEM" : "NAME", source: f.source ?? "Producto 360", createdByName: AUTO } });
    aliasSet.add(`${owner}|${ck}`);
    linked++;
  }

  // Parts SOLU created from history that no longer have any history and nobody edited.
  const keysWithHistory = new Set(groups.keys());
  const stale = parts.filter((p) => p.createdByName === AUTO && !keysWithHistory.has(p.mpnKey) && Math.abs(+p.updatedAt - +p.createdAt) < 2000);
  for (const p of stale) {
    const manual = aliases.some((a) => a.partId === p.id && a.source !== "Producto 360" && a.kind !== "VARIANT");
    if (!manual) await db.part.delete({ where: { id: p.id } }).catch(() => {});
  }
  return { created, linked, pruned: stale.length };
}

/** Every key the part answers to: its own, its aliases' and its merged duplicates'. */
export async function partKeys(id: string) {
  const p = await db.part.findUniqueOrThrow({ where: { id }, select: { mpnKey: true, aliases: { select: { codeKey: true, kind: true } }, merged: { select: { mpnKey: true, aliases: { select: { codeKey: true, kind: true } } } } } });
  const codeKinds = (xs: { codeKey: string; kind: string }[]) => xs.filter((a) => a.kind !== "NAME").map((a) => a.codeKey);
  return [...new Set([p.mpnKey, ...codeKinds(p.aliases), ...p.merged.flatMap((m) => [m.mpnKey, ...codeKinds(m.aliases)])])];
}

/** Where the part appears in the company's history (quotes, Journeys, supplier and customer POs). */
export async function partHistory(keys: string[]) {
  const norm = Prisma.sql`regexp_replace(upper(code), '[^A-Z0-9]', '', 'g')`;
  const [quotes, items, buys, cpos] = await Promise.all([
    db.$queryRaw<{ id: string; quoteId: string; code: string; description: string; qty: number; unitPrice: string }[]>`SELECT id, "quoteId", code, description, qty, "unitPrice"::text FROM "QuoteLine" WHERE code IS NOT NULL AND ${norm} = ANY(${keys}::text[])`,
    db.$queryRaw<{ id: string; dealId: string; code: string; description: string; qty: number; unitPrice: string }[]>`SELECT id, "dealId", code, description, qty, "unitPrice"::text FROM "DealItem" WHERE code IS NOT NULL AND ${norm} = ANY(${keys}::text[])`,
    db.$queryRaw<{ id: string; supplierPoId: string; code: string; description: string; qty: number; unitCost: string }[]>`SELECT id, "supplierPoId", code, description, qty, "unitCost"::text FROM "SupplierPOLine" WHERE code IS NOT NULL AND ${norm} = ANY(${keys}::text[])`,
    db.$queryRaw<{ id: string; poId: string; code: string; qty: number }[]>`SELECT id, "poId", code, qty FROM "CustomerPOLine" WHERE code IS NOT NULL AND ${norm} = ANY(${keys}::text[])`,
  ]);
  const [quoteRecs, dealRecs, spoRecs] = await Promise.all([
    db.quote.findMany({ where: { id: { in: quotes.map((x) => x.quoteId) } }, select: { id: true, number: true, rev: true, status: true, createdAt: true, deal: { select: { id: true, code: true, account: { select: { name: true } } } } } }),
    db.deal.findMany({ where: { id: { in: items.map((x) => x.dealId) } }, select: { id: true, code: true, title: true, stage: true, account: { select: { id: true, name: true } } } }),
    db.supplierPO.findMany({ where: { id: { in: buys.map((x) => x.supplierPoId) } }, select: { id: true, code: true, currency: true, createdAt: true, releasedAt: true, confirmedAt: true, receivedAt: true, supplier: { select: { id: true, name: true } } } }),
  ]);
  return {
    quotes: quotes.map((l) => ({ ...l, quote: quoteRecs.find((q) => q.id === l.quoteId) })).filter((x) => x.quote),
    items: items.map((l) => ({ ...l, deal: dealRecs.find((d) => d.id === l.dealId) })).filter((x) => x.deal),
    buys: buys.map((l) => ({ ...l, po: spoRecs.find((s) => s.id === l.supplierPoId) })).filter((x) => x.po),
    customerPoLines: cpos.length,
  };
}

/** Merges a duplicate into the canonical part: its number and aliases move over as aliases. */
export async function mergeParts(dupId: string, canonicalId: string, byName: string) {
  if (dupId === canonicalId) throw new Error("same part");
  const [dup, can] = await Promise.all([
    db.part.findUniqueOrThrow({ where: { id: dupId }, include: { aliases: true } }),
    db.part.findUniqueOrThrow({ where: { id: canonicalId }, include: { aliases: true } }),
  ]);
  if (can.mergedIntoId) throw new Error("canonical is itself merged");
  const have = new Set([can.mpnKey, ...can.aliases.map((a) => a.codeKey)]);
  await db.$transaction(async (tx) => {
    if (!have.has(dup.mpnKey)) await tx.partAlias.create({ data: { partId: can.id, code: dup.mpn, codeKey: dup.mpnKey, kind: "MERGED", brand: dup.brand, source: `Fusionado por ${byName}`, createdByName: byName } });
    for (const a of dup.aliases) {
      if (have.has(a.codeKey)) continue;
      await tx.partAlias.create({ data: { partId: can.id, code: a.code, codeKey: a.codeKey, kind: a.kind, brand: a.brand, source: a.source, createdByName: a.createdByName } });
      have.add(a.codeKey);
    }
    await tx.partAlias.deleteMany({ where: { partId: dup.id } });
    // Fill the canonical part's empty fields with what the duplicate knew.
    await tx.part.update({
      where: { id: can.id },
      data: {
        brand: can.brand ?? dup.brand, nameEn: can.nameEn ?? dup.nameEn, category: can.category ?? dup.category, gtin: can.gtin ?? dup.gtin,
        compatibleModels: [...new Set([...can.compatibleModels, ...dup.compatibleModels])],
        notes: can.notes ?? dup.notes,
      },
    });
    await tx.part.updateMany({ where: { mergedIntoId: dup.id }, data: { mergedIntoId: can.id } });
    await tx.part.update({ where: { id: dup.id }, data: { mergedIntoId: can.id } });
  });
}
