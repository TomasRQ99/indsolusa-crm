import { db } from "./db";
import type { I18n } from "./i18n";
import { addDays, daysBetween, today } from "./domain";
import { addWorkingDays } from "./holidays";
import { DEFAULT_DELAY_TAGS, DELAY_TAGS_KEY, cleanDelayTags, type DelayTag, type OtherCase } from "./delay-rules";
import { aiJson, AI_MODEL } from "./ai";

// AVISO DE RETRASO, the part that reads the database: the tags in force, and everything SOLU already knows about
// one late delivery so the person only has to say the cause and agree a new date.

export async function getDelayTags(): Promise<{ value: DelayTag[]; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: DELAY_TAGS_KEY }, orderBy: { version: "desc" } });
  const value = s ? cleanDelayTags(s.value) : [];
  return s && value.length ? { value, version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_DELAY_TAGS, version: 0, by: null, at: null };
}

/** Days we add to the supplier's arrival before promising the customer: receive and check (3) + deliver (1). */
const AFTER_ARRIVAL_WORKING_DAYS = 4;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const strip = (s: string) => s.replace(/ \(ejemplo\)$/, "");
const dayOf = (d: Date) => { const b = new Date(d.getTime() - 5 * 3600e3); return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); };

export type DelayCase = NonNullable<Awaited<ReturnType<typeof delayCase>>>;

export async function delayCase(dealId: string, i: I18n) {
  const { t } = i;
  const now = today();
  const d = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true, code: true, title: true, stage: true, ownerId: true, accountId: true, customerPo: true, internal: true, closedAt: true,
      promisedDate: true, promiseText: true, originalPromisedDate: true, promiseRevisions: true, promiseRevisedAt: true, promiseChangeCause: true,
      owner: { select: { name: true } },
      account: { select: { name: true, docLang: true, contacts: { select: { firstName: true, lastName: true, email: true }, orderBy: { createdAt: "asc" }, take: 20 } } },
      contact: { select: { firstName: true, lastName: true, email: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { subject: true, occurredAt: true, user: { select: { name: true } } } },
      supplierPos: { select: { code: true, releasedAt: true, confirmedAt: true, shippedAt: true, eta: true, carrierEta: true, receivedAt: true } },
      _count: { select: { deliveries: true } },
    },
  });
  if (!d || d.internal) return null;

  const late = d.stage === "WON" && !!d.promisedDate && d.promisedDate < now && d._count.deliveries === 0;
  const daysLate = d.promisedDate ? daysBetween(d.promisedDate, now) : 0;

  // ---- What the record says (facts, each one a line) ----
  const facts: { tone: "risk" | "attn" | "info" | "ok"; text: string }[] = [];
  if (d.promisedDate) facts.push({ tone: late ? "risk" : "info", text: late ? t(`La entrega al cliente estaba prometida para el ${i.date(d.promisedDate)} (hace ${daysLate} ${daysLate === 1 ? "día" : "días"}).`, `Delivery to the customer was promised for ${i.date(d.promisedDate)} (${daysLate} day(s) ago).`) : t(`La entrega al cliente está prometida para el ${i.date(d.promisedDate)}.`, `Delivery to the customer is promised for ${i.date(d.promisedDate)}.`) });
  if (d.promiseRevisions > 0) facts.push({ tone: "attn", text: t(`La fecha ya se cambió ${d.promiseRevisions} ${d.promiseRevisions === 1 ? "vez" : "veces"}${d.originalPromisedDate ? `; la primera promesa fue el ${i.date(d.originalPromisedDate)}` : ""}.`, `The date was already changed ${d.promiseRevisions} time(s)${d.originalPromisedDate ? `; the first promise was ${i.date(d.originalPromisedDate)}` : ""}.`) });
  const a = d.activities[0];
  const quiet = a ? daysBetween(dayOf(a.occurredAt), now) : null;
  facts.push(a
    ? { tone: quiet! >= 7 ? "attn" : "info", text: t(`Último seguimiento hace ${quiet} ${quiet === 1 ? "día" : "días"} (${a.user.name}): «${a.subject.slice(0, 140)}».`, `Last follow-up ${quiet} day(s) ago (${a.user.name}): "${a.subject.slice(0, 140)}".`) }
    : { tone: "attn", text: t("No hay ningún seguimiento registrado en este pedido.", "No follow-up is recorded on this order.") });
  const open = d.supplierPos.filter((s) => !s.receivedAt);
  if (d.supplierPos.length === 0) facts.push({ tone: "risk", text: t("Todavía no hay orden de compra al proveedor.", "There is no purchase order to a supplier yet.") });
  for (const s of d.supplierPos) {
    const eta = s.carrierEta ?? s.eta;
    facts.push(s.receivedAt
      ? { tone: "ok", text: t(`Orden ${s.code}: recibida en bodega el ${i.date(s.receivedAt)}.`, `Order ${s.code}: received at the warehouse on ${i.date(s.receivedAt)}.`) }
      : s.shippedAt
        ? { tone: eta && eta < now ? "attn" : "info", text: t(`Orden ${s.code}: despachada por el proveedor el ${i.date(s.shippedAt)}${eta ? `; llegada estimada ${i.date(eta)}${eta < now ? " (ya pasó)" : ""}` : "; sin fecha de llegada registrada"}.`, `Order ${s.code}: shipped by the supplier on ${i.date(s.shippedAt)}${eta ? `; estimated arrival ${i.date(eta)}${eta < now ? " (already past)" : ""}` : "; no arrival date recorded"}.`) }
        : { tone: "attn", text: t(`Orden ${s.code}: ${!s.releasedAt ? "aún sin liberar" : !s.confirmedAt ? "liberada, sin confirmación del proveedor" : "confirmada por el proveedor, sin despachar"}${eta ? `; llegada estimada ${i.date(eta)}` : ""}.`, `Order ${s.code}: ${!s.releasedAt ? "not released yet" : !s.confirmedAt ? "released, not confirmed by the supplier" : "confirmed by the supplier, not shipped"}${eta ? `; estimated arrival ${i.date(eta)}` : ""}.`) });
  }

  // ---- A date to offer: calculated, never invented ----
  let suggest: { date: string; why: string } | null = null;
  const etas = open.map((s) => s.carrierEta ?? s.eta).filter((x): x is Date => !!x);
  if (d.supplierPos.length > 0 && open.length === 0) {
    const day = addWorkingDays(now, 1);
    suggest = { date: iso(day), why: t("Todo lo comprado ya está en bodega: un día hábil para entregar.", "Everything purchased is already in the warehouse: one working day to deliver.") };
  } else if (open.length > 0 && etas.length === open.length) {
    const lastEta = new Date(Math.max(...etas.map((x) => x.getTime())));
    if (lastEta >= now) {
      const day = addWorkingDays(lastEta, AFTER_ARRIVAL_WORKING_DAYS);
      suggest = { date: iso(day), why: t(`Llegada estimada del proveedor (${i.date(lastEta)}) más ${AFTER_ARRIVAL_WORKING_DAYS} días hábiles para recibir, revisar y entregar.`, `The supplier's estimated arrival (${i.date(lastEta)}) plus ${AFTER_ARRIVAL_WORKING_DAYS} working days to receive, check and deliver.`) };
    }
  }

  // ---- The customer's other open cases, each with one sentence the customer can read ----
  const others = await db.deal.findMany({
    where: { accountId: d.accountId, id: { not: d.id }, internal: false, stage: { not: "LOST" }, closedAt: null, resultAchievedAt: null },
    orderBy: { createdAt: "desc" }, take: 8,
    select: { id: true, code: true, title: true, stage: true, promisedDate: true, quotes: { where: { status: "PRESENTED" }, orderBy: { presentedAt: "desc" }, take: 1, select: { number: true, presentedAt: true } }, _count: { select: { deliveries: true } } },
  });
  const statusOf = (o: (typeof others)[number], lang: "ES" | "EN") => {
    const en = lang === "EN";
    const day = (x: Date) => new Intl.DateTimeFormat(en ? "en-US" : "es-CO", { day: "numeric", month: "long", timeZone: "UTC" }).format(x);
    if (o.stage === "WON") {
      if (o._count.deliveries > 0) return en ? "delivered; we are confirming with you that everything is working as expected" : "entregado; estamos confirmando con usted que todo funcione como esperaba";
      if (o.promisedDate && o.promisedDate < now) return en ? "it is also behind its date; I will confirm its new date to you separately" : "también va atrasado frente a su fecha; le confirmaré su nueva fecha por separado";
      return o.promisedDate ? (en ? `in process; delivery planned for ${day(o.promisedDate)}` : `en proceso; entrega prevista para el ${day(o.promisedDate)}`) : en ? "in process" : "en proceso";
    }
    const q = o.quotes[0];
    if (q?.presentedAt) return en ? `quotation ${q.number} sent on ${day(dayOf(q.presentedAt))}; we remain attentive to your decision` : `cotización ${q.number} enviada el ${day(dayOf(q.presentedAt))}; quedamos atentos a su decisión`;
    return en ? "we are preparing your quotation" : "estamos preparando su cotización";
  };
  const otherCases = (lang: "ES" | "EN"): OtherCase[] => others.map((o) => ({ id: o.id, code: o.code ?? "", what: o.title.slice(0, 90), status: statusOf(o, lang) }));

  const c = d.contact ?? d.account.contacts.find((x) => x.email) ?? null;
  return {
    id: d.id, code: d.code, title: d.title, ownerId: d.ownerId, ownerName: d.owner.name, accountId: d.accountId, customer: strip(d.account.name), customerPo: d.customerPo,
    late, daysLate, promised: d.promisedDate ? iso(d.promisedDate) : null, promiseText: d.promiseText, revisions: d.promiseRevisions, revisedAt: d.promiseRevisedAt, closed: !!d.closedAt, won: d.stage === "WON",
    facts, suggest, minDate: iso(addDays(now, 0)),
    lang: d.account.docLang === "ES" ? ("ES" as const) : ("EN" as const),
    contact: c ? { name: c.firstName, email: c.email ?? "" } : null,
    others: { ES: otherCases("ES"), EN: otherCases("EN") },
  };
}

/** AI proposal (only with ANTHROPIC_API_KEY): rewrites what we tell the customer from the facts on screen. It never
 *  receives supplier names or costs, and it is told not to invent dates: the date is the one the person chose. */
export async function aiDelayProposal(o: { lang: "ES" | "EN"; sender: string; baseline: string; tagLabel: string; internalDetail: string; facts: string[]; newDate: string | null }) {
  const out = await aiJson<{ solution: string; body: string }>({
    feature: "mail-delay", userName: o.sender,
    system: `You write for Industry Solutions, a supplier of industrial spare parts. A delivery to a customer is late. A salesperson will read and edit your text before anything is sent.

Write in ${o.lang === "ES" ? "Spanish (Latin American, formal «usted»)" : "English"}. Return:
- "solution": one or two sentences proposing what we do now to solve the delay, concrete and realistic, based only on the facts given.
- "body": the full plain-text email to the customer, keeping the structure and the signature of the standard text given, with a clearer and warmer wording.

Rules: use only the facts given. Never invent a date, a tracking number, a cause or a promise; the only delivery date you may state is the "new date" given (if none is given, say we will confirm it). Never name a supplier, a carrier or any cost, and never blame a third party. The "internal detail" is background: do not quote it. Take responsibility, be respectful and brief, no exclamation marks, no markdown.`,
    content: [{ type: "text", text: `Cause chosen by the salesperson: ${o.tagLabel}\nInternal detail (background only): ${o.internalDetail || "-"}\nNew date to offer: ${o.newDate ?? "none yet"}\nFacts on the order:\n${o.facts.map((f) => `- ${f}`).join("\n")}\n\nStandard text of this email:\n${o.baseline.slice(0, 5000)}` }],
    schema: { type: "object", properties: { solution: { type: "string" }, body: { type: "string" } }, required: ["solution", "body"], additionalProperties: false },
    maxTokens: 3000,
  });
  return { solution: out.solution.replace(/\s+/g, " ").trim().slice(0, 500), body: out.body.replace(/\r\n/g, "\n").trim().slice(0, 12000), model: AI_MODEL };
}
