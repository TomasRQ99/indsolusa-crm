import { db } from "@/lib/db";

// Apollo (apollo.io) for "Explorar prospectos": find people by role and company, then reveal the ones worth it.
//
// Facts from Apollo's API reference (docs.apollo.io, read 2026-11-12):
// - People API Search  POST /api/v1/mixed_people/api_search   0 credits. Returns first name, a masked last name,
//   title, employer name and "has email" flags. Never an email.
// - People Enrichment  POST /api/v1/people/match              1 credit when it returns data (8 more for a mobile
//   phone, which SOLU never asks for). Returns the full name, work email, LinkedIn and the employer.
// - The key travels only in the x-api-key header. Parameters go in the query string, arrays as name[]=.
// The key lives only in the APOLLO_API_KEY environment variable (Render → Environment). Without it this is off.
// SOLU keeps its own count of credits (ApolloUsage) and stops revealing at APOLLO_MONTHLY_CREDITS (default 90, the free plan the company uses since 2026-11-12);
// Apollo's own count is the one that bills.

export const apolloConfigured = () => !!process.env.APOLLO_API_KEY;
/** Test-only override so automated tests talk to a fake Apollo. Never honoured in production. */
const base = () => (process.env.NODE_ENV !== "production" && process.env.APOLLO_API_BASE) || "https://api.apollo.io";
export const apolloMonthlyCap = () => {
  const v = Number(process.env.APOLLO_MONTHLY_CREDITS ?? "90");
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 90;
};

export async function apolloCreditsThisMonth() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const r = await db.apolloUsage.aggregate({ _sum: { credits: true }, where: { createdAt: { gte: from }, ok: true } });
  return r._sum.credits ?? 0;
}

/** Why Apollo did not answer, in words a person can act on. */
export type ApolloError = "off" | "key" | "plan" | "rate" | "cap" | "credits" | "down" | "notfound";

export const SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry"] as const;
export const SIZES = ["1,50", "51,200", "201,1000", "1001,5000", "5001,1000000"] as const;

export type PeopleFilters = {
  titles: string[];
  seniorities: string[];
  personLocations: string[];
  orgLocations: string[];
  domains: string[];
  keywords: string;
  sizes: string[];
  verifiedOnly: boolean;
  page: number;
};
export type PersonHit = { id: string; firstName: string; lastMasked: string; title: string | null; orgName: string | null; hasEmail: boolean; hasPhone: boolean; refreshedAt: string | null };
export type PeopleResult = { ok: true; total: number; page: number; perPage: number; people: PersonHit[] } | { ok: false; error: ApolloError; said?: string };

const PER_PAGE = 25;

async function call(path: string, params: URLSearchParams): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base()}${path}?${params}`, {
    method: "POST",
    headers: { "x-api-key": process.env.APOLLO_API_KEY ?? "", "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  let json: unknown = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
/** What Apollo itself wrote in an error answer, shortened. It is shown as Apollo's words, never as SOLU's. */
function saidBy(json: unknown): string {
  const j = (json ?? {}) as { error?: unknown; message?: unknown; error_details?: { message?: unknown } };
  const s = [j.error_details?.message, j.error, j.message].find((x) => typeof x === "string" && x.trim());
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}
const errorOf = (status: number, said = ""): ApolloError =>
  status === 401 ? "key" : status === 403 ? "plan" : status === 429 ? "rate" : status === 402 || /insufficient credit|out of credits|credit limit|not enough credits/i.test(said) ? "credits" : "down";
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Free search. Nothing is saved: these are Apollo's results, shown as they come. */
export async function searchPeople(f: PeopleFilters, userName: string): Promise<PeopleResult> {
  if (!apolloConfigured()) return { ok: false, error: "off" };
  const p = new URLSearchParams();
  for (const v of f.titles) p.append("person_titles[]", v);
  for (const v of f.seniorities) if ((SENIORITIES as readonly string[]).includes(v)) p.append("person_seniorities[]", v);
  for (const v of f.personLocations) p.append("person_locations[]", v);
  for (const v of f.orgLocations) p.append("organization_locations[]", v);
  for (const v of f.domains) p.append("q_organization_domains_list[]", v);
  for (const v of f.sizes) if ((SIZES as readonly string[]).includes(v)) p.append("organization_num_employees_ranges[]", v);
  if (f.keywords) p.set("q_keywords", f.keywords);
  if (f.verifiedOnly) p.append("contact_email_status[]", "verified");
  p.set("page", String(Math.max(1, Math.min(500, f.page))));
  p.set("per_page", String(PER_PAGE));
  try {
    const { status, json } = await call("/api/v1/mixed_people/api_search", p);
    if (status !== 200 || !json || typeof json !== "object") {
      const said = saidBy(json);
      await db.apolloUsage.create({ data: { kind: "PEOPLE_SEARCH", ok: false, detail: `HTTP ${status}${said ? ` · Apollo: ${said}` : ""}`, userName } });
      return { ok: false, error: errorOf(status, said), said };
    }
    const j = json as { total_entries?: number; pagination?: { total_entries?: number }; people?: Record<string, unknown>[] };
    const people: PersonHit[] = (Array.isArray(j.people) ? j.people : []).flatMap((x) => {
      const id = str(x.id);
      if (!id) return [];
      const org = (x.organization ?? {}) as Record<string, unknown>;
      return [{
        id, firstName: str(x.first_name) ?? "—", lastMasked: str(x.last_name_obfuscated) ?? "", title: str(x.title), orgName: str(org.name),
        hasEmail: x.has_email === true, hasPhone: typeof x.has_direct_phone === "string" && x.has_direct_phone.toLowerCase().startsWith("yes"), refreshedAt: str(x.last_refreshed_at),
      }];
    });
    await db.apolloUsage.create({ data: { kind: "PEOPLE_SEARCH", userName, detail: `${people.length} de ${j.total_entries ?? j.pagination?.total_entries ?? people.length}` } });
    return { ok: true, total: Number(j.total_entries ?? j.pagination?.total_entries ?? people.length), page: f.page, perPage: PER_PAGE, people };
  } catch {
    return { ok: false, error: "down" };
  }
}

export type RevealResult = { ok: true; prospectId: string; fresh: boolean } | { ok: false; error: ApolloError };

/**
 * Reveal one person: full name, work email, LinkedIn and employer. Costs 1 Apollo credit the first time.
 * Never asks for personal emails or phone numbers. A person already revealed is read from SOLU, at no cost.
 */
export async function revealPerson(apolloId: string, foundWith: string, user: { id: string; name: string }): Promise<RevealResult> {
  const known = await db.prospect.findUnique({ where: { apolloId }, select: { id: true } });
  if (known) return { ok: true, prospectId: known.id, fresh: false };
  return matchAndSave(new URLSearchParams({ id: apolloId }), apolloId, foundWith, user);
}

/** What a person can give SOLU to find someone in Apollo without the search: a LinkedIn profile, or a name and a company. */
export type Clue = { linkedinUrl: string; firstName: string; lastName: string; org: string; domain: string };
export const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/^.*@/, "");
/** A clue is enough when it is a LinkedIn profile, or a full name with the company or its website. */
export const clueEnough = (c: Clue) => /linkedin\.com\/in\//i.test(c.linkedinUrl) || (!!c.firstName && !!c.lastName && (!!c.org || !!c.domain));

/**
 * Reveal a person the user already found somewhere else (Apollo's website, LinkedIn, a business card).
 * Same cost and same rules as revealing from a search: 1 credit when Apollo returns data, never phones or personal emails.
 */
export async function revealByClue(c: Clue, user: { id: string; name: string }): Promise<RevealResult> {
  if (!clueEnough(c)) return { ok: false, error: "notfound" };
  const linkedin = /linkedin\.com\/in\//i.test(c.linkedinUrl) ? c.linkedinUrl.trim().split(/[?#]/)[0].replace(/\/+$/, "") : "";
  // Already revealed? Then it is read from SOLU and nothing is spent.
  if (linkedin) {
    const slug = linkedin.split("/in/")[1]?.toLowerCase();
    const known = slug ? await db.prospect.findFirst({ where: { linkedinUrl: { contains: `/in/${slug}`, mode: "insensitive" } }, select: { id: true } }) : null;
    if (known) return { ok: true, prospectId: known.id, fresh: false };
  }
  const p = new URLSearchParams();
  if (linkedin) p.set("linkedin_url", linkedin);
  if (c.firstName) p.set("first_name", c.firstName);
  if (c.lastName) p.set("last_name", c.lastName);
  if (c.org) p.set("organization_name", c.org);
  if (c.domain) p.set("domain", cleanDomain(c.domain));
  const how = linkedin ? "perfil de LinkedIn" : `nombre y empresa: ${[c.firstName, c.lastName].join(" ")} · ${c.org || cleanDomain(c.domain)}`;
  return matchAndSave(p, linkedin || `${c.firstName} ${c.lastName}`.trim(), `Escrito a mano · ${how}`, user);
}

async function matchAndSave(p: URLSearchParams, tag: string, foundWith: string, user: { id: string; name: string }): Promise<RevealResult> {
  if (!apolloConfigured()) return { ok: false, error: "off" };
  if ((await apolloCreditsThisMonth()) >= apolloMonthlyCap()) return { ok: false, error: "cap" };
  p.set("reveal_personal_emails", "false");
  p.set("reveal_phone_number", "false");
  let status = 0, json: unknown = null;
  try {
    ({ status, json } = await call("/api/v1/people/match", p));
  } catch {
    // The call may or may not have reached Apollo: say so in the log, count nothing, and let the person try again.
    await db.apolloUsage.create({ data: { kind: "REVEAL", ok: false, detail: `sin respuesta · ${tag}`, userName: user.name } });
    return { ok: false, error: "down" };
  }
  if (status !== 200) {
    const said = saidBy(json);
    await db.apolloUsage.create({ data: { kind: "REVEAL", ok: false, detail: `HTTP ${status} · ${tag}${said ? ` · Apollo: ${said}` : ""}`, userName: user.name } });
    return { ok: false, error: errorOf(status, said) };
  }
  const person = ((json ?? {}) as { person?: Record<string, unknown> | null }).person;
  if (!person || !str(person.first_name)) {
    await db.apolloUsage.create({ data: { kind: "REVEAL", credits: 0, detail: `sin datos · ${tag}`, userName: user.name } });
    return { ok: false, error: "notfound" };
  }
  const apolloId = str(person.id) ?? p.get("id");
  if (!apolloId) return { ok: false, error: "notfound" };
  // Found by a clue, and it turns out this person was already revealed: keep the one row. Apollo was asked, so the credit is counted.
  const already = await db.prospect.findUnique({ where: { apolloId }, select: { id: true } });
  if (already) {
    await db.apolloUsage.create({ data: { kind: "REVEAL", credits: 1, detail: `${apolloId} · ya estaba`, userName: user.name } });
    return { ok: true, prospectId: already.id, fresh: false };
  }
  const org = (person.organization ?? {}) as Record<string, unknown>;
  const email = str(person.email);
  // Apollo hides an email it cannot show with a placeholder address; that is not an email.
  const realEmail = email && !/^email_not_unlocked@/i.test(email) ? email : null;
  const employees = Number(org.estimated_num_employees);
  const saved = await db.$transaction(async (tx) => {
    const row = await tx.prospect.create({
      data: {
        apolloId, firstName: str(person.first_name)!, lastName: str(person.last_name) ?? "", title: str(person.title), email: realEmail, emailStatus: str(person.email_status),
        linkedinUrl: str(person.linkedin_url), city: str(person.city), state: str(person.state), country: str(person.country),
        orgName: str(org.name), orgDomain: str(org.primary_domain), orgWebsite: str(org.website_url), orgIndustry: str(org.industry),
        orgEmployees: Number.isFinite(employees) && employees > 0 ? Math.round(employees) : null,
        foundWith: foundWith.slice(0, 300) || null, credits: 1, revealedById: user.id, revealedByName: user.name,
      },
      select: { id: true },
    });
    await tx.apolloUsage.create({ data: { kind: "REVEAL", credits: 1, detail: apolloId, userName: user.name } });
    return row;
  });
  return { ok: true, prospectId: saved.id, fresh: true };
}

export type Probe = { search: "ok" | ApolloError; reveal: "ok" | ApolloError; said: string };

/**
 * Asks Apollo, at no cost, which of the two functions this account may use: one search for a single result,
 * and one reveal of a person that does not exist (Apollo charges nothing when it returns no data).
 */
export async function probeApollo(userName: string): Promise<Probe> {
  if (!apolloConfigured()) return { search: "off", reveal: "off", said: "" };
  const one = async (path: string, p: URLSearchParams, okWhen: (j: unknown) => boolean, lenient = false): Promise<["ok" | ApolloError, string]> => {
    try {
      const { status, json } = await call(path, p);
      if (status === 200 && okWhen(json)) return ["ok", ""];
      // "That person does not exist" (404 or 422) still means Apollo let the call through.
      if (lenient && (status === 404 || status === 422) && errorOf(status, saidBy(json)) === "down") return ["ok", ""];
      const said = saidBy(json);
      return [status === 200 ? "down" : errorOf(status, said), said];
    } catch { return ["down", ""]; }
  };
  const [search, s1] = await one("/api/v1/mixed_people/api_search", new URLSearchParams({ q_keywords: "manager", page: "1", per_page: "1" }), (j) => !!j && typeof j === "object");
  const [reveal, s2] = await one("/api/v1/people/match", new URLSearchParams({ id: "000000000000000000000000", reveal_personal_emails: "false", reveal_phone_number: "false" }), (j) => !!j && typeof j === "object", true);
  await db.apolloUsage.create({ data: { kind: "PROBE", ok: search === "ok" || reveal === "ok", detail: `buscar: ${search} · revelar: ${reveal}${s1 || s2 ? ` · Apollo: ${s1 || s2}` : ""}`, userName } });
  return { search, reveal, said: [s1, s2].filter(Boolean).filter((x, k, a) => a.indexOf(x) === k).join(" / ") };
}

/** Reads the search form. Lists are written with commas. */
export function filtersFrom(sp: Record<string, string | string[] | undefined>): PeopleFilters {
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  const many = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.trim()).filter(Boolean); };
  const list = (k: string) => one(k).split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
  return {
    titles: list("cargos"), seniorities: many("nivel"), personLocations: list("donde"), orgLocations: list("sede"),
    domains: list("dominio").map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/^.*@/, "")),
    keywords: one("palabras").slice(0, 120), sizes: many("tam"), verifiedOnly: one("verificado") === "1", page: Math.max(1, Number(one("p")) || 1),
  };
}
export const hasCriteria = (f: PeopleFilters) => f.titles.length + f.seniorities.length + f.personLocations.length + f.orgLocations.length + f.domains.length + f.sizes.length > 0 || !!f.keywords;
/** The search in one line, kept with each revealed person so anyone can see why they were looked for. */
export const describeFilters = (f: PeopleFilters) => [f.titles.join(", "), f.seniorities.join(", "), f.personLocations.join(", "), f.orgLocations.length ? `sede ${f.orgLocations.join(", ")}` : "", f.domains.join(", "), f.keywords].filter(Boolean).join(" · ");
