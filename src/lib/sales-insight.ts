import { db } from "./db";
import { sendMail } from "./mail";
import { AiError, aiConfigured, aiJson } from "./ai";
import { MAX_PRIORITIES, RADAR_TXT, achievement, aiPriorities, bogotaDay, eveningDue, nextWorkingDay, rulePriorities, sum, type InsightHit, type Priority } from "./sales-budget-rules";
import { trackYear } from "./sales-budget-track";

// Presupuesto comercial · the day's priorities and the evening email (spec §8, phase 5, AT-15).
// Everything a person reads here is a figure SOLU calculated from its own records, with the link to open it. The AI,
// when the company's key is connected, only chooses which detections go first and words the advice: it receives the
// detections already calculated and can add no fact (an answer that names no existing detection is dropped).
// Without the key, or if the AI fails, the priorities are the radar's own first detections.

type Txt = { es: string; en: string };
export type InsightPayload = {
  year: number; started: boolean;
  /** Real and expected-by-today, in pesos; null before the year starts. */
  oc: { real: number; exp: number; pct: number | null } | null;
  fact: { real: number; exp: number; pct: number | null } | null;
  budgets: number;
  priorities: Priority[];
  /** Companies with a detection of falling requests or orders below pace (names and the evidence). */
  falling: { accountId: string; company: string; evidence: Txt }[];
  /** Companies with quotes presented and not decided yet: where an order can still come from. */
  open: { accountId: string; company: string; quotes: number; cop: number }[];
  /** The person's open to-dos due by the next working day. */
  tasks: { id: string; title: string; due: string | null; accountId: string | null }[];
  hits: number; aiNote: "AI" | "RULES" | "AI_FAILED";
};

const millions = (es: boolean) => { const one = new Intl.NumberFormat(es ? "es-CO" : "en-US", { maximumFractionDigits: 1 }); return (v: number) => `$ ${one.format(v / 1e6)} M`; };
const localDay = (now: Date) => bogotaDay(now).toISOString().slice(0, 10);

const SYSTEM = `Eres el analista comercial de una empresa que vende repuestos industriales. Recibes una lista de detecciones que el sistema ya calculó con sus cifras. Tu trabajo: elegir como máximo tres para atender primero y decir, para cada una, por qué va primero, qué hacer (una acción concreta de acercamiento al cliente: entender su situación, confirmar la causa con la persona correcta, proponer el siguiente paso) y qué no se sabe todavía.
Reglas que no se rompen:
- Usa solo las detecciones de la lista y cítalas por su "id". No inventes empresas, cifras, fechas ni causas.
- No afirmes por qué pasó algo: el sistema ve el hecho, no la causa. Dilo en "uncertainty".
- No repitas una detección. Si la lista está vacía, devuelve una lista vacía.
- Escribe en el idioma que se te indica, en frases cortas y sin adornos.`;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["priorities"],
  properties: { priorities: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why", "action", "uncertainty"], properties: { id: { type: "string" }, why: { type: "string" }, action: { type: "string" }, uncertainty: { type: "string" } } } } },
};

/** Builds (or rebuilds) today's priorities of one person and keeps them. `useAi` false = rules only. */
export async function buildInsight(person: { id: string; name: string; lang: string }, now = new Date(), useAi = true) {
  const es = person.lang !== "EN";
  const year = bogotaDay(now).getUTCFullYear();
  const day = localDay(now);
  const tr = await trackYear(year, now, { all: false, ids: new Set([person.id]), only: person.id, viewerId: person.id }, millions(es));
  const mine = tr.hits.filter((h) => h.ownerId === person.id);
  const hits: InsightHit[] = mine.slice(0, 12).map((h, k) => ({ id: `d${k + 1}`, kind: h.kind, accountId: h.accountId, company: tr.accounts.get(h.accountId)?.name ?? "—", evidence: h.evidence }));
  const T = { ocReal: sum(tr.lines.map((l) => l.oc.real)), ocExp: sum(tr.lines.map((l) => l.oc.exp)), faReal: sum(tr.lines.map((l) => l.fa.real)), faExp: sum(tr.lines.map((l) => l.fa.exp)) };

  let priorities = rulePriorities(hits, es);
  let aiNote: InsightPayload["aiNote"] = "RULES";
  if (useAi && hits.length && aiConfigured()) {
    try {
      const raw = await aiJson<unknown>({
        feature: "BUDGET_INSIGHT", userName: person.name, system: SYSTEM, schema: SCHEMA, maxTokens: 2000,
        content: [{ type: "text", text: JSON.stringify({ idioma: es ? "español" : "English", maximo: MAX_PRIORITIES, detecciones: hits.map((h) => ({ id: h.id, tipo: es ? RADAR_TXT[h.kind].title.es : RADAR_TXT[h.kind].title.en, empresa: h.company, cifras: es ? h.evidence.es : h.evidence.en, accion_base: es ? RADAR_TXT[h.kind].action.es : RADAR_TXT[h.kind].action.en })) }) }],
      });
      const picked = aiPriorities(raw, hits, es);
      if (picked.length) { priorities = picked; aiNote = "AI"; } else aiNote = "AI_FAILED";
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      aiNote = "AI_FAILED";
    }
  }

  const openBy = new Map<string, { quotes: number; cop: number }>();
  for (const c of tr.set.cohorts) if (c.ownerId === person.id && c.quotedAt && !c.decided) { const o = openBy.get(c.accountId) ?? { quotes: 0, cop: 0 }; o.quotes++; o.cop += c.cotCop ?? 0; openBy.set(c.accountId, o); }
  const next = nextWorkingDay(day);
  const tasks = await db.task.findMany({ where: { assigneeId: person.id, status: "OPEN", dueDate: { lt: new Date(`${next}T23:59:59Z`) } }, orderBy: { dueDate: "asc" }, take: 8, select: { id: true, title: true, dueDate: true, accountId: true } });

  const payload: InsightPayload = {
    year, started: tr.started, budgets: tr.lines.length,
    oc: tr.started ? { real: T.ocReal, exp: T.ocExp, pct: achievement(T.ocReal, T.ocExp) } : null,
    fact: tr.started ? { real: T.faReal, exp: T.faExp, pct: achievement(T.faReal, T.faExp) } : null,
    priorities,
    falling: hits.filter((h) => h.kind === "REQUESTS" || h.kind === "PACE").slice(0, 6).map((h) => ({ accountId: h.accountId, company: h.company, evidence: h.evidence })),
    open: [...openBy.entries()].map(([accountId, o]) => ({ accountId, company: tr.accounts.get(accountId)?.name ?? "—", ...o })).sort((a, b) => b.cop - a.cop).slice(0, 5),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, accountId: t.accountId })),
    hits: mine.length, aiNote,
  };
  const row = await db.salesInsight.upsert({ where: { userId_day: { userId: person.id, day } }, create: { userId: person.id, day, year, payload, byAi: aiNote === "AI" }, update: { year, payload, byAi: aiNote === "AI", createdAt: new Date() } });
  return { row, payload };
}

/** Today's stored priorities of a person, if they were prepared. */
export async function insightOfToday(userId: string, now = new Date()) {
  const row = await db.salesInsight.findUnique({ where: { userId_day: { userId, day: localDay(now) } } });
  return row ? { row, payload: row.payload as unknown as InsightPayload } : null;
}

export const eveningMailOn = async () => (await db.salesBudgetSetting.findUnique({ where: { id: "main" } }))?.eveningMail ?? false;

/** The evening email as text and HTML. Only what the payload holds: figures, names and links. */
export function eveningMail(p: InsightPayload, person: { name: string; lang: string }, url: string | null) {
  const es = person.lang !== "EN";
  const t = (a: string, b: string) => (es ? a : b);
  const m = millions(es);
  const link = (path: string) => (url ? `${url}${path}` : null);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const a = (path: string, text: string) => { const h = link(path); return h ? `<a href="${esc(h)}">${esc(text)}</a>` : esc(text); };
  const text: string[] = [], html: string[] = [];
  const head = (s: string) => { text.push("", s.toUpperCase()); html.push(`<h3 style="margin:18px 0 6px;font-size:14px">${esc(s)}</h3>`); };
  const line = (plain: string, rich = esc(plain)) => { text.push(`- ${plain}`); html.push(`<p style="margin:0 0 6px">${rich}</p>`); };
  html.push(`<p>${esc(t(`Hola, ${person.name}.`, `Hello, ${person.name}.`))}</p>`); text.push(t(`Hola, ${person.name}.`, `Hello, ${person.name}.`));

  head(t(`Cómo vas frente a tu presupuesto ${p.year}`, `How you stand against your ${p.year} budget`));
  if (p.oc && p.fact) {
    line(t(`Órdenes de compra: ${m(p.oc.real)} de ${m(p.oc.exp)} esperados a hoy${p.oc.pct != null ? ` (${p.oc.pct} %)` : ""}.`, `Purchase orders: ${m(p.oc.real)} of ${m(p.oc.exp)} expected by today${p.oc.pct != null ? ` (${p.oc.pct} %)` : ""}.`));
    line(t(`Facturación: ${m(p.fact.real)} de ${m(p.fact.exp)} esperados a hoy${p.fact.pct != null ? ` (${p.fact.pct} %)` : ""}.`, `Invoicing: ${m(p.fact.real)} of ${m(p.fact.exp)} expected by today${p.fact.pct != null ? ` (${p.fact.pct} %)` : ""}.`));
  } else line(t(`El año ${p.year} todavía no empieza: el cumplimiento aparece desde enero.`, `The year ${p.year} has not started yet: achievement shows from January.`));

  head(t("Prioridades para mañana", "Priorities for tomorrow"));
  if (!p.priorities.length) line(t("SOLU no detecta nada que atender con sus reglas.", "SOLU detects nothing to attend to with its rules."));
  p.priorities.forEach((x, k) => {
    const title = es ? RADAR_TXT[x.kind].title.es : RADAR_TXT[x.kind].title.en, ev = es ? x.evidence.es : x.evidence.en;
    const path = `/comercial/presupuesto/${x.accountId}?y=${p.year}`;
    text.push(`${k + 1}. ${x.company} · ${title}`, `   ${ev}`, ...(x.why ? [`   ${x.why}`] : []), `   ${t("Qué hacer", "What to do")}: ${x.action}`, `   ${t("Lo que no se sabe", "What is not known")}: ${x.uncertainty}`, ...(link(path) ? [`   ${link(path)}`] : []));
    html.push(`<p style="margin:0 0 10px"><b>${k + 1}. ${a(path, x.company)} · ${esc(title)}</b><br>${esc(ev)}${x.why ? `<br>${esc(x.why)}` : ""}<br><b>${esc(t("Qué hacer", "What to do"))}:</b> ${esc(x.action)}<br><span style="color:#555">${esc(t("Lo que no se sabe", "What is not known"))}: ${esc(x.uncertainty)}</span></p>`);
  });

  if (p.falling.length) { head(t("Clientes que caen", "Customers falling")); for (const x of p.falling) line(`${x.company}: ${es ? x.evidence.es : x.evidence.en}`, `${a(`/accounts/${x.accountId}/estadisticas`, x.company)}: ${esc(es ? x.evidence.es : x.evidence.en)}`); }
  if (p.open.length) { head(t("Empresas con oportunidad: cotizaciones presentadas sin decisión", "Companies with an opportunity: quotes presented and not decided")); for (const x of p.open) { const s = t(`${x.quotes} ${x.quotes === 1 ? "cotización" : "cotizaciones"} por ${m(x.cop)}`, `${x.quotes} ${x.quotes === 1 ? "quote" : "quotes"} worth ${m(x.cop)}`); line(`${x.company}: ${s}`, `${a(`/accounts/${x.accountId}`, x.company)}: ${esc(s)}`); } }
  head(t("Tus pendientes hasta mañana", "Your to-dos through tomorrow"));
  if (!p.tasks.length) line(t("No tienes pendientes con fecha hasta mañana.", "You have no to-dos due through tomorrow."));
  for (const x of p.tasks) line(`${x.title}${x.due ? ` (${x.due})` : ""}`);
  const foot = t(`Todas las cifras salen de lo registrado en SOLU. ${p.aiNote === "AI" ? "El orden y la redacción de las prioridades los propuso la IA a partir de esas cifras; no agrega datos." : "Las prioridades salen de reglas fijas, sin IA."} Para convertir una prioridad en un pendiente con responsable y fecha, ábrela en Cumplimiento y radar.`, `Every figure comes from what is recorded in SOLU. ${p.aiNote === "AI" ? "The order and wording of the priorities were proposed by the AI from those figures; it adds no data." : "The priorities come from fixed rules, no AI."} To turn a priority into a to-do with an owner and a date, open it in Achievement and radar.`);
  const open = link(`/comercial/presupuesto/cumplimiento?y=${p.year}#prioridades`);
  text.push("", foot, ...(open ? [open] : []));
  html.push(`<p style="margin-top:18px;color:#555;font-size:12px">${esc(foot)}${open ? `<br>${a(`/comercial/presupuesto/cumplimiento?y=${p.year}#prioridades`, t("Abrir Cumplimiento y radar", "Open Achievement and radar"))}` : ""}</p>`);
  return { subject: t(`SOLU: tu presupuesto comercial al cierre de hoy`, `SOLU: your commercial budget at today's close`), text: text.join("\n"), html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#14212b">${html.join("")}</div>` };
}

/** The worker's evening round: one email per person who has a budget this year. Off until someone turns it on. */
export async function budgetEvening(now = new Date()) {
  if (!(await eveningMailOn())) return "off";
  const day = eveningDue(now);
  if (!day) return "nothing due now";
  const year = bogotaDay(now).getUTCFullYear();
  const owners = await db.salesBudget.findMany({ where: { year }, distinct: ["userId"], select: { userId: true } });
  const people = await db.user.findMany({ where: { id: { in: owners.map((o) => o.userId) }, active: true }, select: { id: true, name: true, email: true, lang: true } });
  const url = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "") || null;
  let sent = 0, failed = 0;
  for (const p of people) {
    if (!p.email) continue;
    const had = await db.salesInsight.findUnique({ where: { userId_day: { userId: p.id, day } }, select: { mailedAt: true } });
    if (had?.mailedAt) continue;
    try {
      const { row, payload } = await buildInsight(p, now);
      if (!payload.budgets) continue;
      const m = eveningMail(payload, p, url);
      await sendMail({ to: { address: p.email, name: p.name }, subject: m.subject, text: m.text, html: m.html, senderName: "SOLU" });
      await db.salesInsight.update({ where: { id: row.id }, data: { mailedAt: new Date() } });
      sent++;
    } catch { failed++; }
  }
  return `${day}: sent ${sent}${failed ? `, failed ${failed}` : ""}`;
}
