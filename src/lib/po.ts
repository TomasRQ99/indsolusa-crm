import type { Prisma } from "@prisma/client";
import { addDays, daysBetween, today } from "./domain";
import { quoteNo, saleOf, validUntil } from "./quote";
import { termDays } from "./pdf-docs";
import type { makeI18n } from "./i18n";
import { lineAmount, sameMoney, subMoney } from "./money";

// A received customer PO is compared with the quote it answers BEFORE anything is promised.
// A material difference blocks the "Accept PO" command until a resolution is confirmed.
// Accepting is a Command with preconditions and effects (PoAcceptance), never a status edit.

type I = ReturnType<typeof makeI18n>;

export const poInclude = {
  lines: { orderBy: { position: "asc" } },
  resolutions: { orderBy: { chosenAt: "asc" } },
  acceptance: true,
  quote: { include: { lines: { orderBy: { position: "asc" } }, scenarios: { orderBy: { position: "asc" } } } },
  deal: { include: { account: true, contact: true, owner: { select: { id: true, name: true } } } },
} satisfies Prisma.CustomerPOInclude;

export type PoFull = Prisma.CustomerPOGetPayload<{ include: typeof poInclude }>;

export type DiffState = "match" | "minor" | "material";
export type Diff = { key: string; label: string; quote: string; po: string; state: DiffState; note?: string };
export type Option = {
  option: "AMEND_DATE" | "EXPEDITE_ABSORB" | "EXPEDITE_CHARGE";
  title: string;
  what: string;
  promiseDate: Date;
  meetsPo: boolean;
  costDelta: number;
  priceDelta: number;
  esagra: number;
  pct: number | null;
  belowFloor: boolean;
  whoActs: string;
  risk: string;
  needs: string;
  scenarioLabel?: string;
  message?: string;
  recommended?: boolean;
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function buildPo(po: PoFull, i: I, floorPct: number | null) {
  const { t } = i;
  const q = po.quote;
  const now = today();
  const base = dayOf(po.receivedAt);
  const diffs: Diff[] = [];
  const money = (v: number) => `USD ${i.n2(v)}`;

  // ---- Delivery date: the promise the quote can protect vs what the PO demands ----
  const protectedDate = q?.leadMaxDays != null ? addDays(base, q.leadMaxDays) : null;
  const dateGap = protectedDate && po.requiredBy ? daysBetween(po.requiredBy, protectedDate) : 0;
  if (protectedDate || po.requiredBy) {
    diffs.push({
      key: "date",
      label: t("Fecha de entrega", "Delivery date"),
      quote: protectedDate ? `${i.date(protectedDate)} · ${t(`${q!.leadMinDays}–${q!.leadMaxDays} días después de la PO`, `${q!.leadMinDays}–${q!.leadMaxDays} days after PO`)}` : "—",
      po: po.requiredBy ? i.date(po.requiredBy) : t("No indica", "Not stated"),
      state: dateGap > 0 ? "material" : "match",
      note: dateGap > 0 ? t(`La PO exige ${dateGap} día(s) antes de lo que la cotización protege`, `The PO demands ${dateGap} day(s) earlier than the quote protects`) : undefined,
    });
  }

  // ---- Lines (matched by code; the customer's own wording is not a difference) ----
  const qLines = q?.lines ?? [];
  const used = new Set<string>();
  po.lines.forEach((l, n) => {
    const m = qLines.find((x) => !used.has(x.id) && x.code && l.code && norm(x.code) === norm(l.code)) ?? qLines.find((x) => !used.has(x.id) && norm(x.description) === norm(l.description));
    if (m) used.add(m.id);
    const ref = l.code ?? `#${n + 1}`;
    if (!m) {
      diffs.push({ key: `line-${n}`, label: t(`Línea ${ref}`, `Line ${ref}`), quote: t("No está en la cotización", "Not in the quote"), po: `${l.qty} × ${l.description}`, state: "material", note: t("Producto no cotizado: no hay costo ni plazo que lo respalde", "Product not quoted: no cost or lead time backs it") });
      return;
    }
    diffs.push({ key: `qty-${n}`, label: t(`Cantidad · ${ref}`, `Quantity · ${ref}`), quote: String(m.qty), po: String(l.qty), state: m.qty === l.qty ? "match" : "material", note: m.qty !== l.qty ? t("Cambia costo, stock y plazo", "Changes cost, stock and lead time") : undefined });
    const pq = Number(m.unitPrice), pp = Number(l.unitPrice);
    diffs.push({ key: `price-${n}`, label: t(`Precio unitario · ${ref}`, `Unit price · ${ref}`), quote: money(pq), po: money(pp), state: sameMoney(pq, pp) ? "match" : "material", note: !sameMoney(pq, pp) ? t(`Diferencia de ${money(lineAmount(l.qty, subMoney(pp, pq)))} en la línea`, `Difference of ${money(lineAmount(l.qty, subMoney(pp, pq)))} on the line`) : undefined });
    if (norm(m.description) !== norm(l.description)) diffs.push({ key: `desc-${n}`, label: t(`Descripción · ${ref}`, `Description · ${ref}`), quote: m.description, po: l.description, state: "minor", note: t("Mismo código: es la redacción del cliente, no cambia lo que se entrega", "Same code: it's the customer's wording, it doesn't change what is delivered") });
  });
  qLines.filter((x) => !used.has(x.id)).forEach((x) => diffs.push({ key: `miss-${x.id}`, label: t(`Línea ${x.code ?? x.description}`, `Line ${x.code ?? x.description}`), quote: `${x.qty} × ${x.description}`, po: t("No viene en la PO", "Not in the PO"), state: "material", note: t("Entrega parcial no acordada", "Partial delivery not agreed") }));

  const quoteTotal = q ? saleOf(q.lines) : 0;
  const poTotal = saleOf(po.lines);
  diffs.push({ key: "total", label: "Total", quote: money(quoteTotal), po: money(poTotal), state: Math.abs(quoteTotal - poTotal) < 0.005 ? "match" : "material" });

  // ---- Commercial terms ----
  const incQ = norm(q?.incoterm), incP = norm(po.incoterm);
  diffs.push({ key: "incoterm", label: "Incoterm", quote: q?.incoterm ?? "—", po: po.incoterm ?? t("No indica", "Not stated"), state: !incP || incQ === incP ? "match" : incQ.split(" ")[0] !== incP.split(" ")[0] ? "material" : "minor", note: incP && incQ.split(" ")[0] !== incP.split(" ")[0] ? t("Cambia quién paga flete y riesgo", "Changes who pays freight and risk") : undefined });
  const dq = termDays(q?.paymentTerms), dp = termDays(po.paymentTerms, dq);
  diffs.push({ key: "payment", label: t("Condiciones de pago", "Payment terms"), quote: q?.paymentTerms ?? "—", po: po.paymentTerms ?? t("No indica", "Not stated"), state: dp === dq ? "match" : dp > dq ? "material" : "minor", note: dp > dq ? t(`El cliente pagaría ${dp - dq} días después: cambia la caja`, `The customer would pay ${dp - dq} days later: changes cash`) : undefined });
  if (po.shipTo) diffs.push({ key: "shipto", label: t("Enviar a", "Ship to"), quote: q?.shipTo?.split("\n").slice(0, 2).join(", ") ?? "—", po: po.shipTo, state: norm(q?.shipTo).includes(norm(po.shipTo).split(" ").slice(-2).join(" ")) ? "match" : "minor" });
  if (q) {
    const ref = norm(po.quoteRef);
    const cites = ref.includes(norm(q.number)) && (q.rev === 0 || ref.includes(`rev ${q.rev}`));
    diffs.push({ key: "ref", label: t("Cotización citada", "Quote cited"), quote: `Nº ${quoteNo(q)}`, po: po.quoteRef ?? t("No cita", "Not cited"), state: !po.quoteRef ? "minor" : cites ? "match" : "material", note: po.quoteRef && !cites ? t("La PO responde a otra versión de la cotización", "The PO answers another quote version") : undefined });
    const offerUntil = validUntil(q);
    diffs.push({ key: "validity", label: t("Dentro de la vigencia", "Within validity"), quote: t(`Oferta hasta ${i.date(offerUntil)}`, `Offer until ${i.date(offerUntil)}`), po: t(`Recibida ${i.date(base)}`, `Received ${i.date(base)}`), state: base <= offerUntil ? "match" : "material", note: base > offerUntil ? t("La oferta ya había vencido: costos y plazos pueden haber cambiado", "The offer had expired: costs and lead times may have changed") : undefined });
  }

  const material = diffs.filter((d) => d.state === "material");
  const dateMaterial = material.some((d) => d.key === "date");

  // ---- Resolution options for the date difference (only what the quote's own data supports) ----
  const options: Option[] = [];
  if (q && dateMaterial && protectedDate && po.requiredBy) {
    const sale = q.protSale != null ? Number(q.protSale) : quoteTotal;
    const cost = q.protCost != null ? Number(q.protCost) : 0;
    const pctOf = (e: number, s: number) => (s > 0 ? (e / s) * 100 : null);
    const below = (p: number | null) => floorPct != null && p != null && p < floorPct;
    const first = po.deal.contact?.firstName ?? "";
    const e0 = sale - cost;
    options.push({
      option: "AMEND_DATE",
      title: t(`Pedir a ${po.deal.account.name.replace(/ \(ejemplo\)$/, "")} que ajuste la fecha al ${i.day(protectedDate)}`, `Ask ${po.deal.account.name.replace(/ \(ejemplo\)$/, "")} to move the date to ${i.day(protectedDate)}`),
      what: t("Mantiene la solución cotizada. El cliente corrige la PO o confirma por escrito la fecha.", "Keeps the quoted solution. The customer amends the PO or confirms the date in writing."),
      promiseDate: protectedDate, meetsPo: false, costDelta: 0, priceDelta: 0, esagra: e0, pct: pctOf(e0, sale), belowFloor: below(pctOf(e0, sale)),
      whoActs: t("El cliente", "The customer"),
      risk: t(`Si de verdad necesita la fecha de la PO, la línea sigue parada ${dateGap} día(s) más`, `If they truly need the PO date, the line stays down ${dateGap} more day(s)`),
      needs: t("Confirmación escrita del cliente o PO corregida", "Customer's written confirmation or amended PO"),
      message: t(
        `Hola ${first}, gracias por la PO ${po.number}. La cotización ${quoteNo(q)} protege la entrega el ${i.date(protectedDate)} (${q.leadMinDays}–${q.leadMaxDays} días después de la PO) y la PO pide el ${i.date(po.requiredBy)}. ¿Nos confirmas por escrito el ${i.date(protectedDate)} o nos envías la PO con esa fecha? Si necesitas el ${i.date(po.requiredBy)} sin falta, te propongo el envío aéreo.`,
        `Hi ${first}, thanks for PO ${po.number}. Quote ${quoteNo(q)} protects delivery on ${i.date(protectedDate)} (${q.leadMinDays}–${q.leadMaxDays} days after PO) and the PO asks for ${i.date(po.requiredBy)}. Can you confirm ${i.date(protectedDate)} in writing or send the PO with that date? If you need ${i.date(po.requiredBy)} for sure, I can propose air freight.`,
      ),
    });
    const fast = q.scenarios.filter((s) => addDays(base, s.leadMaxDays) <= po.requiredBy!).sort((a, b) => Number(a.cost) - Number(b.cost))[0];
    if (fast) {
      const fd = addDays(base, fast.leadMaxDays);
      const delta = Number(fast.cost) - cost;
      const eA = sale - cost - delta;
      options.push({
        option: "EXPEDITE_ABSORB", scenarioLabel: fast.label,
        title: t(`Cumplir el ${i.day(po.requiredBy)} con «${fast.label}» y absorber el costo`, `Meet ${i.day(po.requiredBy)} with "${fast.label}" and absorb the cost`),
        what: t(`Llega el ${i.day(fd)}. El precio al cliente no cambia; la eságara baja ${money(delta)}.`, `Arrives ${i.day(fd)}. Customer price unchanged; eságara drops ${money(delta)}.`),
        promiseDate: fd, meetsPo: true, costDelta: delta, priceDelta: 0, esagra: eA, pct: pctOf(eA, sale), belowFloor: below(pctOf(eA, sale)),
        whoActs: t("Nosotros y el proveedor", "Us and the supplier"),
        risk: fast.risk,
        needs: t("Confirmación del proveedor de despacho aéreo y plazo", "Supplier confirmation of air dispatch and lead time"),
        recommended: !below(pctOf(eA, sale)),
      });
      const pDelta = Number(fast.price) - sale;
      const eC = Number(fast.price) - Number(fast.cost);
      options.push({
        option: "EXPEDITE_CHARGE", scenarioLabel: fast.label,
        title: t(`Cumplir el ${i.day(po.requiredBy)} y cobrar la diferencia (${money(pDelta)})`, `Meet ${i.day(po.requiredBy)} and charge the difference (${money(pDelta)})`),
        what: t(`Llega el ${i.day(fd)} a ${money(Number(fast.price))}. La eságara se mantiene.`, `Arrives ${i.day(fd)} at ${money(Number(fast.price))}. Eságara holds.`),
        promiseDate: fd, meetsPo: true, costDelta: delta, priceDelta: pDelta, esagra: eC, pct: pctOf(eC, Number(fast.price)), belowFloor: below(pctOf(eC, Number(fast.price))),
        whoActs: t("El cliente aprueba el nuevo valor", "The customer approves the new amount"),
        risk: t("El cliente puede demorar la aprobación del mayor valor", "The customer may take time to approve the higher amount"),
        needs: t("PO corregida con el nuevo valor y confirmación del proveedor", "Amended PO with the new amount and supplier confirmation"),
        message: t(
          `Hola ${first}, para entregar el ${i.date(po.requiredBy)} como pide la PO ${po.number} hay que enviar por aéreo directo; el valor pasa a ${money(Number(fast.price))} (+${money(pDelta)}). ¿Nos envías la PO con ese valor? Con eso confirmamos el despacho hoy.`,
          `Hi ${first}, to deliver on ${i.date(po.requiredBy)} as PO ${po.number} asks, we need direct air freight; the amount becomes ${money(Number(fast.price))} (+${money(pDelta)}). Could you send the PO with that amount? Then we confirm dispatch today.`,
        ),
      });
    }
  }

  const accepted = !!po.acceptance;
  const rejected = !!po.rejectedAt;
  const active = po.resolutions.filter((r) => r.state !== "WITHDRAWN");
  const chosen = active[active.length - 1] ?? null;
  const resolvedDate = !dateMaterial || chosen?.state === "CONFIRMED";
  const otherMaterial = material.filter((d) => d.key !== "date");
  const promiseDate = chosen?.state === "CONFIRMED" ? chosen.promiseDate : protectedDate ?? po.requiredBy ?? null;

  // ---- Preconditions of the Accept PO command ----
  const pre = [
    { ok: !!q && (q.status === "PRESENTED" || q.status === "ACCEPTED"), text: t("Responde a una cotización presentada y vigente", "Answers a presented, current quote") },
    { ok: resolvedDate, text: dateMaterial ? t("La diferencia de fecha tiene una resolución confirmada", "The date difference has a confirmed resolution") : t("La fecha de la PO se puede proteger", "The PO date can be protected") },
    { ok: otherMaterial.length === 0, text: otherMaterial.length ? t(`Otras diferencias materiales: ${otherMaterial.map((d) => d.label.toLowerCase()).join(", ")}`, `Other material differences: ${otherMaterial.map((d) => d.label.toLowerCase()).join(", ")}`) : t("Productos, cantidades, precios y condiciones coinciden", "Products, quantities, prices and terms match") },
    { ok: !chosen || chosen.state !== "CONFIRMED" || !options.find((o) => o.option === chosen.option)?.belowFloor, text: t("La eságara resultante respeta el piso de la política", "Resulting eságara respects the policy floor") },
  ];
  const canAccept = !accepted && !rejected && pre.every((p) => p.ok);

  return { diffs, material, dateMaterial, dateGap, protectedDate, options, chosen, pre, canAccept, accepted, rejected, promiseDate, quoteTotal, poTotal, base, now };
}
