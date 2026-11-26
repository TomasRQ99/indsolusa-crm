// Siigo Nube · reading invoicing for the commercial budget (spec §7: "La lectura de facturación desde Siigo Nube").
// Read-only: sales invoices and credit notes of a span of months, added up per customer (tax ID) and month, net of
// VAT and of credit notes. Nothing is saved here: the result goes to the same review a pasted file goes through
// (Presupuesto comercial → Historial), where a person sees it before it counts.
//
// It is OFF until the company's Siigo credentials are in the server's environment (never typed into SOLU):
//   SIIGO_USERNAME, SIIGO_ACCESS_KEY, and optionally SIIGO_PARTNER_ID (default "SOLU") and SIIGO_BASE_URL.
//
// NOT YET RUN AGAINST A REAL SIIGO ACCOUNT. Written from Siigo's public documentation (developers.siigo.com) for the
// document fields, the Partner-Id header, the 24-hour token, the 100 requests per minute limit and the error body.
// The token request and the list parameters could not be read there and follow Siigo's commonly published usage:
// POST /auth {username, access_key} → {access_token}; GET /v1/invoices?date_start&date_end&page&page_size →
// {pagination:{total_results}, results:[…]}. Because of that the code never trusts the date filter: every document
// is checked again against the span by its own date, and the first real run must be read with care.

export type SiigoError = "OFF" | "AUTH" | "RATE" | "API" | "SHAPE";
export class SiigoFail extends Error { constructor(public code: SiigoError, message?: string) { super(message ?? code); } }

const env = (k: string) => (process.env[k] ?? "").trim();
export const siigoConfigured = () => !!env("SIIGO_USERNAME") && !!env("SIIGO_ACCESS_KEY");
const base = () => (env("SIIGO_BASE_URL") || "https://api.siigo.com").replace(/\/+$/, "");
const partner = () => (env("SIIGO_PARTNER_ID") || "SOLU").replace(/[^A-Za-z0-9]/g, "").slice(0, 100) || "SOLU";

let token: { value: string; until: number; bearer: boolean } | null = null;
export const forgetSiigoToken = () => { token = null; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getToken(): Promise<NonNullable<typeof token>> {
  if (token && token.until > Date.now()) return token;
  if (!siigoConfigured()) throw new SiigoFail("OFF");
  let res: Response;
  try { res = await fetch(`${base()}/auth`, { method: "POST", headers: { "Content-Type": "application/json", "Partner-Id": partner() }, body: JSON.stringify({ username: env("SIIGO_USERNAME"), access_key: env("SIIGO_ACCESS_KEY") }), signal: AbortSignal.timeout(30000), cache: "no-store" }); }
  catch (e) { throw new SiigoFail("API", e instanceof Error ? e.message : "network"); }
  if (res.status === 401 || res.status === 403 || res.status === 400) throw new SiigoFail("AUTH", `HTTP ${res.status}`);
  if (!res.ok) throw new SiigoFail("API", `HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!body || typeof body.access_token !== "string" || !body.access_token) throw new SiigoFail("SHAPE", "no access_token");
  // Siigo's token lasts 24 hours; it is asked again well before that.
  token = { value: body.access_token, until: Date.now() + 20 * 3600e3, bearer: true };
  return token;
}

async function getPage(path: string, qs: Record<string, string>): Promise<{ results: unknown[]; total: number | null }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const tk = await getToken();
    let res: Response;
    try { res = await fetch(`${base()}${path}?${new URLSearchParams(qs)}`, { headers: { Authorization: tk.bearer ? `Bearer ${tk.value}` : tk.value, "Content-Type": "application/json", "Partner-Id": partner() }, signal: AbortSignal.timeout(60000), cache: "no-store" }); }
    catch (e) { throw new SiigoFail("API", e instanceof Error ? e.message : "network"); }
    if (res.status === 429) { await sleep(1500 * 2 ** attempt); continue; } // 100 requests per minute: wait and try again
    if (res.status === 401) {
      // The documentation shows the token alone in the header; most clients send it as "Bearer". Try the other once.
      if (attempt === 0 && tk.bearer) { tk.bearer = false; continue; }
      forgetSiigoToken();
      throw new SiigoFail("AUTH", "HTTP 401");
    }
    if (!res.ok) throw new SiigoFail("API", `HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { results?: unknown; pagination?: { total_results?: unknown } } | null;
    if (!body || !Array.isArray(body.results)) throw new SiigoFail("SHAPE", "no results list");
    const total = Number(body.pagination?.total_results);
    return { results: body.results, total: Number.isFinite(total) ? total : null };
  }
  throw new SiigoFail("RATE");
}

const PAGE = 100, MAX_PAGES = 300;
async function listAll(path: string, from: string, to: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { results, total } = await getPage(path, { date_start: from, date_end: to, page: String(page), page_size: String(PAGE) });
    out.push(...results);
    if (!results.length || results.length < PAGE || (total != null && out.length >= total)) break;
  }
  return out;
}

type Doc = { date: string; nit: string; cop: number; annulled: boolean; name: string };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
/** One Siigo document as SOLU reads it: its date, the customer's tax ID and its value before VAT, in pesos. */
export function readSiigoDoc(raw: unknown): Doc | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const date = typeof d.date === "string" ? d.date.slice(0, 10).replace(/\//g, "-") : "";
  const customer = (d.customer ?? {}) as Record<string, unknown>;
  const nit = String(customer.identification ?? "").replace(/\D/g, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !nit) return null;
  // Before VAT: each line's quantity × price less its discount. Only when a document brings no lines is its total
  // used (and that total may include taxes: such documents are rare and show in the review as they are).
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  let value = 0, lines = 0;
  for (const it of items) {
    const q = num(it.quantity), p = num(it.price);
    if (q == null || p == null) continue;
    const disc = num((it.discount as Record<string, unknown> | undefined)?.value) ?? 0;
    value += q * p - disc; lines++;
  }
  if (!lines) value = num(d.total) ?? 0;
  const cur = (d.currency ?? {}) as Record<string, unknown>;
  const rate = num(cur.exchange_rate);
  const foreign = typeof cur.code === "string" && cur.code.toUpperCase() !== "COP" && rate != null && rate > 0;
  return { date, nit, cop: Math.round(foreign ? value * rate! : value), annulled: d.annulled === true, name: String(d.name ?? "") };
}

export type SiigoMonth = { nit: string; month: string; cop: number; invoices: number; creditNotes: number };
export type SiigoPull = { rows: SiigoMonth[]; invoices: number; creditNotes: number; annulled: number; outOfSpan: number; unreadable: number };

/** Invoicing per customer and month between two months (YYYY-MM, both included), net of credit notes. */
export async function pullSiigo(fromMonth: string, toMonth: string): Promise<SiigoPull> {
  if (!siigoConfigured()) throw new SiigoFail("OFF");
  const [ty, tm] = toMonth.split("-").map(Number);
  const from = `${fromMonth}-01`, to = `${toMonth}-${String(new Date(Date.UTC(ty, tm, 0)).getUTCDate()).padStart(2, "0")}`;
  const [inv, cn] = [await listAll("/v1/invoices", from, to), await listAll("/v1/credit-notes", from, to)];
  const by = new Map<string, SiigoMonth>();
  const out: SiigoPull = { rows: [], invoices: 0, creditNotes: 0, annulled: 0, outOfSpan: 0, unreadable: 0 };
  const take = (raw: unknown, sign: 1 | -1) => {
    const d = readSiigoDoc(raw);
    if (!d) { out.unreadable++; return; }
    if (d.annulled) { out.annulled++; return; }
    if (d.date < from || d.date > to) { out.outOfSpan++; return; }
    const k = `${d.nit}|${d.date.slice(0, 7)}`;
    const g = by.get(k) ?? { nit: d.nit, month: d.date.slice(0, 7), cop: 0, invoices: 0, creditNotes: 0 };
    g.cop += sign * d.cop;
    if (sign === 1) { g.invoices++; out.invoices++; } else { g.creditNotes++; out.creditNotes++; }
    by.set(k, g);
  };
  for (const x of inv) take(x, 1);
  for (const x of cn) take(x, -1);
  out.rows = [...by.values()].sort((a, b) => (a.month + a.nit < b.month + b.nit ? -1 : 1));
  return out;
}

/** The pull as the rows the Historial review reads (same headings as the Siigo template). */
export const siigoAsRows = (p: SiigoPull) => ["NIT\tAño\tMes\tFacturación (valor)", ...p.rows.map((r) => `${r.nit}\t${r.month.slice(0, 4)}\t${Number(r.month.slice(5))}\t${r.cop}`)].join("\n");
