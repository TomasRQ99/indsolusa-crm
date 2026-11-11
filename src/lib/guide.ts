// On-screen guide. A person types what they need in the search bar ("hacer factura", "make invoice")
// and SOLU answers with where it starts and how to get there, step by step, on the screen itself.
//
// The words come from the team's "Guía de campo" (src/lib/guide-data.json, refreshed with
// scripts/guide-sync.mjs), so the guide on screen and the training page never say different things.
// Nothing here is AI: matching is plain words, and every step is text a person wrote.
import data from "./guide-data.json";
import { MODULES, NAV_GROUPS, type ModuleKey, type NavTab } from "./nav";
import { boardMayOpen, canManageAll, isBoard, isGerencia } from "./permissions";

type Feature = { id: string; m: string; t: string; path: string; why: string; steps: string[]; expect: string };
type U = { role: string; lang: "ES" | "EN" } & Parameters<typeof canManageAll>[0];

export type GuideStage = {
  id: string;
  title: string;
  /** Where it lives, as the Guía de campo writes it: "ADMINISTRACIÓN → Dinero → Cuentas por cobrar". */
  path: string;
  /** Names to click on the way there (module, group, tab), in the person's language when SOLU knows them. */
  way: string[];
  why: string;
  /** A button named in a step is written [[Button]]. */
  steps: string[];
  expect: string;
  mod: ModuleKey | null;
  /** Screen where this stage starts; null = it is on every screen (top bar). */
  href: string | null;
  /** The stage happens inside one Journey: the person opens the one they want to move. */
  needsJourney: boolean;
  /** The person's role does not open that screen: someone else does this part. */
  locked: boolean;
  also: { label: string; href: string }[];
};
export type Guide = { id: string; title: string; route: boolean; stages: GuideStage[] };
export type GuideMatch = { id: string; title: string; path: string; why: string; mod: ModuleKey | null; routeLen: number; routeTitle: string | null };

const FEATURES = data.features as Feature[];
const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

/** The life of an order, in the order it happens. Asking for a late stage offers the whole way to it. */
const LIFE = ["journeys-board", "need-source", "quote", "po", "compras", "logistica", "ops-despachos", "facturacion", "cobrar", "resultado"];
/** Screens that are another door to a stage of the life of an order. */
const SAME_STAGE: Record<string, string> = { "por-facturar": "facturacion", remisiones: "facturacion", "pagos-recibidos": "cobrar", despacho: "ops-despachos", "sin-despachar": "ops-despachos", "ops-negociacion": "compras", "ops-requerimientos": "compras" };
/** Lists where the cases that already reached a stage are waiting. */
const ALSO: Record<string, string[]> = { facturacion: ["por-facturar"], cobrar: ["pagos-recibidos"], "ops-despachos": ["sin-despachar"], compras: ["ops-requerimientos"] };
/** Where a stage starts when its path in the Guía de campo is not a menu path. */
const START: Record<string, { href: string | null; needsJourney?: boolean; way?: string[] }> = {
  po: { href: "/deals", needsJourney: true, way: ["Cotización"] },
  search: { href: null }, ask: { href: null }, "bell-lang": { href: null },
};

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

function tabVisible(tab: NavTab, user: U) {
  return (!tab.managerOnly || canManageAll(user)) && (!tab.adminOnly || isGerencia(user)) && (!tab.roles || tab.roles.includes(user.role)) && (!isBoard(user) || boardMayOpen(tab.href));
}

/** Names the menu shows, Spanish (normalised) -> the person's language. */
function menuWords(lang: "ES" | "EN") {
  const m = new Map<string, string>();
  const put = (es: string, en: string) => m.set(norm(es), lang === "ES" ? es : en);
  for (const mod of MODULES) { put(mod.es, mod.en); for (const tab of mod.tabs) put(tab.es, tab.en); }
  for (const g of Object.values(NAV_GROUPS)) put(g.es, g.en);
  return m;
}

function stageOf(f: Feature, user: U): GuideStage {
  const words = menuWords(user.lang);
  // "A → B · C → D": the first way in is the one we follow. "(solo Gerencia)" is a note, not a name.
  const first = f.path.split(" · ")[0];
  const segs = first.split("→").map((s) => s.replace(/\([^)]*\)/g, "").trim()).filter(Boolean);
  const over = START[f.id];
  let href: string | null = null, needsJourney = false, locked = false;
  let mod: ModuleKey | null = (MODULES.find((x) => x.key === f.m)?.key ?? null) as ModuleKey | null;

  if (over) { href = over.href; needsJourney = !!over.needsJourney; }
  else if (norm(segs[0] ?? "") === "journey") { href = "/deals"; needsJourney = true; }
  else {
    const module_ = MODULES.find((x) => norm(x.es) === norm(segs[0] ?? "")) ?? MODULES.find((x) => x.key === f.m);
    if (module_) {
      mod = module_.key;
      let tab: NavTab | undefined;
      for (let k = segs.length - 1; k >= 1 && !tab; k--) tab = module_.tabs.find((x) => norm(x.es) === norm(segs[k]));
      const open = module_.tabs.filter((x) => tabVisible(x, user));
      if (tab) { href = tab.href; locked = !tabVisible(tab, user); }
      else if (open.length) href = open[0].href;
      else locked = true;
    }
  }
  if (needsJourney) mod = "comercial";

  const way = (over?.way ?? segs.flatMap((s) => s.split(" / ")))
    .map((s) => s.trim())
    .filter((s) => s && norm(s) !== "journey" && !/^(un|una|el|la)\s/i.test(s))
    .map((s) => words.get(norm(s)) ?? s);

  const also = (ALSO[f.id] ?? []).flatMap((id) => {
    const o = BY_ID.get(id);
    if (!o) return [];
    const s = stageOf({ ...o, id: `${o.id}#also` }, user);
    return s.href && !s.locked ? [{ label: o.t, href: s.href }] : [];
  });
  return { id: f.id, title: f.t, path: f.path, way, why: f.why, steps: f.steps, expect: f.expect, mod, href, needsJourney, locked, also };
}

function routeTo(id: string): string[] | null {
  const k = LIFE.indexOf(SAME_STAGE[id] ?? id);
  return k > 0 ? LIFE.slice(0, k + 1) : null;
}

/** One guide: a single function of the Guía de campo, or the whole way to it from the first need. */
export function getGuide(id: string, route: boolean, user: U): Guide | null {
  const f = BY_ID.get(id);
  if (!f) return null;
  const ids = route ? routeTo(id) : null;
  if (!ids) return { id, title: f.t, route: false, stages: [stageOf(f, user)] };
  const stages = ids.map((x) => stageOf(BY_ID.get(x)!, user));
  return { id, title: stages[stages.length - 1].title, route: true, stages };
}

// ---------- matching what the person typed ----------

// Words that carry no subject. "nuevo", "mi" and the like stay: they tell screens apart.
const STOP = new Set("a al algo and are as can como con create crear cual cuando de del do donde el en es esta este for get go hacer hago haz how i in is it la las lo los make me necesito need of on para por puedo que quiero se si the to un una uno want what where y yo".split(" "));

// English a person may type -> the Spanish the Guía de campo uses.
const EN_ES: Record<string, string> = {
  invoice: "factura", invoices: "factura", invoicing: "facturacion", bill: "factura", billing: "facturacion",
  quote: "cotizacion", quotes: "cotizacion", quotation: "cotizacion", customer: "cliente", customers: "cliente", client: "cliente", clients: "cliente",
  supplier: "proveedor", suppliers: "proveedor", vendor: "proveedor", vendors: "proveedor", payment: "pago", payments: "pago", pay: "pago", paid: "pago",
  shipment: "envio", shipments: "envio", shipping: "envio", ship: "envio", delivery: "entrega", deliver: "entrega", dispatch: "despacho",
  purchase: "compra", purchasing: "compra", buy: "compra", order: "orden", orders: "orden", collect: "cobrar", collection: "cobrar", receivable: "cobrar", receivables: "cobrar",
  payable: "pagar", payables: "pagar", bank: "banco", commission: "comision", commissions: "comision", report: "informe", reports: "informe", goal: "meta", goals: "meta",
  visit: "visita", visits: "visita", trip: "viaje", travel: "viaje", part: "repuesto", parts: "repuesto", spare: "repuesto", product: "producto", products: "producto",
  contact: "contacto", contacts: "contacto", email: "correo", mail: "correo", task: "pendiente", tasks: "pendiente", todo: "pendiente", calendar: "agenda", schedule: "agenda",
  margin: "esagara", profit: "rentabilidad", profitability: "rentabilidad", credit: "credito", limit: "cupo", warranty: "garantia", claim: "reclamo", customs: "aduana",
  freight: "flete", carrier: "transportador", carriers: "transportador", inventory: "inventario", stock: "inventario", budget: "presupuesto", asset: "activo", assets: "activo",
  contract: "contrato", contracts: "contrato", treasury: "tesoreria", cash: "caja", role: "rol", roles: "rol", team: "equipo", user: "persona", users: "persona", people: "persona",
  language: "idioma", search: "busqueda", decision: "decision", decisions: "decision", scenario: "escenario", policy: "politica", policies: "politica", close: "cierre",
  result: "resultado", source: "fuente", scope: "alcance", promise: "promesa", message: "mensaje", messages: "mensaje", call: "llamada", withholding: "retencion",
  receipt: "recepcion", receive: "recepcion", market: "mercado", company: "empresa", companies: "empresa", plan: "plan", today: "hoy", alert: "alerta", alerts: "alerta",
  accounting: "contabilidad", exception: "excepcion", approve: "aprobar", approval: "aprobar", reply: "respuesta", replies: "respuesta", profile: "perfil",
  development: "desarrollo", succession: "sucesion", talent: "talento", board: "junta", strategy: "estrategica", account: "cuenta", accounts: "cuenta", money: "dinero",
  note: "remision", po: "oc", rfq: "cotizacion", job: "trabajo", cost: "costo", costs: "costo", price: "precio", refund: "devolucion", recovery: "recovery",
};
// Other ways people name the same thing in Spanish.
const ES_ES: Record<string, string> = { pedido: "journey", pedidos: "journey", negocio: "journey", negocios: "journey", oportunidad: "journey", caso: "journey", casos: "journey", cartera: "cobrar", recaudo: "cobrar", margen: "esagara", utilidad: "esagara", vendedor: "negociador", despachar: "despacho", comprar: "compra", pagar: "pagar", orden: "oc", usuario: "persona", usuarios: "persona", calendario: "agenda", tarea: "pendiente", tareas: "pendiente", whatsapp: "comunicacion", reunion: "conversacion", viaticos: "viaje" };

/** "facturación", "facturar" and "facturas" are the same subject: compare the first letters. */
const stem = (w: string) => { const s = w.length > 4 ? w.replace(/(es|s)$/, "") : w; return s.length > 5 ? s.slice(0, 5) : s; };
const stems = (s: string) => new Set(norm(s).split(" ").filter(Boolean).map(stem));

const INDEX = FEATURES.map((f) => ({ f, title: stems(f.t), path: stems(f.path), id: stems(f.id.replace(/-/g, " ")), why: stems(f.why), steps: stems(f.steps.join(" ") + " " + f.expect) }));

/** Words that ask for training in general. Compared by their first letters, like everything else. */
const TRAINING = new Set(["entrenamiento", "entrenar", "training", "capacitacion", "tutorial", "tour", "guia", "guide", "ayuda", "help", "aprender", "learn", "empezar", "empiezo", "start", "modulos", "onboarding", "induccion"].map((w) => stem(w)));

/** Looks like a record (an invoice number, a Journey code, a tax ID): that is a search, not a question. */
const looksLikeRecord = (q: string) => /\d{3,}/.test(q) || /^[a-z]{1,3}-\d/i.test(q.trim());

function matchOf(f: Feature, user: U): GuideMatch | null {
  const st = stageOf(f, user);
  if (st.locked) return null;
  const route = routeTo(f.id);
  const end = route ? BY_ID.get(route[route.length - 1])! : null;
  return { id: f.id, title: f.t, path: f.path, why: f.why, mod: st.mod, routeLen: route?.length ?? 0, routeTitle: end && end.id !== f.id ? end.t : null };
}

/** The everyday work, in the order of a normal day: what a new person is offered before typing anything. */
const DAILY = ["midia-today", "comunicacion", "journeys-board", "quote", "compras", "logistica", "facturacion", "cobrar"];
export function starterGuides(user: U): GuideMatch[] {
  return DAILY.flatMap((id) => { const f = BY_ID.get(id); const m = f && matchOf(f, user); return m ? [m] : []; });
}

export function searchGuides(q: string, user: U, max = 4): GuideMatch[] {
  if (looksLikeRecord(q)) return [];
  const words = norm(q).split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map((w) => ES_ES[w] ?? EN_ES[w] ?? w);
  if (!words.length) return [];
  const want = [...new Set(words.map(stem))];

  const scored = INDEX.map((x) => {
    let score = 0, strong = 0, hit = 0;
    for (const w of want) {
      const s = (x.title.has(w) ? 5 : 0) + (x.path.has(w) ? 4 : 0) + (x.id.has(w) ? 2 : 0) + (x.why.has(w) ? 2 : 0) + (x.steps.has(w) ? 1 : 0);
      if (s) hit++;
      if (x.title.has(w) || x.path.has(w)) strong++;
      score += s;
    }
    // Every word the person typed should be about this function; a word that matches nothing costs.
    score -= (want.length - hit) * 3;
    if (LIFE.includes(x.f.id)) score += 2;
    return { x, score, strong };
  }).filter((r) => r.strong > 0 && r.score >= 5).sort((a, b) => b.score - a.score);

  // "entrenamiento", "ayuda", "cómo empiezo": the person asks for training itself, not for one subject.
  const asked = norm(q).split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  if (asked.some((w) => TRAINING.has(w)) && (!scored.length || asked.every((w) => TRAINING.has(w) || w === "solu"))) return starterGuides(user);

  const out: GuideMatch[] = [];
  for (const r of scored) {
    const m = matchOf(r.x.f, user);
    if (!m) continue;
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}
