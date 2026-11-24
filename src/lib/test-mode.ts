// Modo prueba. Each person chooses in Mi perfil whether they see test information: the sample data ("(ejemplo)")
// and the customers and suppliers the team marked as test, with everything that hangs from them (Needs, quotes,
// orders, invoices, payments, tasks…). Turning it off deletes nothing: the lists, counts and totals this person
// sees simply leave those records out, and turning it on brings them back exactly as they were.
//
// Used only by db.ts. The rule lives here, in one place, so no screen has to remember it:
//  - only list-type reads are narrowed (findMany, count, aggregate, groupBy). A record opened by its own link,
//    the checks made before saving and the numbering of documents always see everything, so a hidden test record
//    can never cause a repeated code.
//  - outside a signed-in request (background jobs, scripts) nothing is hidden.
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { SESSION_COOKIE, verifySessionToken } from "./session-token";

type Where = Record<string, unknown>;

const DEMO_DOMAIN = "@ejemplo.solu";
const DEMO_TAG = " (ejemplo)";

/** Where the test mark lives. */
const ROOT: Record<string, Where> = {
  Account: { isDemo: false, isTest: false },
  Supplier: { isDemo: false, isTest: false },
  User: { NOT: { email: { endsWith: DEMO_DOMAIN } } },
};

/** A link to a person hides the record only when the record is that person's own (their task, their plan), never
 *  because a sample person once approved or wrote something on a real record. */
const PERSON_KEYS = new Set(["userId", "ownerId", "assigneeId", "responsibleId", "aboutId"]);

/** Sample records that hang from no customer: they carry the "(ejemplo)" signature or a sample code. */
const SIGNED: Record<string, { field: string; ends?: string; starts?: string; equals?: string }[]> = {
  ProductFact: [{ field: "recordedByName", ends: DEMO_TAG }],
  ProductSignal: [{ field: "reportedByName", ends: DEMO_TAG }],
  ProductRelationship: [{ field: "recordedByName", ends: DEMO_TAG }],
  LogisticsObservation: [{ field: "recordedByName", ends: DEMO_TAG }],
  ImportExperience: [{ field: "recordedByName", ends: DEMO_TAG }],
  MarketSignal: [{ field: "capturedByName", ends: DEMO_TAG }],
  KnowledgeGap: [{ field: "createdByName", ends: DEMO_TAG }],
  WhiteSpace: [{ field: "createdByName", ends: DEMO_TAG }],
  FutureOpportunity: [{ field: "capturedByName", ends: DEMO_TAG }],
  Plant: [{ field: "capturedByName", ends: DEMO_TAG }],
  Scenario: [{ field: "createdByName", ends: DEMO_TAG }],
  StrategicPriority: [{ field: "createdByName", ends: DEMO_TAG }],
  ManagementDecision: [{ field: "code", starts: "DG-EJ-" }],
  RoleProfile: [{ field: "roleKey", equals: "negociador-comercial-ejemplo" }],
  ReadinessAssessment: [{ field: "roleKey", equals: "negociador-comercial-ejemplo" }],
  RoleGapReview: [{ field: "roleKey", equals: "negociador-comercial-ejemplo" }],
  RoleBackup: [{ field: "roleKey", equals: "negociador-comercial-ejemplo" }, { field: "setByName", ends: DEMO_TAG }],
};

const MAX_DEPTH = 5;

/** One "is not test" condition per model, derived from the data model: a record is test when what it belongs to
 *  is test. New tables are covered by themselves as long as they point to their customer, supplier or Need. */
function buildFilters(): Record<string, Where> {
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name as string, m]));
  type Rel = { name: string; type: string; key: string; required: boolean };
  const relsOf = (model: string): Rel[] =>
    (byName.get(model)?.fields ?? [])
      .filter((f) => f.kind === "object" && !f.isList && (f.relationFromFields?.length ?? 0) === 1 && f.type !== model)
      .map((f) => ({ name: f.name, type: f.type, key: f.relationFromFields![0], required: f.isRequired }))
      .filter((r) => r.type !== "User" || PERSON_KEYS.has(r.key));

  // Which models can be test at all: the marked ones and, step by step, whatever belongs to them.
  const carriers = new Set<string>([...Object.keys(ROOT), ...Object.keys(SIGNED)]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of models) if (!carriers.has(m.name) && relsOf(m.name).some((r) => carriers.has(r.type))) { carriers.add(m.name); grew = true; }
  }

  const signed = (model: string): Where[] =>
    (SIGNED[model] ?? []).map(({ field, ends, starts, equals }) => {
      const cond = equals !== undefined ? { [field]: equals } : { [field]: ends !== undefined ? { endsWith: ends } : { startsWith: starts } };
      const optional = !byName.get(model)?.fields.find((f) => f.name === field)?.isRequired;
      // NOT over an empty value answers "unknown" in SQL, which would hide the row: say it explicitly.
      return optional ? { OR: [{ [field]: null }, { NOT: cond }] } : { NOT: cond };
    });

  const build = (model: string, path: string[]): Where | null => {
    if (ROOT[model]) return ROOT[model];
    const parts: Where[] = signed(model);
    if (path.length < MAX_DEPTH) {
      const rels = relsOf(model).filter((r) => carriers.has(r.type) && !path.includes(r.type));
      // What a record belongs to (a required link to a Need, a quote, a customer) decides. Optional links are only
      // looked at when nothing is required; a direct link to a customer or supplier always counts (it costs little).
      const owners = rels.filter((r) => r.required && r.type !== "User");
      const use = owners.length ? rels.filter((r) => owners.includes(r) || r.type === "Account" || r.type === "Supplier") : rels;
      for (const r of use) {
        const inner = build(r.type, [...path, model]);
        if (!inner) continue;
        parts.push(r.required ? { [r.name]: inner } : { OR: [{ [r.key]: null }, { [r.name]: inner }] });
      }
    }
    return parts.length ? (parts.length === 1 ? parts[0] : { AND: parts }) : null;
  };

  const out: Record<string, Where> = {};
  for (const m of carriers) { const f = build(m, []); if (f) out[m] = f; }
  return out;
}

let filters: Record<string, Where> | null = null;
/** The "is not test" condition of a model, or nothing when the model can't hold test information. */
export function notTest(model: string): Where | null {
  filters ??= buildFilters();
  return filters[model] ?? null;
}
export function testFilters() { filters ??= buildFilters(); return filters; }

const NARROWED = new Set(["findMany", "count", "aggregate", "groupBy"]);

const everything = new AsyncLocalStorage<true>();
/** Runs a piece of work seeing test information whatever the person chose: loading or removing the sample data,
 *  and the screen where test information is marked. */
export function withTestData<T>(run: () => Promise<T>): Promise<T> {
  return everything.run(true, run);
}

const modes = new Map<string, { at: number; on: Promise<boolean> }>();
const tokens = new Map<string, { at: number; userId: string | null }>();
const MODE_TTL = 20_000;
const TOKEN_TTL = 60_000;

/** After the person changes the option in Mi perfil, the next screen already follows it. */
export function forgetTestMode(userId: string) {
  modes.delete(userId);
}

async function hidesTest(base: PrismaClient): Promise<boolean> {
  if (everything.getStore()) return false;
  let token: string | undefined;
  try {
    const { cookies } = await import("next/headers");
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch { return false; } // outside a request (jobs, scripts, seed)
  if (!token) return false;
  const now = Date.now();
  let t = tokens.get(token);
  if (!t || now - t.at > TOKEN_TTL) {
    if (tokens.size > 500) tokens.clear();
    t = { at: now, userId: await verifySessionToken(token) };
    tokens.set(token, t);
  }
  if (!t.userId) return false;
  let m = modes.get(t.userId);
  if (!m || now - m.at > MODE_TTL) {
    const id = t.userId;
    m = { at: now, on: base.user.findUnique({ where: { id }, select: { testMode: true } }).then((u) => u?.testMode !== false, () => true) };
    modes.set(id, m);
  }
  return !(await m.on);
}

/** The arguments of a read, narrowed when this person turned Modo prueba off. */
export async function narrowForTestMode(base: PrismaClient, model: string | undefined, operation: string, args: unknown): Promise<unknown> {
  if (!model || !NARROWED.has(operation)) return args;
  const f = notTest(model);
  if (!f || !(await hidesTest(base))) return args;
  const a = (args ?? {}) as { where?: Where };
  return { ...a, where: a.where && Object.keys(a.where).length ? { AND: [a.where, f] } : f };
}
