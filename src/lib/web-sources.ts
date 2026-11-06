// Official sources for a part (L5): product facts from a public page (structured data first),
// part pages found through a supplier's sitemap, and distributor APIs (Mouser, Digi-Key).
// Everything here is reference evidence, never a confirmed offer.
import { politeFetch, robotsFor, robotsAllows, checkUrl } from "./web-fetch";
import { partKey } from "./parts";
import { parseMoney } from "./supplier-doc";
import { db } from "./db";

export type Break = { qty: number; price: number };
export type SourceFacts = {
  kind: "PAGE" | "SITEMAP" | "MOUSER" | "DIGIKEY";
  url: string; host: string;
  title: string | null; mpnSeen: string | null; brand: string | null;
  matched: boolean;
  price: number | null; currency: string | null; priceBreaks: Break[] | null;
  stock: number | null; availability: string | null; leadText: string | null; lifecycle: string | null;
  datasheetUrl: string | null;
};

// ---------- HTML helpers ----------
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const clean = (s: unknown) => (typeof s === "string" || typeof s === "number" ? decode(String(s)).replace(/\s+/g, " ").trim() || null : null);
const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? clean(/content=["']([^"']*)["']/i.exec(tag)?.[1]) : null;
};
const itemprop = (html: string, key: string) => {
  const tag = new RegExp(`<[^>]+itemprop=["']${key}["'][^>]*>([^<]{0,120})`, "i").exec(html);
  if (!tag) return null;
  return clean(/content=["']([^"']*)["']/i.exec(tag[0])?.[1] ?? tag[1]);
};
const pageText = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

type Json = Record<string, unknown>;
function jsonLdProducts(html: string): Json[] {
  const out: Json[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as Json;
    const type = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (type.some((t) => /^(Product|IndividualProduct|ProductModel)$/i.test(t))) out.push(o);
    if (o["@graph"]) visit(o["@graph"]);
    if (o.mainEntity) visit(o.mainEntity);
    if (o.itemListElement) visit(o.itemListElement);
    if (o.item) visit(o.item);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* broken JSON-LD: ignore */ }
  }
  return out;
}
const AVAIL: Record<string, string> = { InStock: "IN_STOCK", InStoreOnly: "IN_STOCK", LimitedAvailability: "LIMITED", OutOfStock: "OUT_OF_STOCK", SoldOut: "OUT_OF_STOCK", BackOrder: "BACKORDER", PreOrder: "PREORDER", Discontinued: "DISCONTINUED", MadeToOrder: "MADE_TO_ORDER" };
const availOf = (v: unknown) => { const s = clean(v); if (!s) return null; const k = s.replace(/^https?:\/\/schema\.org\//i, ""); return AVAIL[k] ?? k.slice(0, 40); };
const num = (v: unknown): number | null => { if (typeof v === "number") return Number.isFinite(v) ? v : null; const s = clean(v); return s ? (/^\d+(\.\d+)?$/.test(s) ? Number(s) : parseMoney(s)) : null; };

/** Facts from one product page. `keys` = normalized part numbers we are looking for. */
export function pageFacts(html: string, url: string, keys: string[], kind: "PAGE" | "SITEMAP" = "PAGE"): SourceFacts {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const prods = jsonLdProducts(html);
  const wanted = new Set(keys);
  const codeOf = (p: Json) => [p.mpn, p.sku, p.productID, p.model].map(clean).filter(Boolean) as string[];
  const p = prods.find((x) => codeOf(x).some((c) => wanted.has(partKey(c)))) ?? prods[0];
  let price: number | null = null, currency: string | null = null, availability: string | null = null, stock: number | null = null, mpnSeen: string | null = null, brand: string | null = null, title: string | null = null;
  if (p) {
    title = clean(p.name);
    mpnSeen = codeOf(p).find((c) => wanted.has(partKey(c))) ?? clean(p.mpn) ?? clean(p.sku);
    brand = clean(typeof p.brand === "object" && p.brand ? (p.brand as Json).name : p.brand) ?? clean(typeof p.manufacturer === "object" && p.manufacturer ? (p.manufacturer as Json).name : p.manufacturer);
    const offers = ([] as unknown[]).concat(p.offers ?? []).filter((o) => o && typeof o === "object") as Json[];
    const o = offers[0];
    if (o) {
      const spec = ([] as unknown[]).concat(o.priceSpecification ?? [])[0] as Json | undefined;
      price = num(o.price) ?? num(o.lowPrice) ?? num(spec?.price);
      currency = clean(o.priceCurrency) ?? clean(spec?.priceCurrency);
      availability = availOf(o.availability);
      const inv = o.inventoryLevel as Json | undefined;
      stock = inv ? num(inv.value) : null;
    }
  }
  title ??= meta(html, "og:title") ?? clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  price ??= num(meta(html, "product:price:amount") ?? itemprop(html, "price"));
  currency ??= meta(html, "product:price:currency") ?? itemprop(html, "priceCurrency");
  availability ??= availOf(meta(html, "product:availability") ?? itemprop(html, "availability"));
  mpnSeen ??= itemprop(html, "mpn") ?? itemprop(html, "sku");
  brand ??= itemprop(html, "brand") ?? meta(html, "product:brand");
  // Does the page actually show one of our part numbers? (letters+digits only, so "6SL3210-1KE21" = "6SL32101KE21")
  const flat = partKey(pageText(html));
  const matched = (!!mpnSeen && wanted.has(partKey(mpnSeen))) || keys.some((k) => k.length >= 6 && flat.includes(k));
  if (!mpnSeen && matched) mpnSeen = keys.find((k) => flat.includes(k)) ?? null;
  // A datasheet link, if any.
  let datasheetUrl: string | null = null;
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    if (/data ?sheet|ficha|hoja de datos|technical|t[ée]cnic/i.test(m[1] + " " + m[2])) { try { datasheetUrl = new URL(decode(m[1]), url).toString(); } catch {} break; }
  }
  return { kind, url, host, title: title?.slice(0, 200) ?? null, mpnSeen: mpnSeen?.slice(0, 60) ?? null, brand: brand?.slice(0, 60) ?? null, matched, price: price && price > 0 ? price : null, currency: currency?.toUpperCase().slice(0, 3) ?? null, priceBreaks: null, stock, availability, leadText: null, lifecycle: availability === "DISCONTINUED" ? "DISCONTINUED" : null, datasheetUrl };
}

// ---------- sitemaps ----------
const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1].trim()));

/** All page URLs listed in a site's sitemaps (cached 7 days). Bounded so a huge site can't stall us. */
export async function sitemapUrls(website: string, deadline: number): Promise<{ urls: string[]; note?: string }> {
  const start = checkUrl(website);
  if (!start.ok) return { urls: [], note: start.fail };
  const origin = start.url.origin;
  const robots = await robotsFor(origin);
  if (!robotsAllows(robots, "/")) return { urls: [], note: "ROBOTS" };
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [origin + "/sitemap.xml", origin + "/sitemap_index.xml"];
  const seen = new Set<string>(); const pages: string[] = [];
  let reads = 0;
  while (queue.length && reads < 25 && pages.length < 200_000 && Date.now() < deadline) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm); reads++;
    const r = await politeFetch(sm, { ttlMs: 7 * 86_400_000, maxBytes: 12 * 1024 * 1024 });
    if (!r.ok) continue;
    const list = locs(r.body);
    if (/<sitemapindex/i.test(r.body)) {
      // Product sitemaps first.
      list.sort((a, b) => Number(/product|producto|item|catalog|part/i.test(b)) - Number(/product|producto|item|catalog|part/i.test(a)));
      queue.push(...list);
    } else pages.push(...list);
  }
  return { urls: pages, note: pages.length ? undefined : "EMPTY" };
}

/** Sitemap URLs whose address contains one of the part numbers. */
export function urlsForKeys(urls: string[], keys: string[]) {
  const ks = keys.filter((k) => k.length >= 5);
  return urls.filter((u) => { let path = u; try { path = decodeURIComponent(new URL(u).pathname); } catch {} const f = partKey(path); return ks.some((k) => f.includes(k)); }).slice(0, 5);
}

// ---------- distributor APIs ----------
export const mouserConfigured = () => !!process.env.MOUSER_API_KEY;
export const digikeyConfigured = () => !!(process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET);

async function cachedJson<T>(key: string, ttlMs: number, get: () => Promise<T>): Promise<T> {
  const c = await db.webCache.findUnique({ where: { url: key } });
  if (c && Date.now() - c.fetchedAt.getTime() < ttlMs && c.body) return JSON.parse(c.body) as T;
  const v = await get();
  const data = { status: 200, contentType: "application/json", body: JSON.stringify(v), fetchedAt: new Date() };
  await db.webCache.upsert({ where: { url: key }, create: { url: key, ...data }, update: data });
  return v;
}
const lifecycleOf = (s: string | null) => (!s ? null : /obsolete|obsoleto/i.test(s) ? "OBSOLETE" : /discontinu|end of life|eol|last time buy|not recommended/i.test(s) ? "DISCONTINUED" : /active|new product/i.test(s) ? "ACTIVE" : null);

export class SourceError extends Error { constructor(public code: "AUTH" | "LIMIT" | "DOWN", msg: string) { super(msg); } }

/** Mouser Search API v1, part-number search (official, free key from mouser.com/api-hub). */
export async function mouserSearch(mpn: string): Promise<SourceFacts[]> {
  const key = process.env.MOUSER_API_KEY;
  if (!key) return [];
  const k = partKey(mpn);
  type MPart = { ManufacturerPartNumber?: string; Manufacturer?: string; Description?: string; Availability?: string; AvailabilityInStock?: string; LeadTime?: string; LifecycleStatus?: string; ProductDetailUrl?: string; DataSheetUrl?: string; PriceBreaks?: { Quantity?: number; Price?: string; Currency?: string }[] };
  const parts = await cachedJson<MPart[]>(`api:mouser:${k}`, 86_400_000, async () => {
    const res = await fetch(`${process.env.MOUSER_API_BASE ?? "https://api.mouser.com"}/api/v1/search/partnumber?apiKey=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: mpn.slice(0, 40), partSearchOptions: "None" } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) throw new SourceError("AUTH", "Mouser rejected the key");
    if (res.status === 429) throw new SourceError("LIMIT", "Mouser daily limit");
    if (!res.ok) throw new SourceError("DOWN", `Mouser ${res.status}`);
    const j = (await res.json()) as { Errors?: { Message?: string; Code?: string }[]; SearchResults?: { Parts?: MPart[] } };
    if (j.Errors?.length && !j.SearchResults?.Parts?.length) {
      const msg = j.Errors.map((e) => e.Message ?? e.Code).join("; ");
      throw new SourceError(/key|auth|invalid/i.test(msg) ? "AUTH" : /limit|exceed|quota/i.test(msg) ? "LIMIT" : "DOWN", msg.slice(0, 120));
    }
    return (j.SearchResults?.Parts ?? []).slice(0, 8);
  });
  return parts.filter((p) => p.ProductDetailUrl).map((p) => {
    const breaks = (p.PriceBreaks ?? []).map((b) => ({ qty: Number(b.Quantity) || 1, price: parseMoney(b.Price ?? "") ?? 0 })).filter((b) => b.price > 0);
    const stock = p.AvailabilityInStock != null ? Number(String(p.AvailabilityInStock).replace(/\D/g, "")) : null;
    return {
      kind: "MOUSER" as const, url: p.ProductDetailUrl!, host: "mouser.com",
      title: clean(p.Description), mpnSeen: clean(p.ManufacturerPartNumber), brand: clean(p.Manufacturer),
      matched: !!p.ManufacturerPartNumber && partKey(p.ManufacturerPartNumber) === k,
      price: breaks[0]?.price ?? null, currency: clean(p.PriceBreaks?.[0]?.Currency)?.toUpperCase() ?? null, priceBreaks: breaks.length ? breaks : null,
      stock: Number.isFinite(stock) ? stock : null, availability: clean(p.Availability), leadText: clean(p.LeadTime),
      lifecycle: lifecycleOf(clean(p.LifecycleStatus)), datasheetUrl: clean(p.DataSheetUrl),
    };
  }).sort((a, b) => Number(b.matched) - Number(a.matched)).slice(0, 5);
}

let dkToken: { token: string; until: number } | null = null;
async function digikeyToken() {
  if (dkToken && dkToken.until > Date.now() + 60_000) return dkToken.token;
  const res = await fetch(`${process.env.DIGIKEY_API_BASE ?? "https://api.digikey.com"}/v1/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.DIGIKEY_CLIENT_ID!, client_secret: process.env.DIGIKEY_CLIENT_SECRET!, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 400 || res.status === 401) throw new SourceError("AUTH", "Digi-Key rejected the credentials");
  if (!res.ok) throw new SourceError("DOWN", `Digi-Key token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  dkToken = { token: j.access_token, until: Date.now() + (j.expires_in ?? 600) * 1000 };
  return dkToken.token;
}

/** Digi-Key Product Information v4, keyword search (official, free app at developer.digikey.com). */
export async function digikeySearch(mpn: string): Promise<SourceFacts[]> {
  if (!digikeyConfigured()) return [];
  const k = partKey(mpn);
  type DProduct = { ManufacturerProductNumber?: string; Manufacturer?: { Name?: string }; Description?: { ProductDescription?: string; DetailedDescription?: string }; QuantityAvailable?: number; UnitPrice?: number; ProductUrl?: string; DatasheetUrl?: string; ProductStatus?: { Status?: string }; ManufacturerLeadWeeks?: string | number; ProductVariations?: { StandardPricing?: { BreakQuantity?: number; UnitPrice?: number }[] }[] };
  const data = await cachedJson<{ products: DProduct[]; currency: string | null }>(`api:digikey:${k}`, 86_400_000, async () => {
    const token = await digikeyToken();
    const res = await fetch(`${process.env.DIGIKEY_API_BASE ?? "https://api.digikey.com"}/products/v4/search/keyword`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-DIGIKEY-Client-Id": process.env.DIGIKEY_CLIENT_ID!, "X-DIGIKEY-Locale-Site": "US", "X-DIGIKEY-Locale-Language": "en", "X-DIGIKEY-Locale-Currency": "USD" },
      body: JSON.stringify({ Keywords: mpn.slice(0, 250), Limit: 10, Offset: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) { dkToken = null; throw new SourceError("AUTH", "Digi-Key rejected the credentials"); }
    if (res.status === 429) throw new SourceError("LIMIT", "Digi-Key rate limit");
    if (!res.ok) throw new SourceError("DOWN", `Digi-Key ${res.status}`);
    const j = (await res.json()) as { ExactMatches?: DProduct[]; Products?: DProduct[]; SearchLocaleUsed?: { Currency?: string } };
    const seen = new Set<string>();
    const products = [...(j.ExactMatches ?? []), ...(j.Products ?? [])].filter((p) => { const u = p.ProductUrl ?? ""; if (!u || seen.has(u)) return false; seen.add(u); return true; }).slice(0, 8);
    return { products, currency: j.SearchLocaleUsed?.Currency ?? "USD" };
  });
  return data.products.map((p) => {
    const std = p.ProductVariations?.find((v) => v.StandardPricing?.length)?.StandardPricing ?? [];
    const breaks = std.map((b) => ({ qty: Number(b.BreakQuantity) || 1, price: Number(b.UnitPrice) || 0 })).filter((b) => b.price > 0);
    const lead = p.ManufacturerLeadWeeks != null && String(p.ManufacturerLeadWeeks).trim() ? `${p.ManufacturerLeadWeeks} weeks` : null;
    return {
      kind: "DIGIKEY" as const, url: p.ProductUrl!, host: "digikey.com",
      title: clean(p.Description?.ProductDescription ?? p.Description?.DetailedDescription), mpnSeen: clean(p.ManufacturerProductNumber), brand: clean(p.Manufacturer?.Name),
      matched: !!p.ManufacturerProductNumber && partKey(p.ManufacturerProductNumber) === k,
      price: (Number(p.UnitPrice) || breaks[0]?.price) || null, currency: data.currency, priceBreaks: breaks.length ? breaks : null,
      stock: typeof p.QuantityAvailable === "number" ? p.QuantityAvailable : null, availability: null, leadText: lead,
      lifecycle: lifecycleOf(clean(p.ProductStatus?.Status)), datasheetUrl: clean(p.DatasheetUrl),
    };
  }).sort((a, b) => Number(b.matched) - Number(a.matched)).slice(0, 5);
}
