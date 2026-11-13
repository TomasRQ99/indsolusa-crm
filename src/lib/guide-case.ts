// The on-screen guide follows the Journey the person has open (2026-11-13).
//
// A stage of the guide ("Crear y presentar una cotización") is written once for every Journey, but each Journey is
// somewhere different: one has no quote yet, another has it in draft, another already presented it. Here SOLU reads
// the Journey and answers, for each stage: which exact page it lives on for THIS Journey, whether it is already done,
// and what is missing before it can be done. The guide then points at the right page and never asks for a button
// that this Journey cannot show yet without saying why.
//
// It also lists the sample Journeys ("(ejemplo)"), so a new person can practise any stage without creating a Journey.
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { boardMayOpen, isBoard } from "./permissions";

export type CaseStage = {
  /** The page of this Journey where the stage is done. */
  href: string;
  /** Pages (pathname only) that count as "being there". */
  at: string[];
  state: "done" | "now" | "later";
  /** What this Journey needs before the stage, or what already happened, in the person's language. */
  note: string | null;
  /** The first step that still applies to this Journey (0 = from the start). */
  startStep: number;
};
export type GuideCase = { id: string; name: string; demo: boolean; stages: Record<string, CaseStage>; current: string | null };
export type GuideExample = { id: string; name: string; current: string | null; stages: Record<string, { href: string; state: CaseStage["state"] }> };

type U = { role: string } & Parameters<typeof isBoard>[0];

/** The stages of the life of an order that happen inside one Journey, in order. */
const ORDER = ["need-source", "quote", "po", "compras", "logistica", "ops-despachos", "facturacion", "resultado"] as const;

const caseSelect = {
  id: true, code: true, title: true, stage: true, desiredResult: true, supplierCost: true, sourcingNote: true, quoteSentAt: true,
  poAcceptedAt: true, customerPo: true, closedAt: true,
  account: { select: { name: true, isDemo: true } },
  quotes: { orderBy: [{ number: "desc" }, { rev: "desc" }], select: { id: true, number: true, rev: true, status: true } },
  customerPos: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, rejectedAt: true, acceptance: { select: { id: true } } } },
  supplierPos: { orderBy: { createdAt: "asc" }, select: { id: true, code: true, confirmedAt: true, receivedAt: true } },
  shipments: { orderBy: { createdAt: "asc" }, select: { id: true, deliveredAt: true } },
  dispatchOrders: { orderBy: { createdAt: "asc" }, select: { id: true, deliveredAt: true, cancelledAt: true } },
  deliveries: { select: { id: true, invoice: { select: { id: true } } } },
  items: { select: { qty: true, deliveryLines: { select: { qty: true } } } },
} satisfies Prisma.DealSelect;
type CaseDeal = Prisma.DealGetPayload<{ select: typeof caseSelect }>;

function build(d: CaseDeal, es: boolean): GuideCase {
  const t = (a: string, b: string) => (es ? a : b);
  const self = `/deals/${d.id}`;
  const won = d.stage === "WON" || !!d.poAcceptedAt;
  const ordered = d.items.reduce((s, x) => s + x.qty, 0);
  const delivered = d.items.reduce((s, x) => s + x.deliveryLines.reduce((a, l) => a + l.qty, 0), 0);
  const fullyDelivered = ordered > 0 ? delivered >= ordered : d.deliveries.length > 0;
  const qNo = (q: { number: string; rev: number }) => `Nº ${q.number}${q.rev ? ` Rev. ${q.rev}` : ""}`;

  const draft = d.quotes.find((q) => q.status === "DRAFT");
  const presented = d.quotes.find((q) => q.status === "PRESENTED");
  const shownQ = presented ?? d.quotes.find((q) => q.status === "ACCEPTED");
  const livePo = d.customerPos.find((p) => !p.rejectedAt && !p.acceptance) ?? d.customerPos.find((p) => !!p.acceptance);
  const spo = d.supplierPos.find((p) => !p.receivedAt) ?? d.supplierPos[d.supplierPos.length - 1];
  const ship = d.shipments.find((s) => !s.deliveredAt) ?? d.shipments[d.shipments.length - 1];
  const order = d.dispatchOrders.find((o) => !o.cancelledAt && !o.deliveredAt);

  type Raw = Omit<CaseStage, "state"> & { done: boolean };
  const raw: Record<string, Raw> = {};

  raw["need-source"] = {
    href: `${self}?tab=need`, at: [self], startStep: 0, note: null,
    done: (!!d.desiredResult && (Number(d.supplierCost) > 0 || !!d.sourcingNote || d.supplierPos.length > 0)) || d.quotes.length > 0 || won,
  };

  const quoteDone = !!shownQ || !!d.quoteSentAt || won;
  raw.quote = draft
    ? { href: `/cotizaciones/${draft.id}`, at: [`/cotizaciones/${draft.id}`], startStep: 1, done: false, note: t(`Esta Necesidad ya tiene la cotización ${qNo(draft)} en borrador: sigue desde el paso 2.`, `This Necessity already has quote ${qNo(draft)} in draft: continue from step 2.`) }
    : shownQ
      ? { href: `/cotizaciones/${shownQ.id}`, at: [`/cotizaciones/${shownQ.id}`], startStep: 0, done: true, note: t(`La cotización ${qNo(shownQ)} de esta Necesidad ya se presentó: sus precios están fijos. Para cambiarla se usa «Crear revisión». Lo que sigue es la OC del cliente.`, `Quote ${qNo(shownQ)} of this Necessity was already presented: its prices are fixed. To change it use “Create revision”. Next is the customer PO.`) }
      : { href: `${self}?tab=quote`, at: [self], startStep: 0, done: quoteDone, note: quoteDone ? t("Esta Necesidad se cotizó sin un documento de cotización en SOLU.", "This Necessity was quoted without a quote document in SOLU.") : null };

  const poDone = !!d.poAcceptedAt || d.customerPos.some((p) => !!p.acceptance);
  raw.po = livePo
    ? { href: `/po/${livePo.id}`, at: [`/po/${livePo.id}`], startStep: 1, done: poDone, note: livePo.acceptance ? t(`La OC ${livePo.number} ya está aceptada: el registro no se edita.`, `PO ${livePo.number} is already accepted: the record can't be edited.`) : t(`La OC ${livePo.number} ya está registrada: sigue desde el paso 2.`, `PO ${livePo.number} is already recorded: continue from step 2.`) }
    : presented
      ? { href: `/cotizaciones/${presented.id}`, at: [`/cotizaciones/${presented.id}`], startStep: 0, done: poDone, note: null }
      : poDone
        ? { href: `${self}?tab=execute`, at: [self], startStep: 0, done: true, note: t(`La OC del cliente${d.customerPo ? ` (${d.customerPo})` : ""} ya está aceptada en esta Necesidad.`, `The customer PO${d.customerPo ? ` (${d.customerPo})` : ""} is already accepted on this Necessity.`) }
        : { href: raw.quote.href, at: [], startStep: 0, done: false, note: t("Todavía no: la OC del cliente se registra sobre una cotización presentada. Primero presenta la cotización (etapa anterior).", "Not yet: the customer PO is recorded on a presented quote. Present the quote first (previous stage).") };

  raw.compras = spo
    ? { href: `/compras/${spo.id}`, at: [`/compras/${spo.id}`], startStep: 1, done: d.supplierPos.every((p) => !!p.confirmedAt), note: t(`Esta Necesidad ya tiene la orden ${spo.code}: sigue desde el paso 2.`, `This Necessity already has order ${spo.code}: continue from step 2.`) }
    : { href: `${self}?tab=execute`, at: [self], startStep: 0, done: false, note: won ? null : t("Esta Necesidad aún no tiene la OC del cliente aceptada. La compra al proveedor normalmente se prepara después de aceptarla.", "This Necessity has no accepted customer PO yet. The supplier purchase is normally prepared after accepting it.") };

  raw.logistica = ship
    ? { href: `/logistica/${ship.id}`, at: [`/logistica/${ship.id}`], startStep: 0, done: fullyDelivered || d.shipments.every((s) => !!s.deliveredAt), note: null }
    : { href: `${self}?tab=execute`, at: [self], startStep: 0, done: fullyDelivered, note: t("Esta Necesidad aún no tiene un envío. Se registra en la pestaña Ejecución, sección ENVÍOS, con «Registrar envío externo» (aparece cuando la OC del cliente está aceptada).", "This Necessity has no shipment yet. It is recorded on the Execute tab, SHIPMENTS section, with “Record external shipment” (shown once the customer PO is accepted).") };

  raw["ops-despachos"] = order
    ? { href: `/operaciones/despachos/${order.id}`, at: [`/operaciones/despachos/${order.id}`, `${self}/despacho`], startStep: 1, done: fullyDelivered, note: null }
    : { href: `${self}/despacho`, at: [`${self}/despacho`], startStep: 0, done: fullyDelivered, note: fullyDelivered ? t("Esta Necesidad ya está entregada completa.", "This Necessity is already fully delivered.") : won ? null : t("Todavía no: el despacho al cliente se prepara cuando su OC está aceptada.", "Not yet: the dispatch to the customer is prepared once their PO is accepted.") };

  raw.facturacion = {
    href: `${self}/facturacion`, at: [`${self}/facturacion`], startStep: 0,
    done: d.deliveries.length > 0 && d.deliveries.every((x) => !!x.invoice),
    note: d.deliveries.length === 0 ? t("Esta Necesidad aún no tiene entregas: la factura se habilita después de entregar. Por ahora la página muestra lo que el cliente pedirá.", "This Necessity has no deliveries yet: the invoice unlocks after delivering. For now the page shows what the customer will require.") : null,
  };

  raw.resultado = {
    href: `${self}/resultado`, at: [`${self}/resultado`], startStep: 0, done: !!d.closedAt,
    note: d.closedAt ? t("Esta Necesidad ya está cerrada.", "This Necessity is already closed.") : fullyDelivered ? null : t("Aún no se ha entregado todo: el resultado se confirma con el cliente después de la entrega.", "Not everything is delivered yet: the result is confirmed with the customer after delivery."),
  };

  const cur = d.closedAt ? null : ORDER.find((k) => !raw[k].done) ?? null;
  const stages: Record<string, CaseStage> = {};
  for (const k of ORDER) { const { done, ...rest } = raw[k]; stages[k] = { ...rest, state: done ? "done" : k === cur ? "now" : "later" }; }
  // Other pages of a Journey that have a guide of their own.
  const plain = (href: string): CaseStage => ({ href, at: [href.split("?")[0]], state: "now", note: null, startStep: 0 });
  stages.alcance = plain(`${self}/alcance`);
  stages.solucion = plain(`${self}/solucion`);
  stages.despacho = plain(`${self}/despacho`);
  stages["ops-garantias"] = plain(`${self}/garantia`);
  stages["m12-reparto"] = plain(`${self}/economia`);
  stages["journey-catchup"] = plain(self);
  stages.promise = plain(self);

  const name = [d.code, d.account.name, d.title].filter(Boolean).join(" · ");
  return { id: d.id, name: name.length > 90 ? `${name.slice(0, 88)}…` : name, demo: d.account.isDemo, stages, current: cur };
}

const ID = "([A-Za-z0-9_-]{6,40})";
/** The Journey behind the page the person is on, when that page belongs to one. */
async function dealOfPath(path: string): Promise<string | null> {
  const m = new RegExp(`^/deals/${ID}(?:/|$)`).exec(path);
  if (m) return m[1];
  const one = async (re: string, find: (id: string) => Promise<{ dealId: string | null } | null>) => {
    const x = new RegExp(re).exec(path);
    return x ? (await find(x[1]))?.dealId ?? null : undefined;
  };
  const tries: [string, (id: string) => Promise<{ dealId: string | null } | null>][] = [
    [`^/cotizaciones/${ID}$`, (id) => db.quote.findUnique({ where: { id }, select: { dealId: true } })],
    [`^/po/${ID}$`, (id) => db.customerPO.findUnique({ where: { id }, select: { dealId: true } })],
    [`^/compras/${ID}$`, (id) => db.supplierPO.findUnique({ where: { id }, select: { dealId: true } })],
    [`^/logistica/${ID}$`, (id) => db.shipment.findUnique({ where: { id }, select: { dealId: true } })],
    [`^/operaciones/despachos/${ID}$`, (id) => db.dispatchOrder.findUnique({ where: { id }, select: { dealId: true } })],
    [`^/operaciones/remisiones/${ID}$`, (id) => db.delivery.findUnique({ where: { id }, select: { dealId: true } })],
  ];
  for (const [re, find] of tries) { const r = await one(re, find); if (r !== undefined) return r; }
  return null;
}

/** Where the Journey of this page is (or, on a page of no Journey, the one the person was following). */
export async function guideCase(path: string, fallbackDealId: string | null, user: U, es: boolean): Promise<GuideCase | null> {
  if (isBoard(user) && !boardMayOpen("/deals")) return null;
  const id = (await dealOfPath(path.slice(0, 200))) ?? (fallbackDealId && /^[A-Za-z0-9_-]{6,40}$/.test(fallbackDealId) ? fallbackDealId : null);
  if (!id) return null;
  const d = await db.deal.findFirst({ where: { id, internal: false }, select: caseSelect });
  return d ? build(d, es) : null;
}

/** Sample Journeys to practise with, the most recently touched first. */
export async function guideExamples(user: U, es: boolean): Promise<GuideExample[]> {
  if (isBoard(user) && !boardMayOpen("/deals")) return [];
  const deals = await db.deal.findMany({ where: { internal: false, stage: { not: "LOST" }, account: { isDemo: true } }, orderBy: { updatedAt: "desc" }, take: 40, select: caseSelect });
  return deals.map((d) => {
    const c = build(d, es);
    return { id: c.id, name: c.name, current: c.current, stages: Object.fromEntries(ORDER.map((k) => [k, { href: c.stages[k].href, state: c.stages[k].state }])) };
  });
}
