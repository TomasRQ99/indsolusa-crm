import type { Prisma, ResultState } from "@prisma/client";
import { invoiceCash, today } from "./domain";
import type { makeI18n } from "./i18n";

type I = ReturnType<typeof makeI18n>;

// Result & Closure: the Journey ends with the customer's result, not with the delivery.
// Desired result vs actual result, backed by evidence; Recovery when it's at risk or not achieved;
// closing summarises what happened, what we learned and whether a legitimate future signal exists.

export const resultInclude = {
  account: true,
  contact: { select: { firstName: true, lastName: true } },
  owner: { select: { id: true, name: true } },
  items: { include: { deliveryLines: { select: { qty: true } } } },
  deliveries: { orderBy: { deliveredAt: "asc" }, include: { invoice: { select: { id: true } } } },
  shipments: { select: { id: true, code: true, receipt: true } },
  invoices: {
    orderBy: { issuedAt: "asc" },
    include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } }, promises: { orderBy: { createdAt: "desc" } } },
  },
  resultEvidence: { orderBy: { at: "asc" } },
  recoveries: { orderBy: { openedAt: "asc" } },
  continuity: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.DealInclude;

export type ResultDeal = Prisma.DealGetPayload<{ include: typeof resultInclude }>;

export const EVIDENCE_KINDS = ["CUSTOMER", "TECHNICAL", "VISIT", "MEASURE", "DOCUMENT"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const STANCES = ["SUPPORTS", "PARTIAL", "CONTRADICTS", "NEUTRAL"] as const;
export type Stance = (typeof STANCES)[number];
export type RecoveryOption = { key: string; title: string; detail: string; eta: string | null };

export function stateLabel(i: I, s: ResultState, afterRecovery = false) {
  const { t } = i;
  return {
    PENDING: { text: t("Pendiente", "Pending"), cls: "wait" },
    PARTIAL: { text: t("Parcial", "Partial"), cls: "attn" },
    ACHIEVED: { text: afterRecovery ? t("Logrado tras Recovery", "Achieved after recovery") : t("Logrado", "Achieved"), cls: "ok" },
    NOT_ACHIEVED: { text: t("No logrado", "Not achieved"), cls: "risk" },
    NO_LONGER_RELEVANT: { text: t("Ya no aplica", "No longer relevant"), cls: "dash" },
  }[s];
}

export function kindLabel(i: I, k: string) {
  const { t } = i;
  return ({
    CUSTOMER: t("Mensaje del cliente", "Customer message"),
    TECHNICAL: t("Hecho técnico", "Technical fact"),
    VISIT: t("Visita", "Visit"),
    MEASURE: t("Medición", "Measurement"),
    DOCUMENT: t("Documento", "Document"),
  } as Record<string, string>)[k] ?? k;
}

export function stanceLabel(i: I, s: string) {
  const { t } = i;
  return ({
    SUPPORTS: { text: t("confirma", "confirms"), cls: "ok" },
    PARTIAL: { text: t("confirma en parte", "partly confirms"), cls: "attn" },
    CONTRADICTS: { text: t("contradice", "contradicts"), cls: "risk" },
    NEUTRAL: { text: t("contexto", "context"), cls: "dash" },
  } as Record<string, { text: string; cls: string }>)[s] ?? { text: s, cls: "dash" };
}

export const stanceFor = (s: ResultState): Stance =>
  s === "ACHIEVED" ? "SUPPORTS" : s === "PARTIAL" ? "PARTIAL" : s === "NOT_ACHIEVED" ? "CONTRADICTS" : "NEUTRAL";

export function optionsOf(r: { options: Prisma.JsonValue }): RecoveryOption[] {
  return Array.isArray(r.options) ? (r.options as unknown as RecoveryOption[]) : [];
}

/** Prefilled options when opening a Recovery (editable before saving). */
export function optionTemplates(i: I, state: ResultState): RecoveryOption[] {
  const { t } = i;
  if (state === "PARTIAL" || state === "PENDING" || state === "ACHIEVED")
    return [
      { key: "complete", title: t("Completar lo que falta", "Complete what's missing"), detail: t("Enviar o instalar lo pendiente para cerrar la brecha.", "Send or install what's pending to close the gap."), eta: null },
      { key: "temporary", title: t("Solución temporal mientras tanto", "Temporary fix meanwhile"), detail: t("Proteger la operación del cliente hasta la solución definitiva.", "Protect the customer's operation until the definitive fix."), eta: null },
      { key: "accept", title: t("Acordar con el cliente un alcance menor", "Agree a reduced scope with the customer"), detail: t("Solo si el cliente lo acepta por escrito.", "Only if the customer accepts it in writing."), eta: null },
    ];
  return [
    { key: "replace", title: t("Reemplazar por un producto compatible", "Replace with a compatible product"), detail: t("Pedir al proveedor la referencia correcta.", "Ask the supplier for the correct reference."), eta: null },
    { key: "adapt", title: t("Adaptar en sitio", "Adapt on site"), detail: t("Fabricar o instalar un adaptador.", "Make or install an adapter."), eta: null },
    { key: "credit", title: t("Devolver y emitir nota crédito", "Return and issue a credit note"), detail: t("El cliente busca otra solución; nosotros asumimos el error.", "The customer looks for another solution; we own the mistake."), eta: null },
  ];
}

// ---------- Closure readiness ----------

export type Check = { key: string; ok: boolean; label: string; detail: string };

export function closureChecks(deal: ResultDeal, i: I, now = today()): Check[] {
  const { t } = i;
  const nlr = deal.resultState === "NO_LONGER_RELEVANT";
  const open = deal.recoveries.filter((r) => !r.resolvedAt);
  const failedHandled = deal.resultState === "NOT_ACHIEVED" && open.length === 0 && deal.recoveries.some((r) => r.outcome === "NOT_RECOVERED");
  const s = stateLabel(i, deal.resultState);

  const resultOk = deal.resultState === "ACHIEVED" || nlr || failedHandled;
  const out: Check[] = [{
    key: "result", ok: resultOk, label: t("Resultado resuelto", "Result resolved"),
    detail: resultOk
      ? failedHandled ? t("No logrado, con la falla atendida y cerrada con el cliente.", "Not achieved, with the failure handled and closed with the customer.") : `${s.text}${deal.resultConfirmedAt ? ` · ${i.day(deal.resultConfirmedAt)}` : ""}`
      : deal.resultState === "PENDING" ? t("El cliente aún no confirma su resultado.", "The customer hasn't confirmed the result yet.")
      : deal.resultState === "PARTIAL" ? t("Resultado parcial: falta cerrar la brecha.", "Partial result: the gap still needs closing.")
      : t("No logrado: la Recovery debe resolverse primero.", "Not achieved: the Recovery must be resolved first."),
  }];

  out.push({ key: "recovery", ok: open.length === 0, label: t("Sin Recovery abierta", "No open recovery"), detail: open.length ? t(`${open.length} Recovery abierta desde ${i.day(open[0].openedAt)}.`, `${open.length} recovery open since ${i.day(open[0].openedAt)}.`) : deal.recoveries.length ? t("Las Recovery están resueltas.", "Recoveries are resolved.") : t("No hubo Recovery.", "No recovery was needed.") });

  const ordered = deal.items.reduce((x, it) => x + it.qty, 0);
  const delivered = deal.items.reduce((x, it) => x + it.deliveryLines.reduce((y, l) => y + l.qty, 0), 0);
  const openShips = deal.shipments.filter((sh) => sh.receipt !== "CONFIRMED");
  const execOk = nlr ? openShips.length === 0 : (ordered > 0 ? delivered >= ordered : deal.deliveries.length > 0) && openShips.length === 0;
  out.push({
    key: "execution", ok: execOk, label: t("Ejecución completa", "Execution complete"),
    detail: nlr && delivered < ordered ? t(`Ya no aplica: no se entrega lo pendiente (${delivered} de ${ordered}).`, `No longer relevant: the rest isn't delivered (${delivered} of ${ordered}).`)
      : execOk ? t(`Entregado ${delivered}${ordered ? ` de ${ordered}` : ""}.`, `Delivered ${delivered}${ordered ? ` of ${ordered}` : ""}.`)
      : openShips.length ? t(`Envío ${openShips[0].code} sin recibo confirmado.`, `Shipment ${openShips[0].code} without confirmed receipt.`)
      : t(`Entregado ${delivered} de ${ordered}.`, `Delivered ${delivered} of ${ordered}.`),
  });

  // Finance tails: not "all paid", but every open amount has a known reason and date.
  const tails: string[] = [];
  const unknown: string[] = [];
  for (const d of deal.deliveries) if (!d.invoice) unknown.push(t("entrega sin facturar", "uninvoiced delivery"));
  for (const inv of deal.invoices) {
    const c = invoiceCash(inv);
    if (c.balance <= 0.005) continue;
    const p = inv.promises[0];
    if (inv.shortPayNote) tails.push(t(`${inv.number}: USD ${i.n2(c.balance)} · ${inv.shortPayNote}`, `${inv.number}: USD ${i.n2(c.balance)} · ${inv.shortPayNote}`));
    else if (c.pendingReconcile >= c.balance - 0.005) tails.push(t(`${inv.number}: dinero recibido, por conciliar`, `${inv.number}: cash received, to reconcile`));
    else if (p && p.promisedFor >= now) tails.push(t(`${inv.number}: USD ${i.n2(c.balance)} prometido para ${i.day(p.promisedFor)}`, `${inv.number}: USD ${i.n2(c.balance)} promised for ${i.day(p.promisedFor)}`));
    else if (inv.dueAt >= now) tails.push(t(`${inv.number}: USD ${i.n2(c.balance)} vence ${i.day(inv.dueAt)}`, `${inv.number}: USD ${i.n2(c.balance)} due ${i.day(inv.dueAt)}`));
    else unknown.push(t(`${inv.number}: USD ${i.n2(c.balance)} vencida sin promesa`, `${inv.number}: USD ${i.n2(c.balance)} past due, no promise`));
  }
  out.push({
    key: "finance", ok: unknown.length === 0, label: t("Colas financieras entendidas", "Finance tails understood"),
    detail: unknown.length ? unknown.join(" · ") : tails.length ? tails.join(" · ") : deal.invoices.length ? t("Todo cobrado y conciliado.", "Everything collected and reconciled.") : t("Sin facturas.", "No invoices."),
  });

  out.push({
    key: "learning", ok: !!deal.closedAt, label: t("Aprendizaje y continuidad evaluados", "Learning & continuity evaluated"),
    detail: deal.closedAt ? t("Evaluado al cerrar.", "Evaluated at closing.") : t("Se hace en el formulario de cierre: una línea, sin encuesta.", "Done in the closing form: one line, no survey."),
  });
  return out;
}

/** "What happened", drafted from the facts so nobody writes it from scratch. */
export function whatHappened(deal: ResultDeal, i: I) {
  const { t } = i;
  const parts: string[] = [];
  if (deal.desiredResult) parts.push(t(`${deal.account.name} buscaba: ${deal.desiredResult}.`, `${deal.account.name} wanted: ${deal.desiredResult}.`));
  const lastDel = deal.deliveries[deal.deliveries.length - 1];
  if (lastDel) parts.push(t(`Entregamos ${deal.deliveries.length === 1 ? `el ${i.day(lastDel.deliveredAt)}` : `en ${deal.deliveries.length} entregas (última ${i.day(lastDel.deliveredAt)})`}.`, `We delivered ${deal.deliveries.length === 1 ? `on ${i.day(lastDel.deliveredAt)}` : `in ${deal.deliveries.length} deliveries (last ${i.day(lastDel.deliveredAt)})`}.`));
  for (const r of deal.recoveries) {
    const opt = optionsOf(r).find((o) => o.key === r.selectedKey);
    parts.push(t(`Recovery: ${r.whatChanged}${opt ? `; se eligió «${opt.title}»` : ""}${r.outcome === "RECOVERED" ? "; funcionó" : r.outcome === "NOT_RECOVERED" ? `; no se recuperó (${r.outcomeNote ?? ""})` : ""}.`, `Recovery: ${r.whatChanged}${opt ? `; chose “${opt.title}”` : ""}${r.outcome === "RECOVERED" ? "; it worked" : r.outcome === "NOT_RECOVERED" ? `; not recovered (${r.outcomeNote ?? ""})` : ""}.`));
  }
  const s = stateLabel(i, deal.resultState, deal.recoveries.some((r) => r.outcome === "RECOVERED"));
  parts.push(t(`Resultado: ${s.text.toLowerCase()}${deal.actualResult ? ` — ${deal.actualResult}` : ""}.`, `Result: ${s.text.toLowerCase()}${deal.actualResult ? ` — ${deal.actualResult}` : ""}.`));
  const amount = deal.invoices.reduce((x, inv) => x + Number(inv.amount), 0);
  const rec = deal.invoices.reduce((x, inv) => x + invoiceCash(inv).reconciled, 0);
  if (amount) parts.push(t(`Cobrado USD ${i.n2(rec)} de ${i.n2(amount)}.`, `Collected USD ${i.n2(rec)} of ${i.n2(amount)}.`));
  return parts.join(" ");
}

/** The strongest piece of evidence behind the current result state. */
export function basisOf<E extends { stance: string; kind: string; at: Date }>(deal: { resultState: ResultState; resultEvidence: E[] }) {
  const want = stanceFor(deal.resultState);
  const rank = (k: string) => (k === "CUSTOMER" ? 0 : k === "VISIT" ? 1 : k === "MEASURE" ? 2 : k === "TECHNICAL" ? 3 : 4);
  const pool = deal.resultEvidence.filter((e) => e.stance === want);
  const list = (pool.length ? pool : deal.resultEvidence).slice().sort((a, b) => rank(a.kind) - rank(b.kind) || +b.at - +a.at);
  return list[0] ?? null;
}

export type TimelineItem = { at: Date; kind: string; title: string; detail?: string; tone: string };

export function resultTimeline(deal: ResultDeal, i: I): TimelineItem[] {
  const { t } = i;
  const out: TimelineItem[] = [];
  if (deal.poAcceptedAt) out.push({ at: deal.poAcceptedAt, kind: "poacc", title: t(`OC aceptada${deal.customerPo ? ` · ${deal.customerPo}` : ""}`, `PO accepted${deal.customerPo ? ` · ${deal.customerPo}` : ""}`), tone: "dash" });
  for (const d of deal.deliveries) out.push({ at: d.deliveredAt, kind: "delivery", title: t(`Entregado · ${d.code}`, `Delivered · ${d.code}`), detail: t("Entregar no es el resultado.", "Delivering is not the result."), tone: "dash" });
  for (const e of deal.resultEvidence) {
    const st = stanceLabel(i, e.stance);
    out.push({ at: e.at, kind: "evidence", title: `«${e.text}»`, detail: `${kindLabel(i, e.kind)} · ${e.who ?? "—"}${e.source ? ` · ${e.source}` : ""} · ${st.text}`, tone: st.cls });
  }
  for (const r of deal.recoveries) {
    out.push({ at: r.openedAt, kind: "recovery", title: t(`Recovery abierta: ${r.whatChanged}`, `Recovery opened: ${r.whatChanged}`), detail: r.impact, tone: "risk" });
    const opt = optionsOf(r).find((o) => o.key === r.selectedKey);
    if (r.selectedAt && opt) out.push({ at: r.selectedAt, kind: "recovery", title: t(`Opción elegida: ${opt.title}`, `Option chosen: ${opt.title}`), detail: `${r.selectedByName ?? ""}${r.expectedBy ? ` · ${t("recuperación esperada", "expected recovery")} ${i.day(r.expectedBy)}` : ""}`, tone: "attn" });
    if (r.resolvedAt) out.push({ at: r.resolvedAt, kind: "recovery", title: r.outcome === "RECOVERED" ? t("Recovery exitosa", "Recovery successful") : r.outcome === "NO_LONGER_RELEVANT" ? t("Recovery cerrada: ya no aplica", "Recovery closed: no longer relevant") : t("Recovery cerrada sin recuperar", "Recovery closed without recovering"), detail: r.outcomeNote ?? undefined, tone: r.outcome === "RECOVERED" ? "ok" : "dash" });
  }
  for (const c of deal.continuity) out.push({ at: c.createdAt, kind: "signal", title: `${c.kind === "TRIGGER" ? t("Disparador", "Trigger") : t("Señal", "Signal")}: ${c.what}`, detail: c.basis, tone: "info" });
  if (deal.closedAt) out.push({ at: deal.closedAt, kind: "closed", title: t("Necesidad cerrada", "Necessity closed"), detail: deal.closedByName ?? undefined, tone: "ok" });
  return out.sort((a, b) => +a.at - +b.at);
}
