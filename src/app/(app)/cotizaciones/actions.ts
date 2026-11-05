"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { nextDocNumber, today } from "@/lib/domain";
import { buildQuote, costOf, policyFloor, quoteInclude, quoteNo, saleOf, validUntil } from "@/lib/quote";
import { makeI18n } from "@/lib/i18n";

const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 2000) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const num = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v < 1e12 ? v : null;
};
const int = (fd: FormData, k: string) => {
  const v = num(fd, k);
  return v == null ? null : Math.round(v);
};

const back = (id: string, qs: string): never => {
  refreshApp();
  redirect(`/cotizaciones/${id}?${qs}`);
};

async function editableQuote(id: string) {
  const user = await requireUser();
  const q = await db.quote.findUniqueOrThrow({ where: { id }, include: { deal: { select: { id: true, ownerId: true, accountId: true } } } });
  assertCanEdit(user, q.deal.ownerId);
  return { user, q };
}

async function draftOnly(id: string) {
  const r = await editableQuote(id);
  if (r.q.status !== "DRAFT") back(id, "err=presentada");
  return r;
}

/** New quote for a Journey: starts from what the Journey already knows (products, costs, terms). */
export async function createQuote(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { items: true, account: true } });
  assertCanEdit(user, deal.ownerId);
  const open = await db.quote.findFirst({ where: { dealId, status: "DRAFT" } });
  if (open) back(open.id, "ok=abierta");
  const q = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx);
    return tx.quote.create({
      data: {
        dealId,
        number,
        lang: deal.account.docLang,
        createdById: user.id,
        supplierCost: deal.supplierCost,
        freightCost: deal.freightCost,
        otherCosts: deal.otherCosts,
        incoterm: deal.incoterm,
        paymentTerms: deal.paymentTerms ?? `Net ${deal.account.paymentTermsDays}`,
        billTo: [deal.account.name, deal.account.address].filter(Boolean).join("\n"),
        shipTo: [deal.account.name, deal.account.address].filter(Boolean).join("\n"),
        promiseText: deal.promiseText,
        lines: { create: deal.items.map((it, n) => ({ position: n, qty: it.qty, code: it.code, description: it.description, unitPrice: it.unitPrice })) },
      },
    });
  });
  back(q.id, "ok=creada");
}

/** Solution · promise. */
export async function saveSolution(id: string, fd: FormData) {
  await draftOnly(id);
  await db.quote.update({
    where: { id },
    data: {
      solution: txt(fd, "solution", 400),
      supplyPrimary: txt(fd, "supplyPrimary", 300),
      supplyAlt: txt(fd, "supplyAlt", 300),
      promiseText: txt(fd, "promiseText", 300),
      promiseCondition: txt(fd, "promiseCondition", 300),
    },
  });
  back(id, "ok=solucion");
}

/** Landed cost: each component keeps its source; a change records why. */
export async function saveCosts(id: string, fd: FormData) {
  await draftOnly(id);
  const cur = String(fd.get("costCurrency") ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";
  await db.quote.update({
    where: { id },
    data: {
      costCurrency: cur,
      fxRate: cur === "USD" ? null : num(fd, "fxRate"),
      fxSource: cur === "USD" ? null : txt(fd, "fxSource", 200),
      supplierCost: num(fd, "supplierCost") ?? 0,
      supplierSrc: txt(fd, "supplierSrc", 200),
      freightCost: num(fd, "freightCost") ?? 0,
      freightSrc: txt(fd, "freightSrc", 200),
      otherCosts: num(fd, "otherCosts") ?? 0,
      otherSrc: txt(fd, "otherSrc", 200),
      changeNote: txt(fd, "changeNote", 300),
    },
  });
  back(id, "ok=costos");
}

/** Terms printed on the document and the customer's decision path. */
export async function saveTerms(id: string, fd: FormData) {
  const { q } = await editableQuote(id);
  const lang = fd.get("lang") === "ES" ? "ES" : "EN";
  const decision = {
    decisionAt: dayOf(fd.get("decisionAt")),
    decisionLabel: txt(fd, "decisionLabel", 80),
    decisionPath: txt(fd, "decisionPath", 400),
    decisionEvidence: txt(fd, "decisionEvidence", 300),
    promiseDecideBy: dayOf(fd.get("promiseDecideBy")),
    supplierValidUntil: dayOf(fd.get("supplierValidUntil")),
    supplyConfirmed: fd.get("supplyConfirmed") === "1",
  };
  // After presenting, the document is immutable: only the decision future can still be updated.
  const docFields =
    q.status === "DRAFT"
      ? {
          lang: lang as "ES" | "EN",
          billTo: txt(fd, "billTo", 400),
          shipTo: txt(fd, "shipTo", 400),
          leadMinDays: int(fd, "leadMinDays"),
          leadMaxDays: int(fd, "leadMaxDays"),
          incoterm: txt(fd, "incoterm", 80),
          paymentTerms: txt(fd, "paymentTerms", 120),
          validityDays: int(fd, "validityDays") ?? 30,
          condition: txt(fd, "condition", 80) ?? "New & original",
        }
      : {};
  await db.quote.update({ where: { id }, data: { ...docFields, ...decision } });
  back(id, "ok=condiciones");
}

export async function saveLine(id: string, lineId: string | null, fd: FormData) {
  await draftOnly(id);
  const data = {
    qty: Math.max(1, int(fd, "qty") ?? 1),
    code: txt(fd, "code", 60),
    description: txt(fd, "description", 300) ?? "—",
    unitPrice: num(fd, "unitPrice") ?? 0,
  };
  if (lineId) await db.quoteLine.update({ where: { id: lineId, quoteId: id }, data });
  else await db.quoteLine.create({ data: { ...data, quoteId: id, position: await db.quoteLine.count({ where: { quoteId: id } }) } });
  back(id, "ok=linea");
}

export async function removeLine(id: string, lineId: string) {
  await draftOnly(id);
  await db.quoteLine.delete({ where: { id: lineId, quoteId: id } });
  back(id, "ok=linea");
}

export async function saveScenario(id: string, scenarioId: string | null, fd: FormData) {
  await draftOnly(id);
  const data = {
    label: txt(fd, "label", 60) ?? "—",
    price: num(fd, "price") ?? 0,
    cost: num(fd, "cost") ?? 0,
    leadMinDays: int(fd, "leadMinDays") ?? 0,
    leadMaxDays: int(fd, "leadMaxDays") ?? 0,
    risk: txt(fd, "risk", 200) ?? "—",
    promise: txt(fd, "promise", 200) ?? "—",
    why: txt(fd, "why", 300),
  };
  if (scenarioId) await db.quoteScenario.update({ where: { id: scenarioId, quoteId: id }, data });
  else await db.quoteScenario.create({ data: { ...data, quoteId: id, position: await db.quoteScenario.count({ where: { quoteId: id } }) } });
  back(id, "ok=escenario");
}

/** The recommended scenario becomes the quote: price and lead time follow it. */
export async function recommendScenario(id: string, scenarioId: string) {
  await draftOnly(id);
  await db.$transaction([
    db.quoteScenario.updateMany({ where: { quoteId: id }, data: { recommended: false } }),
    db.quoteScenario.update({ where: { id: scenarioId, quoteId: id }, data: { recommended: true } }),
  ]);
  const s = await db.quoteScenario.findUniqueOrThrow({ where: { id: scenarioId } });
  await db.quote.update({ where: { id }, data: { leadMinDays: s.leadMinDays, leadMaxDays: s.leadMaxDays } });
  back(id, "ok=recomendado");
}

export async function removeScenario(id: string, scenarioId: string) {
  await draftOnly(id);
  await db.quoteScenario.delete({ where: { id: scenarioId, quoteId: id } });
  back(id, "ok=escenario");
}

/** Present: creates the immutable version and protects its economics. Only when nothing blocks. */
export async function presentQuote(id: string, fd: FormData) {
  const { user } = await draftOnly(id);
  const q = await db.quote.findUniqueOrThrow({ where: { id }, include: quoteInclude });
  const policy = await policyFloor();
  const b = buildQuote(q, makeI18n(user.lang), policy);
  if (b.blocking.length > 0) back(id, "err=bloqueada");
  const on = dayOf(fd.get("presentedOn")) ?? today();
  const sale = saleOf(q.lines);
  const cost = costOf(q);
  const how = txt(fd, "how", 200) ?? "Correo al cliente";
  await db.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id },
      data: { status: "PRESENTED", issuedAt: on, presentedAt: on, protSale: sale, protCost: cost, protEsagra: sale - cost, protPolicy: policy.version },
    });
    await tx.quote.updateMany({ where: { number: q.number, id: { not: id }, status: "PRESENTED" }, data: { status: "SUPERSEDED" } });
    const offerUntil = validUntil({ issuedAt: on, presentedAt: on, validityDays: q.validityDays });
    await tx.deal.update({
      where: { id: q.dealId },
      data: {
        amount: sale,
        supplierCost: Number(q.supplierCost) * (q.fxRate ? Number(q.fxRate) : 1),
        freightCost: q.freightCost,
        otherCosts: q.otherCosts,
        incoterm: q.incoterm,
        paymentTerms: q.paymentTerms,
        promiseText: q.promiseText ?? q.deal.promiseText,
        quoteSentAt: on,
        offerValidUntil: offerUntil,
        ...(q.decisionAt ? { closeDate: q.decisionAt } : {}),
        ...(q.deal.stage === "LEAD" || q.deal.stage === "QUALIFIED" ? { stage: "PROPOSAL" as const } : {}),
      },
    });
    await tx.activity.create({
      data: { type: "NOTE", subject: `Cotización ${quoteNo(q)} presentada · USD ${sale.toFixed(2)}`, userId: user.id, accountId: q.deal.accountId, dealId: q.dealId, phase: "quote", source: how, occurredAt: on },
    });
  });
  back(id, "ok=presentada");
}

/** A change after presenting creates "Rev. N" with the same number; the presented one stays as it was. */
export async function createRevision(id: string) {
  const { user, q } = await editableQuote(id);
  if (q.status === "DRAFT") back(id, "ok=abierta");
  const existing = await db.quote.findFirst({ where: { number: q.number, status: "DRAFT" } });
  if (existing) back(existing.id, "ok=abierta");
  const src = await db.quote.findUniqueOrThrow({ where: { id }, include: { lines: true, scenarios: true } });
  const top = await db.quote.aggregate({ where: { number: q.number }, _max: { rev: true } });
  const { id: _i, createdAt: _c, issuedAt: _is, presentedAt: _p, decidedAt: _d, protSale: _ps, protCost: _pc, protEsagra: _pe, protPolicy: _pp, status: _s, rev: _r, createdById: _cb, changeNote: _cn, lines, scenarios, ...rest } = src;
  const nq = await db.quote.create({
    data: {
      ...rest,
      rev: (top._max.rev ?? 0) + 1,
      createdById: user.id,
      lines: { create: lines.map(({ id: _x, quoteId: _y, ...l }) => l) },
      scenarios: { create: scenarios.map(({ id: _x, quoteId: _y, ...s }) => s) },
    },
  });
  back(nq.id, "ok=revision");
}

// Accepting a customer's PO is not done here: it is the "Accept PO" command (po/actions.ts),
// which first compares the PO with this quote.

export async function markDeclined(id: string, fd: FormData) {
  const { user, q } = await editableQuote(id);
  if (q.status !== "PRESENTED") back(id, "err=estado");
  const why = txt(fd, "why", 300) ?? "Sin motivo registrado";
  await db.$transaction(async (tx) => {
    await tx.quote.update({ where: { id }, data: { status: "DECLINED", decidedAt: today() } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Cotización ${quoteNo(q)} no aceptada: ${why}`.slice(0, 200), userId: user.id, accountId: q.deal.accountId, dealId: q.dealId, phase: "quote", source: txt(fd, "source", 200) } });
  });
  back(id, "ok=rechazada");
}

/** Waiting with Control from the quote: what SOLU watches and when it brings it back. */
export async function waitWithControl(id: string, fd: FormData) {
  const { q } = await editableQuote(id);
  const what = txt(fd, "waitingFor", 200);
  const until = dayOf(fd.get("waitingUntil"));
  if (!what || !until) back(id, "err=espera");
  await db.deal.update({ where: { id: q.dealId }, data: { waitingFor: what, waitingUntil: until, nextMove: null, nextMoveDate: null } });
  back(id, "ok=espera");
}
