// Localizar repuestos · Búsqueda en internet con IA (owner, 2026-11-26): "it should seek through the internet any
// option that fits the piece number, also maybe ask some other questions and then give you multiple sources with
// different levels of confidence where you can after see the direct link to the seller and more info like email and
// phone number if available or link to their contact us form."
//
// Two readers, on purpose. The AI searches the internet and proposes sellers. Then SOLU itself opens each page
// (politely: robots.txt obeyed) and looks for the part number. The confidence shown is decided HERE by rule, from
// what was really seen, never taken from the AI's own opinion of itself.
import { after } from "next/server";
import { db } from "./db";
import { AiError, aiResearch } from "./ai";
import { partKey, partKeys } from "./parts";
import { politeFetch } from "./web-fetch";
import { pageFacts } from "./web-sources";

export const HUNT_FEATURE = "PART_WEB";
/** A search still "running" after this long was cut off (server restart): it is shown as failed. */
export const HUNT_STALE_MS = 8 * 60_000;

export type HuntAnswers = { brand?: string; qty?: string; country?: string; condition?: "NEW" | "ANY"; equivalents?: boolean; details?: string };
export type Understood = { partNumber: string | null; brand: string | null; what: string; alternates: { code: string; note: string }[] };

export const SELLER_KINDS = ["MANUFACTURER", "AUTHORIZED", "DISTRIBUTOR", "MARKETPLACE", "BROKER", "OTHER"] as const;
export const REASONS = ["PAGE_SEEN", "AI_READ_PAGE", "AI_SNIPPET", "PAGE_NOT_SEEN", "LIKELY", "SELLER_ONLY", "LINK_UNKNOWN", "OFFICIAL"] as const;
export type Reason = (typeof REASONS)[number];
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

type AiSource = {
  seller: string; sellerKind: string; country: string | null; productUrl: string;
  match: "EXACT" | "LIKELY" | "SELLER_ONLY"; partNumberShown: string | null; evidence: string;
  price: number | null; currency: string | null; availability: string | null; condition: string;
  email: string | null; phone: string | null; contactUrl: string | null; note: string | null;
};
type AiReport = { understood: { partNumber: string | null; brand: string | null; what: string }; alternates: { code: string; note: string }[]; summary: string; questions: string[]; sources: AiSource[] };

const NUL = (t: string) => ({ type: [t, "null"] });
const REPORT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["understood", "alternates", "summary", "questions", "sources"],
  properties: {
    understood: {
      type: "object", additionalProperties: false, required: ["partNumber", "brand", "what"],
      properties: { partNumber: NUL("string"), brand: NUL("string"), what: { type: "string" } },
    },
    alternates: { type: "array", items: { type: "object", additionalProperties: false, required: ["code", "note"], properties: { code: { type: "string" }, note: { type: "string" } } } },
    summary: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    sources: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["seller", "sellerKind", "country", "productUrl", "match", "partNumberShown", "evidence", "price", "currency", "availability", "condition", "email", "phone", "contactUrl", "note"],
        properties: {
          seller: { type: "string" }, sellerKind: { type: "string", enum: [...SELLER_KINDS] }, country: NUL("string"),
          productUrl: { type: "string" }, match: { type: "string", enum: ["EXACT", "LIKELY", "SELLER_ONLY"] },
          partNumberShown: NUL("string"), evidence: { type: "string" },
          price: NUL("number"), currency: NUL("string"), availability: NUL("string"),
          condition: { type: "string", enum: ["NEW", "REFURBISHED", "USED", "UNKNOWN"] },
          email: NUL("string"), phone: NUL("string"), contactUrl: NUL("string"), note: NUL("string"),
        },
      },
    },
  },
};

const SYSTEM = `You locate industrial spare parts for Industry Solutions, a company that sources parts for factories in Colombia from suppliers anywhere in the world. A buyer on the team gives you a part number, a name or a brand, sometimes with typos, in Spanish or English. Your job is to search the internet and find who can actually sell this exact piece, so the buyer can contact them today.

What a good result looks like: a list of real sellers, each with the direct link to the page where THIS piece is shown (the product page, not the seller's home page), and how to reach them. Cover different kinds of seller when they exist: the manufacturer, its authorized distributors, independent stockists and surplus or obsolete-parts brokers, and marketplaces. Prefer sellers who can ship to the delivery country. Ten good sources at most; three solid ones are worth more than ten weak ones.

The buyer will act on what you report, so accuracy matters more than volume:
- Report only pages you actually saw in the search results or opened. Copy each link exactly as it appeared; never build or guess a link.
- "match" says what the page shows. EXACT: the page shows this same part number (ignoring dashes, dots and spaces). LIKELY: the page shows this piece by brand and description, or a number that differs only in a suffix or variant, and you believe it is the same piece. SELLER_ONLY: the seller carries this brand or kind of piece but you did not see this piece listed.
- "evidence" is one sentence saying what on the page or in the search result supports the match.
- Email, phone and contact page: only what you saw written on the seller's site or in a result. If you did not see it, leave it null. An invented email wastes the buyer's day.
- Price and availability only when the page states them; never estimate.
- If the number looks like it belongs to a different brand or piece than the buyer wrote, say so in "summary".
- "alternates": other numbers the same piece is sold under (superseded numbers, cross references, the manufacturer's order code), only when a page states the equivalence.
- "questions": up to three short questions to the buyer whose answer would change which sellers fit (voltage, size, the machine it goes in, new or used). None if the piece is already unambiguous.

A seller the buyer cannot reach is of little use. For each seller you are going to report without an email or a phone, open their contact page, or run one search for the seller's name with "contact", "email" or "phone", before you finish. You may also open a few pages to confirm that the number is really there. When you are done, call the report_sources tool once. Do not write the findings as text.`;

function prompt(q: string, a: HuntAnswers, known: string[], lang: string) {
  const lines = [
    `What the buyer typed: ${q}`,
    a.brand ? `Brand: ${a.brand}` : null,
    a.qty ? `Quantity needed: ${a.qty}` : null,
    `Delivery country: ${a.country || "Colombia"}`,
    `Condition accepted: ${a.condition === "ANY" ? "new, refurbished or used" : "new only"}`,
    `Equivalent from another brand accepted: ${a.equivalents ? "yes, list them as LIKELY and say in the note that it is an equivalent" : "no, the same brand and number only"}`,
    a.details ? `More from the buyer: ${a.details}` : null,
    known.length ? `What our own catalog already says about it: ${known.join(" · ")}` : null,
    `Write "what", "summary", "evidence", "note", "availability", the alternates' notes and the questions in ${lang === "EN" ? "English" : "Spanish"}. Keep seller names, part numbers and links exactly as they appear.`,
  ];
  return lines.filter(Boolean).join("\n");
}

// ---------- cleaning what the AI hands back ----------
const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, n) : null);
const httpUrl = (v: unknown): URL | null => { const t = s(v, 1000); if (!t) return null; try { const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u : null; } catch { return null; } };
const emailOf = (v: unknown) => { const t = s(v, 120)?.toLowerCase().replace(/^mailto:/, "") ?? ""; return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) && !/example\.|sentry|wixpress|\.(png|jpe?g|gif|webp|svg)$/.test(t) ? t : null; };
const phoneOf = (v: unknown) => { const t = s(v, 40)?.replace(/^tel:/i, "") ?? ""; const digits = t.replace(/\D/g, ""); return /^[+\d(][\d\s().\-/x]{5,}$/i.test(t) && digits.length >= 7 && digits.length <= 16 ? t : null; };
const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
const flatUrl = (u: string) => { try { const x = new URL(u); return (hostOf(x) + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase(); } catch { return u.toLowerCase(); } };

/** Contact data written on the page itself: a mailto, a tel, and the link to the contact page. */
export function pageContacts(html: string, url: string): { email: string | null; phone: string | null; contactUrl: string | null } {
  const site = (() => { try { return hostOf(new URL(url)); } catch { return ""; } })();
  const safe = (x: string) => { try { return decodeURIComponent(x); } catch { return x; } };
  // What a person would read on the page: links first, then the site's own structured data, then visible text.
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&#64;|&commat;/g, "@").replace(/\s+/g, " ");
  const mails = [
    ...[...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => safe(m[1])),
    ...[...html.matchAll(/"email"\s*:\s*"([^"]{5,120})"/gi)].map((m) => m[1]),
    ...[...visible.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)].map((m) => m[0].replace(/\.$/, "")),
  ].map((x) => emailOf(x)).filter((x): x is string => !!x);
  // The seller's own domain first: a mailto to someone else (a web agency, a carrier) is not their contact.
  const base = site.split(".").slice(-2).join(".");
  const email = mails.find((m) => m.endsWith("@" + base) || m.endsWith("." + base)) ?? mails[0] ?? null;
  const phone = [
    ...[...html.matchAll(/href=["']tel:([^"']+)/gi)].map((m) => safe(m[1])),
    ...[...html.matchAll(/"telephone"\s*:\s*"([^"]{6,40})"/gi)].map((m) => m[1]),
    // In plain text only when the page itself labels it as a phone, so a part number is never taken for one.
    ...[...visible.matchAll(/(?:tel[eé]fono|tel|phone|call us|ll[aá]manos|whatsapp|m[oó]vil|celular)\s*[.:]?\s*(\+?[\d(][\d\s().\-/]{6,22}\d)/gi)].map((m) => m[1]),
  ].map((x) => phoneOf(x.trim())).find(Boolean) ?? null;
  let contactUrl: string | null = null;
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (!/contact|contacto|cont[aá]ctenos|kontakt|get-a-quote|request-a-quote|cotiza/i.test(m[1] + " " + m[2].replace(/<[^>]+>/g, " "))) continue;
    if (/^(mailto|tel|javascript):/i.test(m[1])) continue;
    try { const u = new URL(m[1].replace(/&amp;/g, "&"), url); if (/^https?:$/.test(u.protocol)) { contactUrl = u.toString().slice(0, 500); break; } } catch { /* not a link */ }
  }
  return { email, phone, contactUrl };
}

export type SiteContact = { email: string | null; phone: string | null; contactUrl: string | null; pages: number; refused: boolean };
/** Looks for a seller's email and phone on their own site: the contact page the product page links to, the usual
 *  contact addresses, and the home page. A few polite reads at most, and it stops as soon as there is an email. */
export async function siteContacts(url: string, hint?: string | null): Promise<SiteContact> {
  const out: SiteContact = { email: null, phone: null, contactUrl: hint ?? null, pages: 0, refused: false };
  let origin: string;
  try { origin = new URL(url).origin; } catch { return out; }
  const tried = new Set<string>();
  const queue = [hint, `${origin}/contact`, `${origin}/contact-us`, `${origin}/contacto`, `${origin}/`, `${origin}/about`].filter((x): x is string => !!x);
  let failures = 0;
  while (queue.length && out.pages + failures < 5 && !out.email) {
    const next = queue.shift()!;
    const key = flatUrl(next);
    if (tried.has(key)) continue;
    tried.add(key);
    const page = await politeFetch(next, { accept: /html|xml|text\/plain/i, maxBytes: 2 * 1024 * 1024 }).catch(() => null);
    if (!page || !page.ok) {
      failures++;
      // The site itself turns automated readers away: there is no point knocking on its other doors.
      if (page && (page.fail === "ROBOTS" || page.fail === "BLOCKED" || page.fail === "PRIVATE" || page.fail === "NETWORK" || (page.fail === "HTTP" && (page.status === 403 || page.status === 429 || page.status === 503)))) { out.refused = true; break; }
      continue;
    }
    out.pages++;
    const c = pageContacts(page.body, page.url);
    out.email ??= c.email; out.phone ??= c.phone;
    // A contact page found on the way is read next, ahead of the guesses.
    if (c.contactUrl && !tried.has(flatUrl(c.contactUrl))) { out.contactUrl ??= c.contactUrl; queue.unshift(c.contactUrl); }
  }
  return out;
}

/** The confidence of one lead, by rule. HIGH only when the exact number was really seen on the page. */
export function grade(l: { match: string; sellerKind: string; checked: string | null; aiFetched: boolean; linkKnown: boolean | null }): { confidence: Confidence; reasons: Reason[] } {
  const reasons: Reason[] = [];
  let c: Confidence;
  if (l.match === "SELLER_ONLY") { c = "LOW"; reasons.push("SELLER_ONLY"); }
  else if (l.checked === "SEEN") { c = "HIGH"; reasons.push("PAGE_SEEN"); }
  else if (l.match === "EXACT" && l.aiFetched) { c = l.checked === "NOT_SEEN" ? "MEDIUM" : "HIGH"; reasons.push("AI_READ_PAGE"); }
  else if (l.match === "EXACT") { c = "MEDIUM"; reasons.push("AI_SNIPPET"); }
  else { c = l.aiFetched ? "MEDIUM" : "LOW"; reasons.push("LIKELY"); }
  if (l.checked === "NOT_SEEN" && l.match !== "SELLER_ONLY") reasons.push("PAGE_NOT_SEEN");
  // A link that was not among the results the search returned may be made up: it never ranks above low.
  if (l.linkKnown === false) { c = "LOW"; reasons.push("LINK_UNKNOWN"); }
  if (l.sellerKind === "MANUFACTURER" || l.sellerKind === "AUTHORIZED") reasons.push("OFFICIAL");
  return { confidence: c, reasons };
}

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/** Runs one search to the end and stores its result. Never throws: a failure is written on the search itself. */
export async function runHunt(id: string): Promise<void> {
  const hunt = await db.webHunt.findUnique({ where: { id } });
  if (!hunt || hunt.status !== "RUNNING") return;
  const fail = (code: string, note?: string) => db.webHunt.update({ where: { id }, data: { status: "FAILED", failCode: code, failNote: note?.slice(0, 300) ?? null, finishedAt: new Date() } }).then(() => {}, () => {});
  try {
    const answers = (hunt.answers ?? {}) as HuntAnswers;
    const part = hunt.partId ? await db.part.findUnique({ where: { id: hunt.partId }, select: { mpn: true, name: true, brand: true, aliases: { where: { kind: { not: "NAME" } }, take: 8, select: { code: true } } } }) : null;
    const known = part ? [`${part.mpn}: ${part.name}`, part.brand ? `brand ${part.brand}` : "", part.aliases.length ? `also known as ${part.aliases.map((a) => a.code).join(", ")}` : ""].filter(Boolean) : [];
    const out = await aiResearch<AiReport>({
      feature: HUNT_FEATURE, userName: hunt.userName, system: SYSTEM, prompt: prompt(hunt.query, answers, known, hunt.lang),
      report: { name: "report_sources", description: "Hand the sellers found for this piece back to the buyer's system. Call it exactly once, when the search is finished.", schema: REPORT_SCHEMA },
      maxSearches: 8, maxFetches: 6,
    });
    const r = out.report;
    const understood: Understood = {
      partNumber: s(r?.understood?.partNumber, 80), brand: s(r?.understood?.brand, 80), what: s(r?.understood?.what, 300) ?? "",
      alternates: (Array.isArray(r?.alternates) ? r.alternates : []).map((a) => ({ code: s(a?.code, 80) ?? "", note: s(a?.note, 200) ?? "" })).filter((a) => a.code).slice(0, 8),
    };
    // The numbers SOLU itself looks for on each page: what the AI understood, the code-like words typed, the catalog's.
    const typed = hunt.query.split(/\s+/).filter((w) => /\d/.test(w)).map(partKey);
    const keys = [...new Set([understood.partNumber ? partKey(understood.partNumber) : "", ...typed, ...(hunt.partId ? await partKeys(hunt.partId).catch(() => []) : [])].filter((k) => k.length >= 4))];
    const searchSet = new Set(out.searchUrls.map(flatUrl)), fetchSet = new Set(out.fetchedUrls.map(flatUrl));
    const hostSet = new Set([...out.searchUrls, ...out.fetchedUrls].map((u) => { try { return hostOf(new URL(u)); } catch { return ""; } }));
    const canTell = searchSet.size + fetchSet.size > 0;

    const seen = new Set<string>();
    const cleaned = (Array.isArray(r?.sources) ? r.sources : []).flatMap((x) => {
      const u = httpUrl(x?.productUrl); const seller = s(x?.seller, 120);
      if (!u || !seller) return [];
      const key = flatUrl(u.toString());
      if (seen.has(key)) return [];
      seen.add(key);
      const match = x.match === "EXACT" || x.match === "LIKELY" ? x.match : "SELLER_ONLY";
      const contact = httpUrl(x.contactUrl);
      return [{
        seller, sellerKind: (SELLER_KINDS as readonly string[]).includes(x.sellerKind) ? x.sellerKind : "OTHER", country: s(x.country, 60),
        url: u.toString().slice(0, 1000), host: hostOf(u), match, mpnSeen: s(x.partNumberShown, 80), evidence: s(x.evidence, 400),
        price: typeof x.price === "number" && Number.isFinite(x.price) && x.price > 0 && x.price < 1e10 ? x.price : null,
        currency: /^[A-Za-z]{3}$/.test(x.currency ?? "") ? x.currency!.toUpperCase() : null,
        availability: s(x.availability, 160), condition: ["NEW", "REFURBISHED", "USED"].includes(x.condition) ? x.condition : null,
        email: emailOf(x.email), phone: phoneOf(x.phone), contactUrl: contact ? contact.toString().slice(0, 500) : null, note: s(x.note, 400),
        aiFetched: fetchSet.has(key), linkKnown: canTell ? searchSet.has(key) || fetchSet.has(key) || hostSet.has(hostOf(u)) : null,
      }];
    }).slice(0, 12);

    // SOLU's own look at each page (all at once, each bounded): is the number there, and what contact does it show?
    const checks = await Promise.all(cleaned.map((l) => withTimeout((async () => {
      const page = await politeFetch(l.url, { accept: /html|xml|text\/plain/i, maxBytes: 2 * 1024 * 1024 });
      if (!page.ok) return { checked: "CLOSED", why: page.fail as string, facts: null, contacts: null };
      const facts = keys.length ? pageFacts(page.body, page.url, keys) : null;
      return { checked: facts?.matched ? "SEEN" : "NOT_SEEN", why: null as string | null, facts, contacts: pageContacts(page.body, page.url) as { email: string | null; phone: string | null; contactUrl: string | null } | null };
    })().catch(() => ({ checked: "CLOSED", why: "NETWORK", facts: null, contacts: null })), 30_000, { checked: "CLOSED", why: "TIMEOUT", facts: null, contacts: null })));
    // No email yet (from the AI or from the product page): look on the seller's contact and home pages too.
    await Promise.all(cleaned.map((l, n) => withTimeout((async () => {
      const ck = checks[n];
      if (l.email || ck.contacts?.email || ck.why === "ROBOTS" || ck.why === "BLOCKED" || ck.why === "PRIVATE") return;
      const sc = await siteContacts(l.url, l.contactUrl ?? ck.contacts?.contactUrl);
      ck.contacts = { email: sc.email, phone: ck.contacts?.phone ?? sc.phone, contactUrl: ck.contacts?.contactUrl ?? sc.contactUrl };
    })().catch(() => {}), 40_000, undefined)));

    const rank: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const leads = cleaned.map((l, n) => {
      const ck = checks[n];
      const g = grade({ match: l.match, sellerKind: l.sellerKind, checked: ck.checked, aiFetched: l.aiFetched, linkKnown: l.linkKnown });
      const fromPage = !l.email && !l.phone && !!(ck.contacts?.email || ck.contacts?.phone || (!l.contactUrl && ck.contacts?.contactUrl));
      const { aiFetched: _a, ...rest } = l; void _a;
      return {
        ...rest, confidence: g.confidence, reasons: g.reasons as string[], checked: ck.checked, checkedWhy: ck.why,
        title: ck.facts?.title ?? null, mpnSeen: (ck.checked === "SEEN" ? ck.facts?.mpnSeen : null) ?? l.mpnSeen,
        // The page's own figures fill what the AI left empty; they never overwrite what it read.
        price: l.price ?? (ck.checked === "SEEN" ? ck.facts?.price ?? null : null), currency: l.currency ?? (ck.checked === "SEEN" && !l.price ? ck.facts?.currency ?? null : null),
        email: l.email ?? ck.contacts?.email ?? null, phone: l.phone ?? ck.contacts?.phone ?? null, contactUrl: l.contactUrl ?? ck.contacts?.contactUrl ?? null,
        contactFrom: fromPage ? "PAGE" : l.email || l.phone || l.contactUrl ? "AI" : null,
      };
    }).sort((a, b) => rank[a.confidence as Confidence] - rank[b.confidence as Confidence] || Number(b.reasons.includes("OFFICIAL")) - Number(a.reasons.includes("OFFICIAL")) || Number(!!b.price) - Number(!!a.price));

    await db.$transaction([
      db.webLead.createMany({ data: leads.map((l, n) => ({ ...l, huntId: id, position: n })) }),
      db.webHunt.update({ where: { id }, data: {
        status: "DONE", finishedAt: new Date(), understood, summary: s(r?.summary, 800),
        questions: (Array.isArray(r?.questions) ? r.questions : []).map((q) => s(q, 200)).filter(Boolean).slice(0, 3) as string[],
        searches: out.searches, costUsd: out.costUsd.toFixed(5),
      } }),
    ]);
  } catch (e) {
    await fail(e instanceof AiError ? e.code : "ERROR", e instanceof Error && e.message !== (e as AiError).code ? e.message : undefined);
  }
}

/** Starts the search behind the response, so the person sees the "searching…" page at once. */
export function launchHunt(id: string) {
  after(() => runHunt(id));
}

/** The Needs a person can save a found seller on: open ones they may edit, the most recently touched first. */
export async function needsToSaveOn(user: { id: string; role: string; covering?: string[] }) {
  const all = user.role === "GERENCIA" || user.role === "DIRECTOR_COMERCIAL";
  const rows = await db.deal.findMany({
    where: { internal: false, closedAt: null, stage: { not: "LOST" }, ...(all ? {} : { ownerId: { in: [user.id, ...(user.covering ?? [])] } }) },
    orderBy: { updatedAt: "desc" }, take: 120, select: { id: true, code: true, title: true, account: { select: { name: true } } },
  });
  return rows.map((d) => ({ id: d.id, label: `${d.code ?? ""} · ${d.title} (${d.account.name})`.replace(/^ · /, "").slice(0, 110) }));
}

/** When each of these sellers was last written to from SOLU (the price-request email), by lead id. */
export async function leadsMailedAt(ids: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!ids.length) return out;
  const rows = await db.outboundMail.findMany({ where: { refKind: "LEAD", refId: { in: ids }, status: { in: ["SENT", "UNCERTAIN"] } }, orderBy: { sentAt: "asc" }, select: { refId: true, sentAt: true } });
  for (const r of rows) if (r.sentAt) out.set(r.refId, r.sentAt);
  return out;
}

// ---------- words for the screen ----------
type T = (es: string, en: string) => string;
export const confidenceLabel = (c: string, t: T) => (c === "HIGH" ? t("Confianza alta", "High confidence") : c === "MEDIUM" ? t("Confianza media", "Medium confidence") : t("Confianza baja", "Low confidence"));
export const kindLabel = (k: string, t: T) => ({
  MANUFACTURER: t("Fabricante", "Manufacturer"), AUTHORIZED: t("Distribuidor autorizado", "Authorized distributor"), DISTRIBUTOR: t("Distribuidor", "Distributor"),
  MARKETPLACE: t("Tienda en línea de varios vendedores", "Multi-seller online store"), BROKER: t("Revendedor de excedentes u obsoletos", "Surplus or obsolete-parts reseller"), OTHER: t("Vendedor", "Seller"),
}[k] ?? t("Vendedor", "Seller"));
export const reasonText = (r: string, t: T) => ({
  PAGE_SEEN: t("SOLU abrió la página y vio allí este número de parte exacto.", "SOLU opened the page and saw this exact part number there."),
  AI_READ_PAGE: t("La IA abrió la página y leyó allí este número de parte exacto.", "The AI opened the page and read this exact part number there."),
  AI_SNIPPET: t("El número exacto aparece en el resultado del buscador, pero nadie abrió la página para confirmarlo.", "The exact number appears in the search result, but nobody opened the page to confirm it."),
  PAGE_NOT_SEEN: t("SOLU abrió la página y no encontró el número (algunas páginas lo cargan después): confírmalo tú en el enlace.", "SOLU opened the page and did not find the number (some pages load it later): confirm it yourself on the link."),
  LIKELY: t("La página muestra la pieza por marca y descripción, o un número con otra terminación: parece la misma, no está confirmado.", "The page shows the piece by brand and description, or a number with a different ending: it looks the same, not confirmed."),
  SELLER_ONLY: t("El vendedor maneja esta marca o este tipo de pieza, pero no se vio esta pieza publicada: hay que preguntarle.", "The seller carries this brand or kind of piece, but this piece was not seen listed: they have to be asked."),
  LINK_UNKNOWN: t("El enlace no estaba entre los resultados que devolvió el buscador: ábrelo y compruébalo antes de confiar.", "The link was not among the results the search returned: open it and check before relying on it."),
  OFFICIAL: t("Es el fabricante o un distribuidor autorizado.", "It is the manufacturer or an authorized distributor."),
}[r] ?? r);
export const closedText = (why: string | null, t: T) => ({
  ROBOTS: t("el sitio no permite lectura automática", "the site does not allow automated reading"),
  BLOCKED: t("los términos del sitio no permiten lectura automática", "the site's terms do not allow automated reading"),
  TIMEOUT: t("el sitio tardó demasiado", "the site took too long"),
  HTTP: t("el sitio rechaza a los lectores automáticos", "the site turns automated readers away"),
  TYPE: t("el enlace es un archivo, por ejemplo un PDF, no una página", "the link is a file, for example a PDF, not a page"),
  NETWORK: t("el sitio no respondió", "the site did not answer"),
}[why ?? ""] ?? t("no se pudo abrir", "it could not be opened"));
/** What to tell the person after they typed, or asked SOLU to look for, a seller's contact. */
export function contactNote(ok: string | undefined, err: string | undefined, n: string | undefined, t: T): { good: boolean; text: string } | null {
  if (ok === "contacto") return { good: true, text: t("Contacto guardado en ese vendedor.", "Contact saved on that seller.") };
  if (ok === "contacto-hallado") return { good: true, text: t("SOLU encontró el contacto en el sitio del vendedor y lo guardó. Compruébalo antes de escribirle.", "SOLU found the contact on the seller's site and saved it. Check it before writing to them.") };
  if (err === "contacto-vacio") return { good: false, text: t("Escribe el correo o el teléfono del vendedor antes de guardar.", "Type the seller's email or phone before saving.") };
  if (err === "contacto-correo") return { good: false, text: t("Ese correo no está bien escrito: revisa que tenga @ y el dominio. No se guardó.", "That email is not written correctly: check the @ and the domain. It was not saved.") };
  if (err === "contacto-cerrado") return { good: false, text: t("El sitio de ese vendedor no deja que SOLU lo lea. Abre el «Enlace directo», busca su correo o teléfono y escríbelo en «Buscar o escribir el contacto».", "That seller's site does not let SOLU read it. Open the “Direct link”, look for their email or phone and type it under “Find or type the contact”.") };
  if (err === "contacto-nada") return { good: false, text: t(`SOLU abrió ${n ?? 0} página(s) del sitio de ese vendedor y no encontró un correo ni un teléfono escritos. Puede estar solo en un formulario: ábrelo en el «Enlace directo».`, `SOLU opened ${n ?? 0} page(s) of that seller's site and found no email or phone written there. They may only have a form: open it from the “Direct link”.`) };
  return null;
}

export const failText = (code: string | null, t: T) => ({
  OFF: t("La inteligencia artificial no está conectada.", "The AI is not connected."),
  CAP: t("Se alcanzó el tope mensual de la inteligencia artificial.", "The AI's monthly cap was reached."),
  AUTH: t("El servicio de IA rechazó la llave.", "The AI service rejected the key."),
  RATE: t("El servicio de IA está ocupado en este momento.", "The AI service is busy right now."),
  REFUSED: t("La IA no quiso hacer esta búsqueda.", "The AI declined this search."),
  BAD_OUTPUT: t("La IA buscó pero no entregó un resultado que se pueda leer.", "The AI searched but did not hand back a readable result."),
  STALE: t("La búsqueda se interrumpió antes de terminar.", "The search was cut off before finishing."),
}[code ?? ""] ?? t("La búsqueda no se pudo completar.", "The search could not be completed."));
