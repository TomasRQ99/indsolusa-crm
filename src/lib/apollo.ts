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
// SOLU keeps its own count of credits (ApolloUsage) and stops revealing at APOLLO_MONTHLY_CREDITS (default 50);
// Apollo's own count is the one that bills.

export const apolloConfigured = () => !!process.env.APOLLO_API_KEY;
/** Test-only override so automated tests talk to a fake Apollo. Never honoured in production. */
const base = () => (process.env.NODE_ENV !== "production" && process.env.APOLLO_API_BASE) || "https://api.apollo.io";
export const apolloMonthlyCap = () => {
  const v = Number(process.env.APOLLO_MONTHLY_CREDITS ?? "50");
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 50;
};

export async function apolloCreditsThisMonth() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const r = await db.apolloUsage.aggregate({ _sum: { credits: true }, where: { createdAt: { gte: from }, ok: true } });
  return r._sum.credits ?? 0;
}

/** Why Apollo did not answer, in words a person can act on. */
export type ApolloError = "off" | "key" | "plan" | "rate" | "cap" | "down" | "notfound";

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
export type PeopleResult = { ok: true; total: number; page: number; perPage: number; people: PersonHit[] } | { ok: false; error: ApolloError };

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
const errorOf = (status: number): ApolloError => (status === 401 ? "key" : status === 403 ? "plan" : status === 429 ? "rate" : "down");
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
      await db.apolloUsage.create({ data: { kind: "PEOPLE_SEARCH", ok: false, detail: `HTTP ${status}`, userName } });
      return { ok: false, error: errorOf(status) };
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
  if (!apolloConfigured()) return { ok: false, error: "off" };
  if ((await apolloCreditsThisMonth()) >= apolloMonthlyCap()) return { ok: false, error: "cap" };

  const p = new URLSearchParams({ id: apolloId, reveal_personal_emails: "false", reveal_phone_number: "false" });
  let status = 0, json: unknown = null;
  try {
    ({ status, json } = await call("/api/v1/people/match", p));
  } catch {
    // The call may or may not have reached Apollo: say so in the log, count nothing, and let the person try again.
    await db.apolloUsage.create({ data: { kind: "REVEAL", ok: false, detail: `sin respuesta · ${apolloId}`, userName: user.name } });
    return { ok: false, error: "down" };
  }
  if (status !== 200) {
    await db.apolloUsage.create({ data: { kind: "REVEAL", ok: false, detail: `HTTP ${status} · ${apolloId}`, userName: user.name } });
    return { ok: false, error: errorOf(status) };
  }
  const person = ((json ?? {}) as { person?: Record<string, unknown> | null }).person;
  if (!person || !str(person.first_name)) {
    await db.apolloUsage.create({ data: { kind: "REVEAL", credits: 0, detail: `sin datos · ${apolloId}`, userName: user.name } });
    return { ok: false, error: "notfound" };
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
