import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import type { CashJourney, IntervalKey, LeakStage } from "@/lib/cash-journey";
import { reasonOf, ROOT_CAUSE_LABEL, STEP_LABEL, agingLabels, type CashStage, type RootCause } from "@/lib/cash-rules";

// Comercial C3 · the four money bags (§56, §71). Each card answers in five seconds:
// what is stopped, how much it is worth, why, what to do or wait for, and when to look again.
// Order is explicit (needs a move first, then value) — no secret score.

export const LEAK_LABEL: Record<LeakStage, [string, string]> = {
  READY_NOT_DELIVERED: ["Listo, sin entregar", "Ready, not delivered"],
  DELIVERED_NOT_INVOICED: ["Entregado, sin facturar", "Delivered, not invoiced"],
  NOT_SUBMITTED: ["Radicación sin confirmar", "Submission not confirmed"],
  REJECTED: ["Factura rechazada", "Invoice rejected"],
  NOT_ACCEPTED: ["Radicada, sin aceptar", "Submitted, not accepted"],
  DUE_UNPAID: ["Vencida sin pagar", "Due, unpaid"],
  PROMISE_MISSED: ["Promesa incumplida", "Promise missed"],
  UNAPPLIED_CASH: ["Dinero sin aplicar (Administración)", "Unapplied cash (Administration)"],
};
export const INTERVAL_LABEL: Record<IntervalKey, [string, string]> = {
  READY_DELIVERED: ["Listo → entregado", "Ready → delivered"],
  DELIVERED_INVOICED: ["Entregado → facturado", "Delivered → invoiced"],
  INVOICED_ACCEPTED: ["Facturado → aceptado", "Invoiced → accepted"],
  DUE_CASH: ["Vencimiento → dinero", "Due → cash"],
  RECEIVED_RECONCILED: ["Recibido → conciliado", "Received → reconciled"],
};

export const causeText = (i: I18n, c: string | null | undefined) => (c && c in ROOT_CAUSE_LABEL ? i.t(...ROOT_CAUSE_LABEL[c as RootCause]) : i.t("sin causa registrada", "no cause recorded"));
export const reasonText = (i: I18n, stage: CashStage, code: string) => { const r = reasonOf(stage, code); return r ? i.t(r.es, r.en) : code; };

export function kindLabel(i: I18n, k: string) {
  return ({
    INCREASE: i.t("Aumento de cupo", "Limit increase"), DECREASE: i.t("Disminución de cupo", "Limit decrease"),
    TEMPORARY_EXCEPTION: i.t("Excepción temporal", "Temporary exception"), TERMS_REVIEW: i.t("Revisión de plazo", "Terms review"),
  } as Record<string, string>)[k] ?? k;
}
export const ALT_LABEL: Record<string, [string, string]> = {
  PREPAYMENT: ["Anticipo", "Prepayment"], PRIOR_PAYMENT: ["Pago previo de lo vencido", "Pay overdue first"], GUARANTEE: ["Garantía", "Guarantee"],
  SPLIT_ORDER: ["Dividir orden o entrega", "Split order or delivery"], REDUCE_EXPOSURE: ["Disminuir exposición", "Reduce exposure"],
};

type Line = { key: string; title: string; value: number; why: string; todo: string; look: string | null; href: string; needs: boolean };

export function bagLines(j: CashJourney, i: I18n) {
  const { t } = i;
  const daysTxt = (n: number) => t(`${n} ${n === 1 ? "día" : "días"}`, `${n} ${n === 1 ? "day" : "days"}`);
  const deliver: Line[] = j.deliver.map((x) => ({
    key: x.key, title: `${x.dealCode ?? x.title} · ${x.account}`, value: x.value, needs: x.alert && !x.blocker,
    why: x.blocker ? `${reasonText(i, "DELIVER", x.blocker.reasonCode)} · ${causeText(i, x.blocker.rootCause)} · ${t(`listo hace ${daysTxt(x.days)}`, `ready ${daysTxt(x.days)} ago`)}` : t(`Listo hace ${daysTxt(x.days)}; nadie ha dicho por qué no se entrega`, `Ready ${daysTxt(x.days)} ago; nobody has said why it isn't delivered`),
    todo: x.blocker ? `${x.blocker.nextMovement} (${x.blocker.responsible.name})` : x.next ?? t("Coordinar la entrega o registrar la causa", "Arrange delivery or record the cause"),
    look: x.lookAgain ? i.dateShort(x.lookAgain) : null, href: `/comercial/dinero#${x.key}`,
  }));
  const invoice: Line[] = j.invoice.map((x) => ({
    key: x.key, title: `${x.ref} · ${x.account}`, value: x.value, needs: x.alert && !x.blocker,
    why: x.blocker ? `${reasonText(i, "INVOICE", x.blocker.reasonCode)} · ${causeText(i, x.blocker.rootCause)}` : x.missing.length ? t(`Falta: ${x.missing.map((m) => m.label).join(", ")}`, `Missing: ${x.missing.map((m) => m.label).join(", ")}`) : t("Todo listo para facturar", "Everything is ready to invoice"),
    todo: x.blocker ? `${x.blocker.nextMovement} (${x.blocker.responsible.name})` : x.next ?? t("Conseguir lo que falta o registrar la causa", "Get what is missing or record the cause"),
    look: x.lookAgain ? i.dateShort(x.lookAgain) : null, href: `/comercial/dinero#${x.key}`,
  }));
  const ag = agingLabels(j.policy.value.aging);
  const collect: Line[] = j.collect.map((x) => ({
    key: x.key, title: `${x.number} · ${x.account}`, value: x.value, needs: x.needs,
    why: x.conf.stage === "REJECTED" ? t(`Rechazada: ${x.conf.reason ?? "sin motivo"}`, `Rejected: ${x.conf.reason ?? "no reason"}`)
      : x.leak ? `${t(...LEAK_LABEL[x.leak])} · ${t(...ag[x.aging.idx])}`
      : `${t(...STEP_LABEL[x.conf.stage])} · ${x.aging.late > 0 ? t(...ag[x.aging.idx]) : t(`vence ${i.day(x.dueAt)}`, `due ${i.day(x.dueAt)}`)}`,
    todo: x.conf.stage === "REJECTED" ? t("Corregir y volver a radicar antes de perseguir a Tesorería", "Fix and resubmit before chasing Treasury")
      : x.collectNext ?? (x.waiting ? t(`Esperando: ${x.collectWaitingFor}`, `Waiting: ${x.collectWaitingFor}`) : x.latest?.status === "OPEN" ? t(`Promesa de ${x.latest.p.promisedBy} para ${i.day(x.latest.p.promisedFor)}`, `Promise from ${x.latest.p.promisedBy} for ${i.day(x.latest.p.promisedFor)}`) : t("Definir el próximo movimiento", "Define the next move")),
    look: x.lookAgain ? i.dateShort(x.lookAgain) : null, href: `/comercial/dinero#${x.key}`,
  }));
  const credit: Line[] = j.credit.map((x) => ({
    key: x.key, title: x.account, value: x.value, needs: x.needs,
    why: x.blocking.length ? t(`${x.blocking.length} ${x.blocking.length === 1 ? "orden bloqueada" : "órdenes bloqueadas"} por cupo · usado ${i.money(x.used)} de ${i.money(x.limit)}`, `${x.blocking.length} order(s) blocked by the limit · used ${i.money(x.used)} of ${i.money(x.limit)}`) : t(`Usado ${i.money(x.used)} de ${i.money(x.limit)}`, `Used ${i.money(x.used)} of ${i.money(x.limit)}`),
    todo: x.review ? t(`Solicitud en revisión por Finanzas/Gerencia desde ${i.day(x.review.createdAt)}`, `Request under review by Finance/Management since ${i.day(x.review.createdAt)}`) : x.blocking.length ? t("Ofrecer una alternativa o solicitar revisión de cupo", "Offer an alternative or request a credit review") : t("Vigilar antes de la próxima orden", "Watch before the next order"),
    look: null, href: `/comercial/dinero#${x.key}`,
  }));
  return { deliver, invoice, collect, credit };
}

const sum = (xs: Line[]) => xs.reduce((s, x) => s + x.value, 0);

export function CashBags({ j, i, compact = false }: { j: CashJourney; i: I18n; compact?: boolean }) {
  const { t } = i;
  const L = bagLines(j, i);
  const bags: { k: keyof typeof L; title: string; empty: string; lines: Line[]; anchor: string }[] = [
    { k: "deliver", title: t("Entregar", "Deliver"), empty: t("Nada listo esperando entrega.", "Nothing ready waiting for delivery."), lines: L.deliver, anchor: "entregar" },
    { k: "invoice", title: t("Facturar", "Invoice"), empty: t("Todo lo entregado está facturado.", "Everything delivered is invoiced."), lines: L.invoice, anchor: "facturar" },
    { k: "collect", title: t("Cobrar", "Collect"), empty: t("No hay facturas abiertas.", "No open invoices."), lines: L.collect, anchor: "cobrar" },
    { k: "credit", title: t("Liberar crédito", "Free up credit"), empty: t("Ningún cliente cerca o por encima del cupo.", "No customer near or over the limit."), lines: L.credit, anchor: "credito" },
  ];
  return (
    <div className="cb-grid">
      {bags.map((b) => {
        const top = b.lines[0];
        const needs = b.lines.filter((x) => x.needs).length;
        return (
          <article key={b.k} className={`cb ${needs ? "move" : ""}`}>
            <div className="cb-head">
              <b>{b.title}</b>
              <span className="cb-v">{i.money(sum(b.lines))}</span>
              <span className="src">{b.lines.length ? t(`${b.lines.length} ${b.lines.length === 1 ? "caso" : "casos"}${needs ? ` · ${needs} por mover` : ""}`, `${b.lines.length} case(s)${needs ? ` · ${needs} to move` : ""}`) : t("sin casos", "no cases")}</span>
            </div>
            {top ? (
              <dl className="cb-top">
                <dt>{t("Qué", "What")}</dt><dd><Link href={compact ? `/comercial/dinero#${b.anchor}` : top.href}>{top.title}</Link> · <span className="val">{i.money(top.value)}</span></dd>
                <dt>{t("Por qué", "Why")}</dt><dd>{top.why}</dd>
                <dt>{t("Qué hacer", "To do")}</dt><dd>{top.todo}</dd>
                <dt>{t("Volver a mirar", "Look again")}</dt><dd>{top.look ?? (top.needs ? t("hoy", "today") : "—")}</dd>
              </dl>
            ) : <p className="small muted">{b.empty}</p>}
            {compact && b.lines.length > 1 && <Link className="small" href={`/comercial/dinero#${b.anchor}`}>{t(`Ver los ${b.lines.length}`, `See all ${b.lines.length}`)}</Link>}
          </article>
        );
      })}
    </div>
  );
}
