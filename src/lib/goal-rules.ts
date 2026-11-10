// Comercial C7 · Goals & Future Creation (module 10 v1.1 §37–42, §50). Pure rules: the 5 core goals, what a
// "useful contact" is, pace on a working-day calendar, and plain-sentence bottleneck explanations.
// Decided C-01 / C-15: only the person and their managers see goals; nothing here ranks people.

import { workingDaysBetween } from "./cash-rules";

export const GOAL_RULES = { version: "goals-v1", projectionMinDays: 5, closeEnough: 0.85 } as const;

export type MetricKey = "ESAGARA_AMOUNT" | "VALUE_CONTACTS" | "NEEDS_CREATED" | "SOLUTIONS_PRESENTED" | "DECISIONS_MOVED";
type Txt = { es: string; en: string };
export const GOAL_METRICS: Record<MetricKey, Txt & { unit: "usd" | "n"; how: Txt }> = {
  ESAGARA_AMOUNT: { es: "Eságara ganada", en: "Eságara won", unit: "usd", how: { es: "Eságara protegida de las cotizaciones aceptadas en el mes, en tus Journeys.", en: "Protected Eságara of quotes accepted this month, on your Journeys." } },
  VALUE_CONTACTS: { es: "Contactos útiles", en: "Useful contacts", unit: "n", how: { es: "Contactos que dejaron algo: información, una necesidad, relación, quién decide, un próximo paso, una objeción o la ventana de decisión. Un intento sin respuesta no cuenta.", en: "Contacts that left something: information, a need, relationship, who decides, a next step, an objection or the decision window. An attempt with no answer doesn't count." } },
  NEEDS_CREATED: { es: "Necesidades nuevas", en: "New Needs", unit: "n", how: { es: "Journeys abiertos en el mes con el resultado que busca el cliente escrito.", en: "Journeys opened this month with the customer's desired result written down." } },
  SOLUTIONS_PRESENTED: { es: "Soluciones presentadas", en: "Solutions presented", unit: "n", how: { es: "Presentaciones registradas en el Caso de solución (no cuenta enviar sin presentar).", en: "Presentations recorded on the Solution case (sending without presenting doesn't count)." } },
  DECISIONS_MOVED: { es: "Decisiones del cliente", en: "Customer decisions", unit: "n", how: { es: "Cotizaciones que el cliente decidió en el mes: aceptadas o rechazadas. Un «no» claro también libera tiempo.", en: "Quotes the customer decided this month: accepted or declined. A clear «no» also frees time." } },
};
export const METRIC_KEYS = Object.keys(GOAL_METRICS) as MetricKey[];

/** §39: what a contact produced. Absent = nothing useful. */
export const VALUE_KINDS: Record<string, Txt> = {
  INFO: { es: "Información nueva", en: "New information" },
  NEED: { es: "Una necesidad", en: "A need" },
  RELATIONSHIP: { es: "Relación más fuerte", en: "Stronger relationship" },
  DECISION_MAKER: { es: "Supe quién decide", en: "Learned who decides" },
  NEXT_MOVE: { es: "Próximo paso acordado", en: "Next step agreed" },
  OBJECTION: { es: "Objeción entendida", en: "Objection understood" },
  DECISION_WINDOW: { es: "Ventana de decisión", en: "Decision window" },
};
export const valueKindOf = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s && VALUE_KINDS[s] ? s : null; };
export const isUsefulContact = (a: { valueKind: string | null }) => valueKindOf(a.valueKind) != null;

// ---------- Periods ----------

export const periodOf = (d: Date) => d.toISOString().slice(0, 7);
export const validPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export function periodBounds(p: string) {
  const [y, m] = p.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}
export const shiftPeriod = (p: string, n: number) => { const { start } = periodBounds(p); return periodOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1))); };
/** AC5: a month that already ended is closed; its targets don't change. */
export const isClosed = (p: string, now: Date) => p < periodOf(now);

// ---------- Pace ----------

export type PaceStatus = "NO_TARGET" | "DONE" | "AHEAD" | "ON_PACE" | "CLOSE" | "BEHIND" | "EARLY";
export type Pace = {
  target: number | null; actual: number; totalDays: number; elapsedDays: number; remainingDays: number;
  expected: number | null; remaining: number | null; perDayNeeded: number | null; projection: number | null; status: PaceStatus;
};

/** Pace on Mon–Fri working days. Projection only after ≥5 working days ("if the current pace holds"). */
export function paceOf(target: number | null, actual: number, period: string, now: Date): Pace {
  const { start, end } = periodBounds(period);
  const before = new Date(start.getTime() - 864e5);
  const last = new Date(end.getTime() - 864e5);
  const totalDays = workingDaysBetween(before, last);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const until = today < start ? before : today >= end ? last : today;
  const elapsedDays = Math.min(totalDays, workingDaysBetween(before, until));
  const remainingDays = totalDays - elapsedDays;
  const projection = elapsedDays >= GOAL_RULES.projectionMinDays && totalDays > 0 ? (actual / elapsedDays) * totalDays : null;
  if (target == null || target <= 0) return { target: null, actual, totalDays, elapsedDays, remainingDays, expected: null, remaining: null, perDayNeeded: null, projection, status: "NO_TARGET" };
  const expected = totalDays ? (target * elapsedDays) / totalDays : 0;
  const remaining = Math.max(0, target - actual);
  const perDayNeeded = remaining > 0 && remainingDays > 0 ? remaining / remainingDays : null;
  let status: PaceStatus;
  if (actual >= target) status = "DONE";
  else if (elapsedDays === 0) status = "EARLY";
  else if (actual >= expected * 1.15 && actual > 0) status = "AHEAD";
  else if (actual >= expected) status = "ON_PACE";
  else if (actual >= expected * GOAL_RULES.closeEnough) status = "CLOSE";
  else status = "BEHIND";
  return { target, actual, totalDays, elapsedDays, remainingDays, expected, remaining, perDayNeeded, projection, status };
}
const behind = (p?: Pace) => !!p && (p.status === "BEHIND");
const fine = (p?: Pace) => !!p && (p.status === "DONE" || p.status === "AHEAD" || p.status === "ON_PACE" || p.status === "CLOSE");

// ---------- Bottleneck (§41) ----------

export type Extras = { sentWithoutPresenting: number; accepted: number; declined: number; esagaraPct: number | null; lowEsagaraApproved: number };
export type Hint = { key: string; es: string; en: string };

/** Reads the funnel contacts → needs → presented → decisions → Eságara and names where it narrows, in plain words. */
export function bottlenecks(p: Partial<Record<MetricKey, Pace>>, x: Extras): Hint[] {
  const out: Hint[] = [];
  const C = p.VALUE_CONTACTS, N = p.NEEDS_CREATED, S = p.SOLUTIONS_PRESENTED, D = p.DECISIONS_MOVED, E = p.ESAGARA_AMOUNT;
  if (behind(C)) out.push({ key: "contacts", es: "Faltan contactos útiles: sin conversaciones que dejen algo no nacen necesidades. Prioriza clientes con necesidad probable antes que volumen de llamadas.", en: "Useful contacts are short: without conversations that leave something, no needs are born. Prioritise customers with a likely need over call volume." });
  if (behind(N) && fine(C)) out.push({ key: "needs", es: "Hay contactos útiles pero pocos se convierten en necesidad: en cada conversación pregunta qué resultado busca el cliente y escríbelo en un Journey.", en: "There are useful contacts but few become a need: in each conversation ask what result the customer is after and write it in a Journey." });
  if (behind(S) && fine(N)) out.push({ key: "present", es: "Hay necesidades nuevas sin solución presentada: agenda la presentación antes de enviar la cotización.", en: "There are new needs without a presented solution: book the presentation before sending the quote." });
  if (x.sentWithoutPresenting > 0 && (S?.actual ?? 0) < x.sentWithoutPresenting) out.push({ key: "sent", es: `Se enviaron ${x.sentWithoutPresenting} cotizaciones sin presentarlas. Presentar ayuda al cliente a decidir y protege la Eságara.`, en: `${x.sentWithoutPresenting} quotes were sent without presenting them. Presenting helps the customer decide and protects Eságara.` });
  if (behind(D) && fine(S)) out.push({ key: "decide", es: "Presentas soluciones pero los clientes no deciden: revisa en cada caso quién decide, la ventana de decisión y el próximo paso acordado.", en: "You present solutions but customers don't decide: check, case by case, who decides, the decision window and the agreed next step." });
  if (behind(E) && fine(D)) {
    if (x.accepted === 0 && x.declined > 0) out.push({ key: "declined", es: "Los clientes deciden, pero las decisiones han sido «no». Mira las objeciones registradas en las presentaciones.", en: "Customers decide, but the decisions have been «no». Look at the objections recorded at the presentations." });
    else out.push({ key: "esagara", es: "Los clientes deciden, pero la Eságara por decisión es baja: revisa alcance, costos y precio antes de presentar.", en: "Customers decide, but Eságara per decision is low: check scope, costs and price before presenting." });
  }
  if (x.lowEsagaraApproved > 0) out.push({ key: "low", es: `${x.lowEsagaraApproved} de las ventas aceptadas tuvieron excepción de Eságara baja: cuentan en el resultado, pero conviene que sean pocas.`, en: `${x.lowEsagaraApproved} of the accepted sales had a low-Eságara exception: they count, but they should stay few.` });
  return out;
}
