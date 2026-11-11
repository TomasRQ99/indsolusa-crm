import { db } from "@/lib/db";
import { today, dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { getOpsPolicy } from "@/lib/ops-home";
import { shipClass } from "@/lib/ops-rules";
import { CLEARANCE_DAYS, LAST_MILE_DAYS, isDomestic } from "@/lib/purchasing";
import { EXTRA_CHARGES, WEIGHT_SOURCES, choiceNeedsReason, logisticsReadiness, readQuotes, weightCheck, type Breakdown } from "@/lib/freight-rules";
import { chargeableKg, parseDims, volumetricKg } from "@/lib/freight-audit";
import { adapters } from "@/lib/carriers/gateway";
import { addFreightQuote, chooseFreightQuote, saveFreight } from "@/app/(app)/compras/flete-actions";

// Operaciones O5a · freight for a Supplier PO: what is needed before booking (derived readiness), the stated weight
// against what was measured before, and the options read against the customer promise (cost to fulfil).

export async function SpoFreight({ spoId, lang, editable }: { spoId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const spo = await db.supplierPO.findUnique({ where: { id: spoId }, select: { id: true, dealId: true, supplierId: true, shipBy: true, incoterm: true, currency: true, amount: true, lines: { select: { code: true } }, supplier: { select: { country: true } }, deal: { select: { promisedDate: true, account: { select: { address: true } } } }, freight: { include: { quotes: { orderBy: { cost: "asc" } } } } } });
  if (!spo) return null;
  const T = today();
  const codes = spo.lines.map((l) => l.code).filter((c): c is string => !!c);
  const [opt, obs, pol] = await Promise.all([
    db.supplyOption.findFirst({ where: { dealId: spo.dealId, supplierId: spo.supplierId }, orderBy: { createdAt: "desc" }, select: { pickup: true, origin: true, grossKg: true, dims: true, packages: true, incoterm: true } }),
    codes.length ? db.logisticsObservation.findMany({ where: { part: { mpn: { in: codes } }, grossKg: { not: null }, status: { not: "ESTIMATED" } }, select: { grossKg: true, status: true, observedAt: true } }) : [],
    getOpsPolicy(),
  ]);
  const f = spo.freight;
  const international = !isDomestic(spo.supplier);
  const v = { // saved values, or what SOLU already knows (never re-typed)
    origin: f?.origin ?? opt?.origin ?? spo.supplier.country ?? "", pickupAddress: f?.pickupAddress ?? opt?.pickup ?? "", pickupContact: f?.pickupContact ?? "", pickupHours: f?.pickupHours ?? "", destination: f?.destination ?? spo.deal.account.address ?? "",
    readyDate: f?.readyDate ?? spo.shipBy ?? null, packages: f?.packages ?? opt?.packages ?? null, netKg: f?.netKg != null ? Number(f.netKg) : null, grossKg: f?.grossKg != null ? Number(f.grossKg) : opt?.grossKg != null ? Number(opt.grossKg) : null,
    dims: f?.dims ?? opt?.dims ?? "", packagingType: f?.packagingType ?? "", incoterm: f?.incoterm ?? spo.incoterm ?? opt?.incoterm ?? "",
  };
  const missing = f ? logisticsReadiness({ ...f, grossKg: f.grossKg != null ? Number(f.grossKg) : null }, international) : null;
  const wc = weightCheck(f?.grossKg != null ? Number(f.grossKg) : null, obs.map((o) => Number(o.grossKg)));
  const after = international ? CLEARANCE_DAYS + LAST_MILE_DAYS : LAST_MILE_DAYS;
  const reads = f ? readQuotes(f.quotes.map((q) => ({ id: q.id, cost: Number(q.cost), currency: q.currency, transitDays: q.transitDays, pickupDate: q.pickupDate })), { readyDate: f.readyDate, promise: spo.deal.promisedDate, today: T, afterArrivalDays: after, policy: pol.value }) : [];
  // Courier or cargo: physical (gross) weight and the value of the goods alone, which is what this purchase order holds.
  const sc = international ? shipClass(v.grossKg, spo.currency === "USD" ? Number(spo.amount) : null, pol.value) : null;
  const scWord = { COURIER: t("Cuenta courier", "Courier account"), CARGO: t("Cuenta de carga: importación formal y nacionalización", "Cargo account: formal import and nationalisation"), BETWEEN: t("Courier o carga: por confirmar", "Courier or cargo: to confirm"), UNKNOWN: t("Courier o carga: faltan datos", "Courier or cargo: data missing") };
  const scTone = { COURIER: "ok", CARGO: "attn", BETWEEN: "wait", UNKNOWN: "wait" } as const;
  const tone = { PROTECTED: "ok", NARROW: "attn", AT_RISK: "risk", BREACHED: "risk", UNKNOWN: "wait" } as const;
  const word = { PROTECTED: t("Protege la promesa", "Protects the promise"), NARROW: t("Promesa justa", "Narrow"), AT_RISK: t("Promesa en riesgo", "Promise at risk"), BREACHED: t("Promesa incumplida", "Promise breached"), UNKNOWN: t("No se puede leer", "Can't be read") };
  const yn = (name: string, val: boolean | null | undefined) => <select name={name} defaultValue={val == null ? "" : val ? "yes" : "no"}><option value="">{t("No se sabe", "Unknown")}</option><option value="yes">{t("Sí", "Yes")}</option><option value="no">No</option></select>;
  const integrations = adapters().filter((a) => a.key !== "MANUAL");
  // Billable weight the carrier should use: the larger of physical and volumetric, by the general weight rule.
  const wr = await db.carrierRatingRule.findFirst({ where: { carrier: "DEFAULT" } });
  const rule = { carrier: "DEFAULT", divisor: wr?.divisor ?? 5000, roundingKg: wr ? Number(wr.roundingKg) : 0.5, minChargeKg: wr?.minChargeKg != null ? Number(wr.minChargeKg) : null, tolerancePct: 0, toleranceUsd: 0, claimPct: 0, confirmed: wr?.confirmed ?? false, version: wr?.version ?? 0 };
  const volKg = volumetricKg(parseDims(v.dims), v.packages, rule);
  const billKg = chargeableKg(v.grossKg, volKg, rule);

  return (
    <section className="jblock" id="flete">
      <div className="jbh"><b>{t("FLETE", "FREIGHT")}</b><span className="grow" />{missing == null ? <span className="sig wait">{t("Sin preparar", "Not prepared")}</span> : missing.length === 0 ? <span className="sig ok">{t("Listo para reservar transporte", "Ready to book transport")}</span> : <span className="sig attn">{t(`Faltan ${missing.length} datos`, `${missing.length} items missing`)}</span>}</div>
      {missing && missing.length > 0 && <ul className="mk-ul small">{missing.map((m) => <li key={m.key}><b>{t(m.what.es, m.what.en)}</b> · <span className="muted">{t(m.why.es, m.why.en)}</span></li>)}</ul>}
      {sc && <p className="small"><span className={`sig ${scTone[sc.cls]}`}>{scWord[sc.cls]}</span> {sc.reasons.map((r) => t(r.es, r.en)).join(" · ")}<span className="src block">{t("Regla de DHL a través de Importsoluciones: cuenta el peso físico (no el volumétrico) y el valor del bien sin fletes ni servicios. Los valores se cambian en Operaciones → Configuración.", "DHL rule through Importsoluciones: physical weight counts (not volumetric) and the value of the goods without freight or services. The values are changed in Operations → Settings.")}</span></p>}
      {wc.ask && !f?.reconfirmedAt && <p className="note attn">{t(`El peso indicado (${Number(f!.grossKg)} kg) no coincide con lo medido antes para esta referencia (${wc.min}–${wc.max} kg). No se sobrescribe ninguno: pide al proveedor que lo reconfirme y anótalo abajo.`, `The stated weight (${Number(f!.grossKg)} kg) doesn't match what was measured before for this part (${wc.min}–${wc.max} kg). Neither is overwritten: ask the supplier to reconfirm and note it below.`)}</p>}
      {f?.reconfirmedAt && <p className="src">{t(`Peso reconfirmado el ${i.day(f.reconfirmedAt)}: ${f.reconfirmNote}`, `Weight reconfirmed on ${i.day(f.reconfirmedAt)}: ${f.reconfirmNote}`)}</p>}

      {editable && (
        <details className="qa" open={!f} style={{ marginTop: 6 }}><summary className="qa-btn">{f ? t("Datos para el transporte", "Transport data") : t("Preparar el flete (viene con lo que SOLU ya sabe)", "Prepare the freight (prefilled with what SOLU already knows)")}</summary>
          <form action={saveFreight.bind(null, spo.id)} className="qa-form" style={{ marginTop: 8 }}>
            <div className="qa-row">
              <label>{t("Dirección de recogida", "Pickup address")}<input name="pickupAddress" maxLength={300} defaultValue={v.pickupAddress} /></label>
              <label style={{ flex: "0 0 150px" }}>{t("País de origen", "Country of origin")}<input name="origin" maxLength={80} defaultValue={v.origin} /></label>
            </div>
            <div className="qa-row">
              <label>{t("Contacto en origen", "Contact at origin")}<input name="pickupContact" maxLength={160} defaultValue={v.pickupContact} /></label>
              <label>{t("Horario de recogida", "Opening hours")}<input name="pickupHours" maxLength={120} defaultValue={v.pickupHours} /></label>
              <label style={{ flex: "0 0 auto" }}>{t("Fecha de listo", "Ready date")}<input name="readyDate" type="date" defaultValue={dayInput(v.readyDate)} /></label>
            </div>
            <label>{t("Destino", "Destination")}<input name="destination" maxLength={300} defaultValue={v.destination} /></label>
            <div className="qa-row">
              <label style={{ flex: "0 0 90px" }}>{t("Bultos", "Packages")}<input name="packages" type="number" min={0} defaultValue={v.packages ?? ""} /></label>
              <label style={{ flex: "0 0 120px" }}>{t("Peso neto kg", "Net kg")}<input name="netKg" type="number" min={0} step="0.01" defaultValue={v.netKg ?? ""} /></label>
              <label style={{ flex: "0 0 120px" }}>{t("Peso bruto kg", "Gross kg")}<input name="grossKg" type="number" min={0} step="0.01" defaultValue={v.grossKg ?? ""} /></label>
              <label>{t("Medidas por bulto (cm)", "Dimensions per package (cm)")}<input name="dims" maxLength={160} defaultValue={v.dims} placeholder="60x40x30" /></label>
            </div>
            <div className="qa-row">
              <label>{t("Quién dio peso y medidas", "Who gave weight and measures")}<select name="weightSource" defaultValue={f?.weightSource ?? "SUPPLIER_STATED"}>{Object.entries(WEIGHT_SOURCES).map(([k, w]) => <option key={k} value={k}>{t(w.es, w.en)}</option>)}</select></label>
              <label>{t("Reconfirmación del peso (si se pidió)", "Weight reconfirmation (if asked)")}<input name="reconfirmNote" maxLength={200} placeholder={t("Ej.: el proveedor corrige a 70 kg, correo de hoy", "E.g.: supplier corrects to 70 kg, today's email")} /></label>
            </div>
            <div className="qa-row">
              <label>{t("Tipo de empaque", "Packaging type")}<input name="packagingType" maxLength={80} defaultValue={v.packagingType} placeholder={t("Caja, guacal, estiba…", "Box, crate, pallet…")} /></label>
              <label style={{ flex: "0 0 130px" }}>Incoterm<input name="incoterm" maxLength={40} defaultValue={v.incoterm} /></label>
              <label style={{ flex: "0 0 130px" }}>{t("¿Peligrosa?", "Hazardous?")}{yn("hazardous", f?.hazardous)}</label>
              <label style={{ flex: "0 0 130px" }}>{t("¿Frágil?", "Fragile?")}{yn("fragile", f?.fragile)}</label>
              <label style={{ flex: "0 0 130px" }}>{t("¿Apilable?", "Stackable?")}{yn("stackable", f?.stackable)}</label>
            </div>
            <div className="qa-row" style={{ flexWrap: "wrap" }}>
              <label className="chk"><input type="checkbox" name="hasInvoice" value="1" defaultChecked={f?.hasInvoice} /> {t("Hay factura comercial", "Commercial invoice on hand")}</label>
              <label className="chk"><input type="checkbox" name="hasPackingList" value="1" defaultChecked={f?.hasPackingList} /> {t("Hay lista de empaque", "Packing list on hand")}</label>
              <label className="chk"><input type="checkbox" name="urgent" value="1" defaultChecked={f?.urgent} /> {t("Urgente", "Urgent")}</label>
            </div>
            <div className="qa-row">
              <label>{t("Seguro", "Insurance")}<input name="insurance" maxLength={120} defaultValue={f?.insurance ?? ""} /></label>
              <label>{t("Manejo especial / temperatura", "Special handling / temperature")}<input name="handling" maxLength={200} defaultValue={f?.handling ?? ""} /></label>
            </div>
            <button type="submit" className="secondary">{t("Guardar datos del flete", "Save freight data")}</button>
          </form>
        </details>
      )}

      {f && (
        <>
          <div className="jbh" style={{ marginTop: 12 }}><b className="small">{t("OPCIONES DE TRANSPORTE", "TRANSPORT OPTIONS")}</b><span className="grow" /><span className="src">{t("No gana el más barato: gana el que cumple al menor costo", "Not the cheapest: the one that fulfils at the lowest cost")}</span></div>
          {f.quotes.length === 0 ? <p className="small muted">{t("Aún no hay opciones. Agrega al menos dos para comparar.", "No options yet. Add at least two to compare.")}</p> : (
            <div className="tscroll"><table>
              <thead><tr><th>{t("Transportador", "Carrier")}</th><th className="n">{t("Costo", "Cost")}</th><th>{t("Tránsito", "Transit")}</th><th>{t("Llegaría al cliente", "Would reach the customer")}</th><th>{t("Frente a la promesa", "Against the promise")}</th><th /></tr></thead>
              <tbody>{f.quotes.map((q) => { const r = reads.find((x) => x.id === q.id)!; return (
                <tr key={q.id}>
                  <td><b>{q.carrier}</b>{q.service ? ` · ${q.service}` : ""}{q.chosen && <span className="sig ok" style={{ marginLeft: 6 }}>{t("Elegida", "Chosen")}</span>}{(() => { const b = q.breakdown as unknown as Breakdown | null; return b ? <span className="src block mono">{t("tarifa", "tariff")} {i.n2(b.tariff)}{b.discount > 0 ? ` − ${t("descuento", "discount")} ${i.n2(b.discountPct)} % (${i.n2(b.discount)})` : ""}{b.pieceSurcharge > 0 ? ` + ${t("sobrepeso", "piece surcharge")} ${i.n2(b.pieceSurcharge)}` : ""}{b.fuel > 0 ? ` + ${t("combustible", "fuel")} ${i.n2(b.fuel)}` : ""}{b.insurance > 0 ? ` + ${t("seguro", "insurance")} ${i.n2(b.insurance)}` : ""}{b.extras.map((x) => ` + ${t(EXTRA_CHARGES[x.key]?.es ?? x.name, EXTRA_CHARGES[x.key]?.en ?? x.name).toLowerCase()} ${i.n2(x.amount)}`).join("")}</span> : null; })()}<span className="src block">{q.source}{q.validUntil ? ` · ${t("vigente hasta", "valid until")} ${i.day(q.validUntil)}` : ""}{q.reliability ? ` · ${q.reliability}` : ""}</span>{q.chosen && q.chosenReason && <span className="src block">«{q.chosenReason}» · {q.chosenByName}</span>}</td>
                  <td className="n mono">{q.currency} {i.n2(q.cost)}{r.cheapest ? <span className="block small">{t("la más barata", "cheapest")}</span> : r.extraVsCheapest > 0 ? <span className="block small">+{i.n2(r.extraVsCheapest)}</span> : null}</td>
                  <td className="small">{q.transitDays != null ? t(`${q.transitDays} días`, `${q.transitDays} days`) : "—"}{q.pickupDate ? <span className="block">{t("recoge", "pickup")} {i.day(q.pickupDate)}</span> : null}</td>
                  <td className="mono small">{r.arrives ? i.day(r.arrives) : "—"}</td>
                  <td><span className={`sig ${tone[r.health]}`}>{word[r.health]}</span><span className="src block">{t(r.reason.es, r.reason.en)}</span></td>
                  <td>{editable && !q.chosen && <form action={chooseFreightQuote.bind(null, q.id)} className="qa-row"><input name="reason" maxLength={300} placeholder={choiceNeedsReason(r) ? t("Por qué esta (obligatorio)", "Why this one (required)") : t("Por qué (opcional)", "Why (optional)")} aria-label={t("Motivo", "Reason")} style={{ minWidth: 140 }} /><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Elegir", "Choose")}</button></form>}</td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
          <p className="src">{t(`La llegada suma tránsito más ${after} día(s) de ${international ? "aduana y entrega local" : "entrega local"}. La fecha del transportador informa; la promesa al cliente no cambia sola.`, `Arrival adds transit plus ${after} day(s) of ${international ? "customs and local delivery" : "local delivery"}. The carrier's date informs; the customer promise doesn't change by itself.`)} {integrations.length === 0 ? t("Todas las opciones se escriben a mano por ahora; la conexión con DHL llega en la siguiente etapa.", "All options are typed in by hand for now; the DHL connection arrives in the next stage.") : ""}</p>
          {editable && (
            <details className="qa"><summary className="qa-btn">{t("+ Agregar opción de transporte", "+ Add transport option")}</summary>
              <form action={addFreightQuote.bind(null, spo.id)} className="qa-form" style={{ marginTop: 8 }}>
                <div className="qa-row">
                  <label>{t("Transportador o agente", "Carrier or forwarder")}<input name="carrier" required maxLength={120} /></label>
                  <label>{t("Servicio", "Service")}<input name="service" maxLength={120} placeholder="Express, consolidado…" /></label>
                </div>
                <div className="qa-row">
                  <label style={{ flex: "0 0 160px" }}>{t("Costo total (si no hay desglose)", "Total cost (if no breakdown)")}<input name="cost" type="number" min={0} step="0.01" /></label>
                  <label style={{ flex: "0 0 90px" }}>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue="USD" /></label>
                  <label style={{ flex: "0 0 120px" }}>{t("Días de tránsito", "Transit days")}<input name="transitDays" type="number" min={0} /></label>
                  <label style={{ flex: "0 0 auto" }}>{t("Puede recoger el", "Can pick up on")}<input name="pickupDate" type="date" defaultValue={dayInput(f.readyDate)} /></label>
                  <label style={{ flex: "0 0 auto" }}>{t("Vigente hasta", "Valid until")}<input name="validUntil" type="date" /></label>
                </div>
                <div className="qa-row">
                  <label>{t("De dónde sale la tarifa", "Where the rate comes from")}<input name="source" required maxLength={200} placeholder={t("Cotización, correo, tarifa de contrato…", "Quote, email, contract rate…")} /></label>
                  <label>{t("Qué tan confiable ha sido (hechos)", "How reliable it has been (facts)")}<input name="reliability" maxLength={200} /></label>
                </div>
                <span className="k">{t("Desglose del flete (opcional): SOLU hace la suma", "Freight breakdown (optional): SOLU does the sum")}</span>
                {billKg != null && <span className="small">{t("Peso a facturar esperado", "Expected billable weight")}: <b className="mono">{i.n2(billKg)} kg</b> <span className="muted">({t("físico", "physical")} {v.grossKg != null ? i.n2(v.grossKg) : "—"} kg · {t("volumétrico", "volumetric")} {volKg != null ? i.n2(volKg) : "—"} kg{rule.confirmed ? "" : t(" · regla de peso por confirmar", " · weight rule to confirm")})</span></span>}
                <div className="qa-row">
                  <label>{t("Tarifa del flete", "Freight tariff")}<input name="b_tariff" inputMode="decimal" /></label>
                  <label style={{ flex: "0 0 130px" }}>{t("% descuento", "Discount %")}<input name="b_discountPct" inputMode="decimal" /></label>
                  <label>{t("Pieza con sobrepeso", "Piece surcharge")}<input name="b_piece" inputMode="decimal" /></label>
                  <label>{t("Recargo de combustible", "Fuel surcharge")}<input name="b_fuel" inputMode="decimal" /></label>
                  <label>{t("Seguro", "Insurance")}<input name="b_insurance" inputMode="decimal" /></label>
                </div>
                <div className="qa-row">{Object.entries(EXTRA_CHARGES).map(([k, x]) => <label key={k}>{t(x.es, x.en)}<input name={`b_x_${k}`} inputMode="decimal" /></label>)}</div>
                <button type="submit">{t("Agregar opción", "Add option")}</button>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}
