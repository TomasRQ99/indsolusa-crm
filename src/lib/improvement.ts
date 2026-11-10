import { db } from "./db";
import { addDays, daysBetween, today } from "./domain";
import { sumMoney } from "./money";
import { IMPROVE_RULES, compareDays, compareRate, type Compare, type Ratio } from "./focus-rules";

// Comercial C8c · Improvement Engine (module 10 v1.3 §61). Path: Contact → Need → Quote → Presentation → Decision →
// Deal → Eságara → Collection. The last 90 days are compared with the person's own previous 270 days (no team
// comparison, no score). Each step shows the counts behind it and says when there's too little data.

type Win = { from: Date; to: Date };
async function windowData(userId: string, w: Win) {
  const r = { gte: w.from, lt: w.to };
  const [contacts, needs, needsQuoted, presented, presentedWithRecord, presentedDecided, decided, accepted, invoices] = await Promise.all([
    db.activity.count({ where: { userId, occurredAt: r, valueKind: { not: null } } }),
    db.deal.count({ where: { ownerId: userId, createdAt: r, desiredResult: { not: null }, NOT: { desiredResult: "" } } }),
    db.deal.count({ where: { ownerId: userId, createdAt: r, desiredResult: { not: null }, NOT: { desiredResult: "" }, quotes: { some: { status: { not: "DRAFT" } } } } }),
    db.quote.count({ where: { presentedAt: r, status: { not: "DRAFT" }, deal: { ownerId: userId } } }),
    db.quote.count({ where: { presentedAt: r, status: { not: "DRAFT" }, deal: { ownerId: userId }, presentations: { some: {} } } }),
    db.quote.count({ where: { presentedAt: r, deal: { ownerId: userId }, status: { in: ["ACCEPTED", "DECLINED"] } } }),
    db.quote.findMany({ where: { decidedAt: r, deal: { ownerId: userId }, status: { in: ["ACCEPTED", "DECLINED"] } }, select: { status: true, presentedAt: true, decidedAt: true } }),
    db.quote.findMany({ where: { decidedAt: r, deal: { ownerId: userId }, status: "ACCEPTED" }, select: { protSale: true, protEsagra: true } }),
    db.invoice.findMany({ where: { deal: { ownerId: userId }, applications: { some: { payment: { receivedAt: r } } } }, select: { amount: true, issuedAt: true, applications: { select: { amount: true, payment: { select: { receivedAt: true } } } } } }),
  ]);
  const decideDays = decided.filter((q) => q.presentedAt && q.decidedAt).map((q) => Math.max(0, daysBetween(q.presentedAt!, q.decidedAt!)));
  // Paid in full inside the window: days from issue to the last payment applied.
  const payDays = invoices.filter((i) => sumMoney(i.applications.map((a) => a.amount)) >= Number(i.amount) - 0.005).map((i) => {
    const lastPay = i.applications.map((a) => a.payment.receivedAt).sort((a, b) => +b - +a)[0];
    return lastPay >= w.from && lastPay < w.to ? Math.max(0, daysBetween(i.issuedAt, lastPay)) : null;
  }).filter((x): x is number => x != null);
  return {
    contactToNeed: { num: needs, den: contacts } as Ratio,
    needToQuote: { num: needsQuoted, den: needs } as Ratio,
    quoteToPresentation: { num: presentedWithRecord, den: presented } as Ratio,
    presentationToDecision: { num: presentedDecided, den: presented } as Ratio,
    decisionToDeal: { num: decided.filter((q) => q.status === "ACCEPTED").length, den: decided.length } as Ratio,
    esagara: { num: sumMoney(accepted.map((q) => q.protEsagra)), den: sumMoney(accepted.map((q) => q.protSale)) } as Ratio,
    acceptedCount: accepted.length,
    decideDays, payDays,
  };
}

export type StepKey = "contactToNeed" | "needToQuote" | "quoteToPresentation" | "presentationToDecision" | "decisionToDeal" | "esagara" | "decideDays" | "payDays";
export const STEP_TEXT: Record<StepKey, { es: string; en: string; better: { es: string; en: string }; worse: { es: string; en: string } }> = {
  contactToNeed: { es: "Contacto → Necesidad", en: "Contact → Need", better: { es: "Más contactos útiles terminan en una necesidad escrita.", en: "More useful contacts end in a written need." }, worse: { es: "Menos contactos útiles se vuelven necesidad: en cada conversación pregunta qué resultado busca el cliente.", en: "Fewer useful contacts become a need: in each conversation ask what result the customer is after." } },
  needToQuote: { es: "Necesidad → Cotización", en: "Need → Quote", better: { es: "Más necesidades llegan a cotización.", en: "More needs reach a quote." }, worse: { es: "Más necesidades se quedan sin cotizar: revisa cuáles esperan proveedor o información técnica.", en: "More needs stay unquoted: check which are waiting on a supplier or technical information." } },
  quoteToPresentation: { es: "Cotización → Presentación", en: "Quote → Presentation", better: { es: "Presentas más de lo que envías.", en: "You present more of what you send." }, worse: { es: "Se envían más cotizaciones sin presentarlas: presentar ayuda a decidir y protege la Eságara.", en: "More quotes are sent without presenting them: presenting helps decide and protects Eságara." } },
  presentationToDecision: { es: "Presentación → Decisión", en: "Presentation → Decision", better: { es: "Más cotizaciones reciben una decisión clara.", en: "More quotes get a clear decision." }, worse: { es: "Menos cotizaciones llegan a decisión: confirma quién decide y la ventana de decisión.", en: "Fewer quotes reach a decision: confirm who decides and the decision window." } },
  decisionToDeal: { es: "Decisión → Negocio", en: "Decision → Deal", better: { es: "Más decisiones son «sí».", en: "More decisions are «yes»." }, worse: { es: "Más decisiones son «no»: mira las objeciones registradas en las presentaciones.", en: "More decisions are «no»: look at the objections recorded at presentations." } },
  esagara: { es: "Eságara % en lo aceptado", en: "Eságara % on accepted", better: { es: "La Eságara de lo aceptado subió.", en: "Eságara on accepted business went up." }, worse: { es: "La Eságara de lo aceptado bajó: revisa alcance, costos y precio antes de presentar.", en: "Eságara on accepted business went down: check scope, costs and price before presenting." } },
  decideDays: { es: "Días de presentación a decisión", en: "Days from presentation to decision", better: { es: "Los clientes deciden más rápido.", en: "Customers decide faster." }, worse: { es: "Los clientes tardan más en decidir: acuerda una fecha de decisión al presentar.", en: "Customers take longer to decide: agree a decision date when presenting." } },
  payDays: { es: "Días de factura a cobro", en: "Days from invoice to payment", better: { es: "El dinero llega antes.", en: "Money arrives sooner." }, worse: { es: "El cobro tarda más: revisa el mapa de pago y los bloqueos de cada cliente.", en: "Collection takes longer: check each customer's payment map and blockers." } },
};

export async function improvementFor(userId: string, now = today()) {
  const W = IMPROVE_RULES.windowDays;
  const cur = await windowData(userId, { from: addDays(now, -W + 1), to: addDays(now, 1) });
  const base = await windowData(userId, { from: addDays(now, -W * (IMPROVE_RULES.baselineWindows + 1) + 1), to: addDays(now, -W + 1) });
  const rates: Partial<Record<StepKey, Compare>> = {};
  for (const k of ["contactToNeed", "needToQuote", "quoteToPresentation", "presentationToDecision", "decisionToDeal"] as const) rates[k] = compareRate(cur[k], base[k]);
  // Eságara % compares money ratios: the sample is the number of accepted quotes, not dollars.
  const e = compareRate({ num: cur.esagara.num, den: cur.esagara.den }, { num: base.esagara.num, den: base.esagara.den });
  rates.esagara = cur.acceptedCount < IMPROVE_RULES.minSample || base.acceptedCount < IMPROVE_RULES.minSample ? { ...e, verdict: "THIN" } : e.verdict === "THIN" ? { ...e, verdict: "SAME" } : e;
  return { rates, decideDays: compareDays(cur.decideDays, base.decideDays), payDays: compareDays(cur.payDays, base.payDays), sample: { accepted: cur.acceptedCount, acceptedBase: base.acceptedCount } };
}
