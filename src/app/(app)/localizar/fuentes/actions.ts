"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { partKeys } from "@/lib/parts";
import { politeFetch } from "@/lib/web-fetch";
import { SourceError, digikeySearch, mouserSearch, pageFacts, sitemapUrls, urlsForKeys, type SourceFacts } from "@/lib/web-sources";

async function save(partId: string, f: SourceFacts, by: string) {
  const data = {
    kind: f.kind, host: f.host, title: f.title, mpnSeen: f.mpnSeen, brand: f.brand, matched: f.matched,
    price: f.price, currency: f.currency, priceBreaks: f.priceBreaks ?? undefined, stock: f.stock, availability: f.availability,
    leadText: f.leadText, lifecycle: f.lifecycle, datasheetUrl: f.datasheetUrl, fetchedAt: new Date(), savedByName: by,
  };
  await db.webSource.upsert({ where: { partId_url: { partId, url: f.url } }, create: { partId, url: f.url, ...data }, update: data });
}

/** Read one public page someone pasted (supplier or manufacturer product page). */
export async function readPage(partId: string, fd: FormData) {
  const user = await requireUser();
  const url = String(fd.get("url") ?? "").trim().slice(0, 1000);
  const back = `/localizar/${partId}`;
  if (!url) redirect(`${back}?err=web_SCHEME`);
  const r = await politeFetch(/^https?:\/\//i.test(url) ? url : `https://${url}`, { accept: /html|xml|text\/plain/i });
  if (!r.ok) redirect(`${back}?err=web_${r.fail}${r.status ? `&st=${r.status}` : ""}`);
  const facts = pageFacts(r.body, r.url, await partKeys(partId));
  await save(partId, facts, user.name);
  refreshApp();
  redirect(`${back}?ok=${facts.matched ? "web" : "webnomatch"}#fuentes`);
}

/** Distributor APIs (if configured) + supplier websites' sitemaps. Bounded to ~45 seconds. */
export async function searchSources(partId: string) {
  const user = await requireUser();
  const deadline = Date.now() + 45_000;
  const part = await db.part.findUniqueOrThrow({ where: { id: partId }, select: { mpn: true } });
  const keys = await partKeys(partId);
  const found: SourceFacts[] = [];
  const problems: string[] = [];
  const api = async (name: string, fn: () => Promise<SourceFacts[]>) => {
    try { found.push(...(await fn())); } catch (e) { problems.push(`${name}_${e instanceof SourceError ? e.code : "DOWN"}`); }
  };
  await Promise.all([api("mouser", () => mouserSearch(part.mpn)), api("digikey", () => digikeySearch(part.mpn))]);
  // Supplier websites: only pages whose address carries the part number, read politely.
  const sites = await db.supplier.findMany({ where: { website: { not: null } }, select: { website: true }, take: 8 });
  for (const s of sites) {
    if (Date.now() > deadline) { problems.push("tiempo"); break; }
    const { urls } = await sitemapUrls(s.website!, deadline);
    for (const u of urlsForKeys(urls, keys).slice(0, 3)) {
      if (Date.now() > deadline) break;
      const r = await politeFetch(u, { accept: /html|xml/i });
      if (r.ok) found.push(pageFacts(r.body, r.url, keys, "SITEMAP"));
    }
  }
  for (const f of found) await save(partId, f, user.name);
  refreshApp();
  const q = new URLSearchParams({ ok: "fuentes", n: String(found.length), m: String(found.filter((f) => f.matched).length) });
  if (problems.length) q.set("p", problems.join(","));
  redirect(`/localizar/${partId}?${q}#fuentes`);
}

export async function removeWebSource(partId: string, id: string) {
  await requireUser();
  await db.webSource.deleteMany({ where: { id, partId } });
  refreshApp();
  redirect(`/localizar/${partId}#fuentes`);
}
