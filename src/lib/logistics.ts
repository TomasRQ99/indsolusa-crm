import type { Prisma } from "@prisma/client";
import { addDays, daysBetween, today } from "./domain";
import type { makeI18n } from "./i18n";

// Logistics Forward View.
// The Shipment is its own object. Five truths are kept apart and never overwrite each other:
//   NOW (physical state) · FORWARD (does the result hold?) · Carrier ETA (what the carrier says)
//   · SOLU Expected (when the customer really has it) · Customer Promise (what we said, on the Deal).
// Normal carrier scans are summarised, never turned into actions. Only material exceptions are interpreted.

type I = ReturnType<typeof makeI18n>;

/** Days SOLU adds after the carrier's arrival (same rule the Journey uses). */
export const CLEARANCE_DAYS = 3;
export const LAST_MILE_DAYS = 1;
/** After a customs hold, typical release once documents are complete. */
export const HOLD_RELEASE_DAYS = 2;
/** SOLU's assumption for an expedited service from today, by mode (to confirm with the carrier). */
export const EXPEDITE_DAYS: Record<string, number> = { AIR: 2, COURIER: 2, OCEAN: 6, GROUND: 1 };

export type ShipDoc = { key: string; label: string; ready: boolean; note?: string };

export function defaultDocs(mode: string, international: boolean): ShipDoc[] {
  if (!international) return [{ key: "rem", label: "Remisión / guía nacional", ready: true }];
  return [
    { key: "ci", label: "Factura comercial", ready: false },
    { key: "pl", label: "Lista de empaque", ready: false },
    { key: "awb", label: mode === "OCEAN" ? "Conocimiento de embarque (BL)" : "Guía aérea (AWB)", ready: false },
    { key: "co", label: "Certificado de origen", ready: false },
  ];
}

export const shipInclude = {
  deal: {
    include: {
      account: true,
      contact: true,
      owner: { select: { id: true, name: true } },
      items: { include: { deliveryLines: { select: { qty: true } } }, orderBy: { id: "asc" } },
      quotes: { where: { status: "ACCEPTED" }, select: { supplyPrimary: true, supplyAlt: true, number: true } },
    },
  },
  supplierPo: { include: { supplier: true } },
  lines: true,
  events: { orderBy: { at: "asc" } },
  decisions: { orderBy: { decidedAt: "desc" } },
  delivery: { select: { id: true, code: true } },
} satisfies Prisma.ShipmentInclude;
export type ShipFull = Prisma.ShipmentGetPayload<{ include: typeof shipInclude }>;

/** The minimum a shipment needs for SOLU's expected date (also used by the Journey). */
export type ShipCore = {
  international: boolean;
  toCustomer: boolean;
  customs: string;
  carrierEta: Date | null;
  plannedDelivery: Date | null;
  deliveredAt: Date | null;
  receipt: string;
  receivedAt: Date | null;
};

const later = (a: Date, b: Date) => (a > b ? a : b);

/** SOLU Expected Delivery: when the customer actually has it. Never overwrites the customer promise. */
export function expectedOf(s: ShipCore, i: I) {
  const { t } = i;
  const now = today();
  const lastMile = s.toCustomer ? 0 : LAST_MILE_DAYS;
  const customsDays = s.international && s.customs === "PENDING" ? CLEARANCE_DAYS : 0;
  if (s.receipt === "CONFIRMED" && s.receivedAt) return { date: s.receivedAt, done: true, conditional: false, calc: t("Recibido por el cliente", "Received by the customer") };
  if (s.receipt === "DISPUTED") return { date: null, done: false, conditional: false, calc: t("El transportista dice entregado; el cliente no lo confirma", "Carrier says delivered; the customer doesn't confirm") };
  if (s.deliveredAt && s.toCustomer) return { date: s.deliveredAt, done: false, conditional: false, calc: t("El transportista lo entregó; falta la confirmación del cliente", "Carrier delivered it; customer confirmation pending") };
  const carrierDate = s.deliveredAt ?? s.carrierEta ?? s.plannedDelivery;
  if (s.customs === "HOLD") {
    const base = carrierDate ? later(now, carrierDate) : now;
    return { date: addDays(base, HOLD_RELEASE_DAYS + lastMile), done: false, conditional: true, calc: t(`Retenido en aduana: liberación ≈ ${HOLD_RELEASE_DAYS} días después de completar documentos + ${lastMile} de entrega`, `Customs hold: release ≈ ${HOLD_RELEASE_DAYS} days after documents are complete + ${lastMile} to deliver`) };
  }
  if (!carrierDate) return { date: null, done: false, conditional: false, calc: t("Falta la ETA del transportista para calcular", "Carrier ETA needed to calculate") };
  const late = !s.deliveredAt && carrierDate < now;
  const base = late ? now : carrierDate;
  const parts = [customsDays ? t(`${customsDays} aduana/recibo`, `${customsDays} customs/receiving`) : "", lastMile ? t(`${lastMile} entrega`, `${lastMile} delivery`) : ""].filter(Boolean).join(" + ");
  const head = s.deliveredAt
    ? t(`Llegó ${i.day(s.deliveredAt)}`, `Arrived ${i.day(s.deliveredAt)}`)
    : late ? t(`La ETA (${i.day(carrierDate)}) pasó sin llegada · hoy`, `ETA (${i.day(carrierDate)}) passed without arrival · today`)
    : t(`ETA transportista ${i.day(carrierDate)}`, `Carrier ETA ${i.day(carrierDate)}`);
  return { date: addDays(base, customsDays + lastMile), done: false, conditional: false, calc: parts ? `${head} + ${parts}` : head };
}

export type FwdKey = "RECEIVED" | "DISPUTED" | "HOLD" | "RISK" | "PROTECTED" | "UNKNOWN";
export type OptKey = "EXPEDITE" | "SPLIT" | "DIRECT" | "ALTERNATE" | "COMMUNICATE" | "DOCS" | "BROKER" | "POD" | "CLAIM";
export type Opt = { key: OptKey; title: string; what: string; newExpected: Date | null; fits: boolean | null; partial?: boolean; assumption: string; draft?: string };

const rel = (i: I, d: Date) => {
  const h = Math.round((Date.now() - d.getTime()) / 3600e3);
  if (h < 1) return i.t("hace minutos", "minutes ago");
  if (h < 48) return i.t(`hace ${h} h`, `${h} h ago`);
  return i.t(`hace ${Math.round(h / 24)} días`, `${Math.round(h / 24)} days ago`);
};

export function buildShipment(s: ShipFull, i: I) {
  const { t } = i;
  const now = today();
  const deal = s.deal;
  const promise = deal.promisedDate;
  const exp = expectedOf(s, i);
  const lastMile = s.toCustomer ? 0 : LAST_MILE_DAYS;
  const customsDays = s.international && s.customs === "PENDING" ? CLEARANCE_DAYS : 0;
  const buffer = customsDays + lastMile;
  const gap = exp.date && promise ? daysBetween(promise, exp.date) : null; // > 0 = later than promised
  const docs = (Array.isArray(s.docs) ? (s.docs as unknown as ShipDoc[]) : []) ?? [];
  const missingDocs = docs.filter((d) => !d.ready);
  const contents = s.lines.map((l) => `${l.qty} × ${l.description}`).join(" · ");

  // ---------- Checkpoints: normal scans summarised, material ones interpreted ----------
  const scans = s.events.filter((e) => e.kind === "SCAN" && !e.material);
  const lastScan = [...s.events].reverse().find((e) => e.kind === "SCAN" || e.kind === "CUSTOMS" || e.kind === "EXCEPTION" || e.kind === "DELIVERED") ?? null;
  const etaChanges = s.events.filter((e) => e.kind === "ETA_CHANGE" || (e.kind === "EXCEPTION" && e.etaAfter));
  const crosses = (eta: Date | null) => !!eta && !!promise && addDays(eta, buffer) > promise;
  const withinChanges = etaChanges.filter((e) => !crosses(e.etaAfter));
  const material = s.events
    .filter((e) => e.material || e.kind === "EXCEPTION" || e.kind === "CUSTOMS" || (e.kind === "ETA_CHANGE" && crosses(e.etaAfter)))
    .map((e) => {
      let impact: string;
      let tone: "risk" | "attn" | "ok" = "attn";
      if (e.etaAfter) {
        const ex = addDays(e.etaAfter, buffer);
        if (crosses(e.etaAfter)) { impact = t(`Cruza la promesa: SOLU pasa a esperar ${i.day(ex)} (prometimos ${i.day(promise)})`, `Crosses the promise: SOLU now expects ${i.day(ex)} (we promised ${i.day(promise)})`); tone = "risk"; }
        else { impact = t(`Sigue dentro de la promesa: SOLU espera ${i.day(ex)}`, `Still within the promise: SOLU expects ${i.day(ex)}`); tone = "ok"; }
      } else if (e.kind === "CUSTOMS") {
        const latestCustoms = [...s.events].reverse().find((x) => x.kind === "CUSTOMS");
        if (s.customs === "HOLD" && latestCustoms?.id === e.id) { impact = missingDocs.length ? t(`Detiene el envío hasta completar: ${missingDocs.map((d) => d.label).join(", ")}`, `Stops the shipment until complete: ${missingDocs.map((d) => d.label).join(", ")}`) : t("Detiene el envío hasta que la aduana lo libere", "Stops the shipment until customs releases it"); tone = "risk"; }
        else { impact = t("Resuelto", "Resolved"); tone = "ok"; }
      } else if (s.receipt === "DISPUTED" && e.kind === "NOTE") { impact = t("El recibo queda en disputa: no se factura ni se cierra hasta resolver", "Receipt is disputed: no invoicing or closing until resolved"); tone = "risk"; }
      else impact = gap != null && gap > 0 ? t("Contribuye a que la entrega pase la promesa", "Contributes to delivery passing the promise") : t("Sin cambio en la fecha esperada", "No change to the expected date");
      return { e, impact, tone };
    });

  // ---------- NOW: real physical state (never "Delayed") ----------
  const nowState =
    s.receipt === "CONFIRMED" ? { label: t("Recibido por el cliente", "Received by the customer"), where: s.destination, when: s.receivedAt, src: s.receivedByName ?? "" }
    : s.receipt === "DISPUTED" ? { label: t("Entregado según el transportista · el cliente no lo confirma", "Delivered per carrier · customer doesn't confirm"), where: s.destination, when: s.deliveredAt, src: s.deliveredNote ?? "" }
    : s.deliveredAt ? { label: s.toCustomer ? t("Entregado por el transportista", "Delivered by the carrier") : t("Llegó a destino del transportista", "Arrived at the carrier's destination"), where: s.destination, when: s.deliveredAt, src: s.deliveredNote ?? "" }
    : s.customs === "HOLD" ? { label: t("Retenido en aduana", "Held at customs"), where: lastScan?.location ?? s.destination, when: lastScan?.at ?? null, src: s.customsNote ?? "" }
    : s.pickedUpAt ? { label: t("En tránsito", "In transit"), where: lastScan?.location ?? null, when: lastScan?.at ?? s.pickedUpAt, src: lastScan ? `${s.carrierName} · ${rel(i, lastScan.at)}` : s.carrierName }
    : s.rtsAt ? { label: t("Listo en origen, esperando recogida", "Ready at origin, awaiting pickup"), where: s.origin, when: s.rtsAt, src: "" }
    : { label: t("En preparación en el proveedor", "Being prepared by the supplier"), where: s.origin, when: null, src: "" };

  // ---------- FORWARD: does the result hold? ----------
  const holdDeadline = promise ? addDays(promise, -(HOLD_RELEASE_DAYS + lastMile)) : null;
  let fwd: { key: FwdKey; tone: "ok" | "risk" | "attn" | "wait"; label: string; headline: string; detail: string };
  if (s.receipt === "CONFIRMED") fwd = { key: "RECEIVED", tone: "ok", label: gap != null && gap > 0 ? t("Recibido tarde", "Received late") : t("Recibido · promesa cumplida", "Received · promise kept"), headline: gap != null && gap > 0 ? t(`Llegó ${gap} días después de la promesa.`, `Arrived ${gap} days after the promise.`) : t("El cliente confirmó el recibo.", "The customer confirmed receipt."), detail: s.receivedByName ? t(`Confirmó ${s.receivedByName} el ${i.day(s.receivedAt)}.`, `Confirmed by ${s.receivedByName} on ${i.day(s.receivedAt)}.`) : "" };
  else if (s.receipt === "DISPUTED") fwd = { key: "DISPUTED", tone: "risk", label: t("Recibo en disputa", "Receipt disputed"), headline: t(`${s.carrierName} dice entregado el ${i.day(s.deliveredAt)}; ${deal.account.name} dice que no lo tiene completo.`, `${s.carrierName} says delivered on ${i.day(s.deliveredAt)}; ${deal.account.name} says it isn't complete.`), detail: s.disputeNote ?? "" };
  else if (s.customs === "HOLD") {
    const fits = !!exp.date && !!promise && exp.date <= promise;
    fwd = fits
      ? { key: "HOLD", tone: "attn", label: t("Retenido en aduana · aún protegido", "Customs hold · still protected"), headline: t(`Se protege la promesa si la aduana lo libera a más tardar el ${i.day(holdDeadline)}.`, `The promise holds if customs releases it by ${i.day(holdDeadline)}.`), detail: missingDocs.length ? t(`Falta: ${missingDocs.map((d) => d.label).join(", ")}.`, `Missing: ${missingDocs.map((d) => d.label).join(", ")}.`) : (s.customsNote ?? "") }
      : { key: "RISK", tone: "risk", label: t("Resultado en riesgo", "Result at Risk"), headline: t(`Retenido en aduana: aun liberándolo hoy, SOLU espera ${i.day(exp.date)} y prometimos ${i.day(promise)}.`, `Customs hold: even if released today, SOLU expects ${i.day(exp.date)} and we promised ${i.day(promise)}.`), detail: s.customsNote ?? "" };
  } else if (!promise) fwd = { key: "UNKNOWN", tone: "wait", label: t("Sin promesa con fecha", "No dated promise"), headline: t("No hay una fecha prometida para comparar.", "There's no promised date to compare with."), detail: t("Registra la promesa en el Journey.", "Record the promise on the Journey.") };
  else if (!exp.date) fwd = { key: "UNKNOWN", tone: "wait", label: t("Sin cálculo", "No estimate"), headline: exp.calc, detail: "" };
  else if (gap! > 0) fwd = { key: "RISK", tone: "risk", label: t("Resultado en riesgo", "Result at Risk"), headline: t(`SOLU espera ${i.day(exp.date)}; prometimos ${i.day(promise)}: ${gap} ${gap === 1 ? "día" : "días"} tarde.`, `SOLU expects ${i.day(exp.date)}; we promised ${i.day(promise)}: ${gap} ${gap === 1 ? "day" : "days"} late.`), detail: exp.calc };
  else {
    const margin = -gap!;
    fwd = {
      key: "PROTECTED", tone: "ok", label: t("Protegido · sin acción", "Protected · no action"),
      headline: withinChanges.length
        ? t(`La ETA cambió ${withinChanges.length} ${withinChanges.length === 1 ? "vez" : "veces"} y sigue dentro de la promesa: margen ${margin} ${margin === 1 ? "día" : "días"}.`, `The ETA changed ${withinChanges.length} time(s) and still fits the promise: ${margin} day(s) of margin.`)
        : t(`Tránsito normal: margen ${margin} ${margin === 1 ? "día" : "días"} sobre la promesa.`, `Normal transit: ${margin} day(s) of margin on the promise.`),
      detail: t("No hay nada que hacer hoy. SOLU avisa solo si la fecha esperada cruza la promesa.", "Nothing to do today. SOLU only alerts if the expected date crosses the promise."),
    };
  }

  // ---------- Options (only when the result is at risk, held or disputed) ----------
  const opts: Opt[] = [];
  const contact = deal.contact ? `${deal.contact.firstName}` : deal.account.name;
  const carrierDate = s.deliveredAt ?? s.carrierEta ?? s.plannedDelivery;
  if (fwd.key === "RISK") {
    if (!s.deliveredAt && s.customs !== "HOLD") {
      const fast = addDays(now, EXPEDITE_DAYS[s.mode] ?? 2);
      if (!carrierDate || fast < carrierDate) {
        const ne = addDays(fast, buffer);
        opts.push({ key: "EXPEDITE", title: s.mode === "OCEAN" ? t("Pasar a aéreo", "Switch to air") : t(`Acelerar con ${s.carrierName}`, `Expedite with ${s.carrierName}`), what: s.mode === "OCEAN" ? t("Sacar la carga del barco y enviarla por aéreo.", "Pull the cargo and send it by air.") : t("Pedir servicio expreso o el siguiente vuelo directo.", "Ask for express service or the next direct flight."), newExpected: ne, fits: !!promise && ne <= promise, assumption: t(`Supuesto SOLU: ~${EXPEDITE_DAYS[s.mode] ?? 2} días desde hoy. Confirmar disponibilidad y costo con ${s.carrierName}; el costo extra baja la eságara.`, `SOLU assumption: ~${EXPEDITE_DAYS[s.mode] ?? 2} days from today. Confirm availability and cost with ${s.carrierName}; the extra cost lowers the eságara.`) });
      }
      if (s.lines.length > 1) {
        const ne = addDays(addDays(now, EXPEDITE_DAYS.COURIER), buffer);
        opts.push({ key: "SPLIT", title: t("Dividir el envío", "Split the shipment"), what: t("Lo que bloquea la promesa sale por courier expreso; el resto sigue su ruta.", "What blocks the promise goes by express courier; the rest continues."), newExpected: ne, fits: !!promise && ne <= promise, partial: true, assumption: t("Entrega parcial: confirma con el cliente qué parte le permite operar.", "Partial delivery: confirm with the customer which part lets them operate.") });
      }
    }
    if (!s.toCustomer && s.international && exp.date) {
      const ne = addDays(exp.date, -1);
      opts.push({ key: "DIRECT", title: t("Despacho directo a planta", "Direct ship to site"), what: t("El agente de aduana entrega directo al cliente, sin pasar por nuestra bodega.", "The customs broker delivers straight to the customer, skipping our warehouse."), newExpected: ne, fits: !!promise && ne <= promise, assumption: t("Ahorra ~1 día de recibo en bodega; requiere que el cliente reciba sin nuestra inspección.", "Saves ~1 day of warehouse receiving; customer receives without our inspection.") });
    }
    const alt = deal.quotes[0]?.supplyAlt;
    if (alt) opts.push({ key: "ALTERNATE", title: t("Fuente alterna", "Alternate source"), what: alt, newExpected: null, fits: null, assumption: t("Requiere confirmar stock, precio y plazo; cambia la eságara protegida.", "Needs stock, price and lead time confirmed; changes the protected eságara.") });
  }
  if (fwd.key === "HOLD" || (fwd.key === "RISK" && s.customs === "HOLD")) {
    opts.push({ key: "DOCS", title: missingDocs.length ? t("Completar documentos hoy", "Complete documents today") : t("Responder a la aduana hoy", "Answer customs today"), what: missingDocs.length ? t(`Enviar al agente: ${missingDocs.map((d) => d.label).join(", ")}.`, `Send the broker: ${missingDocs.map((d) => d.label).join(", ")}.`) : (s.customsNote ?? ""), newExpected: exp.date, fits: !!promise && !!exp.date && exp.date <= promise, assumption: t(`Liberación ≈ ${HOLD_RELEASE_DAYS} días después de completar (supuesto SOLU).`, `Release ≈ ${HOLD_RELEASE_DAYS} days after completion (SOLU assumption).`) });
    opts.push({ key: "BROKER", title: t("Pedir liberación prioritaria al agente", "Ask the broker for priority release"), what: t("Explicar el impacto en la planta del cliente y pedir revisión prioritaria.", "Explain the impact on the customer's plant and ask for priority review."), newExpected: null, fits: null, assumption: t("Depende de la aduana; no cambia la fecha hasta que confirmen.", "Depends on customs; no date change until confirmed.") });
  }
  if (fwd.key === "DISPUTED") {
    opts.push({ key: "POD", title: t("Pedir la prueba de entrega (POD)", "Request proof of delivery (POD)"), what: t(`Pedir a ${s.carrierName} la firma, foto y hora de entrega${s.tracking ? ` de la guía ${s.tracking}` : ""}.`, `Ask ${s.carrierName} for signature, photo and delivery time${s.tracking ? ` for tracking ${s.tracking}` : ""}.`), newExpected: null, fits: null, assumption: t("Con la POD se sabe si fue error de recepción o de entrega.", "The POD shows whether it was a receiving or delivery error.") });
    opts.push({ key: "CLAIM", title: t(`Abrir reclamo con ${s.carrierName}`, `Open a claim with ${s.carrierName}`), what: t("Si la POD no coincide con lo recibido: reclamo por faltante o pérdida.", "If the POD doesn't match what was received: claim for shortage or loss."), newExpected: null, fits: null, assumption: t("Los plazos de reclamo suelen ser cortos; abrirlo no compromete nada.", "Claim windows are usually short; opening one commits to nothing.") });
  }
  if (fwd.key === "RISK" || fwd.key === "DISPUTED") {
    const d = exp.date;
    opts.push({
      key: "COMMUNICATE", title: t(`Avisar a ${contact} con una fecha honesta`, `Tell ${contact} with an honest date`),
      what: t("Antes de que lo descubra: qué pasó, nueva fecha y qué estamos haciendo.", "Before they find out: what happened, the new date and what we're doing."),
      newExpected: d, fits: false,
      assumption: t("No cambia la fecha; protege la confianza y le da tiempo de planear.", "Doesn't change the date; protects trust and gives them time to plan."),
      draft: fwd.key === "DISPUTED"
        ? t(`Hola ${contact}, ${s.carrierName} reporta la entrega el ${i.day(s.deliveredAt)}. Ya pedimos la prueba de entrega para aclarar qué llegó y te confirmo hoy mismo los siguientes pasos.`, `Hi ${contact}, ${s.carrierName} reports delivery on ${i.day(s.deliveredAt)}. We've requested proof of delivery to clarify what arrived and I'll confirm next steps today.`)
        : t(`Hola ${contact}, el envío de ${contents} viene con un cambio del transportista. Hoy esperamos entregarlo el ${i.day(d)}, ${gap ?? 0} día(s) después de lo acordado (${i.day(promise)}). Estamos evaluando acelerarlo y te confirmo mañana.`, `Hi ${contact}, the shipment of ${contents} has a carrier change. We now expect to deliver on ${i.day(d)}, ${gap ?? 0} day(s) after what we agreed (${i.day(promise)}). We're looking at expediting and I'll confirm tomorrow.`),
    });
  }

  // ---------- Forward timeline (planned vs actual) ----------
  const plannedReceipt = s.plannedDelivery ? addDays(s.plannedDelivery, (s.international ? CLEARANCE_DAYS : 0) + lastMile) : null;
  const ms = [
    { key: "rts", label: t("Listo para despacho", "Ready to ship"), planned: s.plannedRts, actual: s.rtsAt, current: null as Date | null },
    { key: "pickup", label: t("Recogida", "Pickup"), planned: s.plannedPickup, actual: s.pickedUpAt, current: null as Date | null },
    { key: "carrier", label: s.toCustomer ? t("Entrega del transportista", "Carrier delivery") : t("Llegada del transportista", "Carrier arrival"), planned: s.plannedDelivery, actual: s.deliveredAt, current: s.deliveredAt ? null : s.carrierEta },
    { key: "receipt", label: t("Recibo del cliente", "Customer receipt"), planned: plannedReceipt, actual: s.receipt === "CONFIRMED" ? s.receivedAt : null, current: s.receipt === "CONFIRMED" ? null : exp.date },
  ].map((m) => {
    const shown = m.actual ?? m.current;
    return { ...m, shown, delta: m.planned && shown ? daysBetween(m.planned, shown) : null, done: !!m.actual };
  });
  const deviation = ms.some((m) => m.delta != null && m.delta !== 0);
  const allDates = [...ms.flatMap((m) => [m.planned, m.shown]), promise, now].filter((d): d is Date => !!d);
  const lo = addDays(allDates.reduce((a, b) => (b < a ? b : a)), -1);
  const hi = addDays(allDates.reduce((a, b) => (b > a ? b : a)), 1);
  const span = Math.max(1, daysBetween(lo, hi));
  const pos = (d: Date | null) => (d ? Math.max(0, Math.min(100, (daysBetween(lo, d) / span) * 100)) : null);

  // ---------- Map: only when there is movement and a route to understand ----------
  const pts = s.events.filter((e) => e.lat != null && e.lng != null).map((e) => ({ lat: e.lat!, lng: e.lng!, label: e.location ?? "", at: e.at, material: e.material || e.kind !== "SCAN" }));
  const moving = !!s.pickedUpAt && !s.deliveredAt && s.receipt === "PENDING" && s.customs !== "HOLD";
  const showMap = moving && pts.length >= 1 && s.destLat != null && s.destLng != null;

  return {
    exp, gap, promise, fwd, nowState, opts, docs, missingDocs, contents,
    scans, lastScan, etaChanges, withinChanges, material,
    ms, deviation, pos, lo, hi, nowPos: pos(now), promisePos: pos(promise),
    pts, showMap, buffer,
  };
}

/** Compact forward state for lists, the Journey and alerts. */
export function forwardOf(s: ShipCore & { promisedDate: Date | null; customsNote?: string | null }, i: I): FwdKey {
  if (s.receipt === "CONFIRMED") return "RECEIVED";
  if (s.receipt === "DISPUTED") return "DISPUTED";
  const e = expectedOf(s, i);
  if (s.customs === "HOLD") return e.date && s.promisedDate && e.date <= s.promisedDate ? "HOLD" : "RISK";
  if (!s.promisedDate || !e.date) return "UNKNOWN";
  return daysBetween(s.promisedDate, e.date) > 0 ? "RISK" : "PROTECTED";
}

export function fwdLabel(i: I, k: FwdKey) {
  const { t } = i;
  return {
    RECEIVED: { cls: "ok", text: t("Recibido", "Received") },
    DISPUTED: { cls: "risk", text: t("Recibo en disputa", "Receipt disputed") },
    HOLD: { cls: "attn", text: t("Aduana · aún protegido", "Customs · still protected") },
    RISK: { cls: "risk", text: t("Resultado en riesgo", "Result at Risk") },
    PROTECTED: { cls: "ok", text: t("Protegido · sin acción", "Protected · no action") },
    UNKNOWN: { cls: "wait", text: t("Sin cálculo", "No estimate") },
  }[k];
}
