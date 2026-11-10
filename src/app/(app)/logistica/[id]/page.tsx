import Link from "next/link";
import { ShipmentDates } from "@/components/ShipmentDates";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditMoney, canEditOps } from "@/lib/permissions";
import { ShipmentAudit } from "@/components/ShipmentAudit";
import { ShipmentCustoms } from "@/components/ShipmentCustoms";
import { makeI18n } from "@/lib/i18n";
import { dayInput } from "@/lib/domain";
import { buildShipment, shipInclude } from "@/lib/logistics";
import { Popovers } from "@/components/Popovers";
import { addCheckpoint, chooseOption, confirmReceipt, disputeReceipt, markDelivered, setCustoms, toggleDoc, updateEta } from "../actions";

type Pt = { lat: number; lng: number; label: string; at: Date; material: boolean };

/** Schematic route: carrier-reported points projected onto a small frame. Secondary to the interpretation. */
function RouteMap({ pts, dest, destLabel, title }: { pts: Pt[]; dest: { lat: number; lng: number }; destLabel: string; title: string }) {
  const W = 640, H = 240, P = 36;
  const all = [...pts, { ...dest, label: destLabel, at: new Date(), material: false }];
  const k = Math.cos(((all.reduce((a, p) => a + p.lat, 0) / all.length) * Math.PI) / 180);
  const xs = all.map((p) => p.lng * k), ys = all.map((p) => -p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sc = Math.min((W - 2 * P) / Math.max(0.01, x1 - x0), (H - 2 * P) / Math.max(0.01, y1 - y0));
  const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
  const pr = (p: { lat: number; lng: number }) => [ox + (p.lng * k - x0) * sc, oy + (-p.lat - y0) * sc] as const;
  const P0 = pts.map(pr);
  const D = pr(dest);
  const cur = P0[P0.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fmap" role="img" aria-label={title}>
      <rect x="0" y="0" width={W} height={H} rx="8" className="fmap-bg" />
      {P0.length > 1 && <polyline points={P0.map(([x, y]) => `${x},${y}`).join(" ")} className="fmap-done" />}
      <line x1={cur[0]} y1={cur[1]} x2={D[0]} y2={D[1]} className="fmap-next" />
      {P0.map(([x, y], n) => (
        <g key={n}>
          <circle cx={x} cy={y} r={pts[n].material ? 6 : 4} className={pts[n].material ? "fmap-ex" : "fmap-pt"}><title>{pts[n].label}</title></circle>
          {(n === 0 || pts[n].material) && n !== P0.length - 1 && pts[n].label !== pts[pts.length - 1].label && <text x={x} y={y - 10} className="fmap-lb" textAnchor="middle">{pts[n].label}</text>}
        </g>
      ))}
      <circle cx={cur[0]} cy={cur[1]} r="11" className="fmap-ring" />
      <circle cx={cur[0]} cy={cur[1]} r="6" className="fmap-cur" />
      <text x={cur[0]} y={cur[1] + 24} className="fmap-lb strong" textAnchor="middle">{pts[pts.length - 1].label}</text>
      <rect x={D[0] - 6} y={D[1] - 6} width="12" height="12" rx="2" className="fmap-dest" />
      <text x={D[0]} y={D[1] - 12} className="fmap-lb strong" textAnchor="middle">{destLabel}</text>
    </svg>
  );
}

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const s = await db.shipment.findUnique({ where: { id }, include: shipInclude });
  if (!s) notFound();
  const B = buildShipment(s, i);
  const d = s.deal;
  const editable = canEditOps(user, d.ownerId);
  const dm = (x: Date | null | undefined) => (x ? i.dateShort(x) : "—");
  const open = s.receipt !== "CONFIRMED";

  const okMsg: Record<string, string> = {
    registrado: t("Envío registrado. SOLU calcula aparte cuándo lo tiene el cliente.", "Shipment recorded. SOLU separately calculates when the customer has it."),
    "eta-protegido": t("ETA actualizada. Sigue dentro de la promesa: no hay acción.", "ETA updated. Still within the promise: no action."),
    "eta-riesgo": t("ETA actualizada. Cruza la promesa: revisa las opciones.", "ETA updated. It crosses the promise: review the options."),
    lectura: t("Lectura registrada. Es normal: queda resumida, sin alertas.", "Checkpoint recorded. It's normal: summarised, no alerts."),
    excepcion: t("Excepción registrada e interpretada.", "Exception recorded and interpreted."),
    retenido: t("Retención en aduana registrada.", "Customs hold recorded."),
    liberado: t("Liberado por la aduana.", "Released by customs."),
    docs: t("Documentos actualizados.", "Documents updated."),
    entregado: t("Entrega del transportista registrada. Falta que el cliente confirme.", "Carrier delivery recorded. Customer confirmation pending."),
    recibido: t("Recibo confirmado. Se creó la remisión para facturar.", "Receipt confirmed. The delivery note was created for invoicing."),
    disputa: t("Discrepancia registrada. No se factura hasta resolverla.", "Discrepancy recorded. No invoicing until it's resolved."),
    opcion: t("Opción elegida. Quedó como siguiente movimiento del Journey.", "Option chosen. It's now the Journey's next movement."),
    fac: t("Factura registrada y comparada.", "Invoice recorded and compared."),
    reclamo: t("Reclamo actualizado.", "Claim updated."),
    aduana: t("Caso de aduana guardado.", "Customs case saved."),
  };
  const errMsg: Record<string, string> = {
    fecha: t("Elige la fecha que da el transportista.", "Pick the date the carrier gives."),
    texto: t("Escribe qué reportó el transportista.", "Write what the carrier reported."),
    nota: t("Escribe qué pasó.", "Write what happened."),
    quien: t("Escribe quién recibió.", "Write who received it."),
    opcion: t("Esa opción ya no aplica.", "That option no longer applies."),
    "fac-datos": t("Faltan datos de la factura: transportador, número, total y de dónde sale el dato.", "Invoice data missing: carrier, number, total and where the figure comes from."),
    "fac-repetida": t("Esa factura de ese transportador ya está registrada.", "That invoice from that carrier is already recorded."),
    "reclamo-datos": t("Indica el valor en disputa (no mayor que la factura), el cálculo esperado y la evidencia.", "Give the disputed amount (not above the invoice), the expected calculation and the evidence."),
    "reclamo-credito": t("Para marcarlo recuperado se necesita el número de la nota crédito y el valor realmente recibido (no mayor que lo reclamado).", "To mark it recovered, the credit note number and the amount really received are needed (not above what was claimed)."),
    "reclamo-respuesta": t("Escribe qué respondió el transportador.", "Write what the carrier answered."),
    permiso: t("Registrar la respuesta de un reclamo corresponde al dueño del Journey, Finanzas, Administración o Gerencia.", "Recording a claim's answer is for the Journey owner, Finance, Administration or Management."),
    clasificacion: t("Para marcar la clasificación como validada hoy, escribe quién la validó.", "To mark the classification as validated today, write who validated it."),
  };
  const chosen = new Map(s.decisions.map((x) => [x.option, x]));
  const fitsSig = (fits: boolean | null, partial?: boolean) =>
    fits == null ? <span className="sig wait">{t("Fecha por confirmar", "Date to confirm")}</span>
    : partial ? <span className={`sig ${fits ? "attn" : "risk"}`}>{fits ? t("Parcial dentro de la promesa", "Partial within promise") : t("Parcial, aún tarde", "Partial, still late")}</span>
    : fits ? <span className="sig ok">{t("Cabe en la promesa", "Fits the promise")}</span> : <span className="sig risk">{t("No alcanza la promesa", "Misses the promise")}</span>;

  return (
    <div className="jw shp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/logistica">{t("Envíos", "Shipments")}</Link> · <Link href={`/deals/${d.id}?tab=execute`}>{d.code}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link>{s.supplierPo && <> · <Link href={`/compras/${s.supplierPo.id}`}>{s.supplierPo.code}</Link></>}</p>
          <span className="jid">{s.code}</span>
          <span className="grow" />
        </div>
        <div className="jh-title">
          <h1>{s.carrierName}{s.tracking ? <span className="mono"> · {s.tracking}</span> : null}</h1>
          <span className={`sig ${B.fwd.tone}`}>{B.fwd.label}</span>
        </div>
        <p className="jh-sub">{B.contents || "—"} · {s.origin ?? "—"} → {s.destination ?? "—"} · {({ AIR: t("Aéreo", "Air"), COURIER: "Courier", OCEAN: t("Marítimo", "Ocean"), GROUND: t("Terrestre", "Ground") })[s.mode]}{s.international ? ` · ${t("internacional", "international")}` : ""}</p>
      </header>

      {/* Five separate truths */}
      <section className="ftruths" aria-label={t("Cinco verdades", "Five truths")}>
        <div className="ft now"><span className="k">{t("AHORA", "NOW")}</span><b>{B.nowState.label}</b><span className="src">{[B.nowState.where, B.nowState.when ? i.day(B.nowState.when) : null, B.nowState.src].filter(Boolean).join(" · ")}</span></div>
        <div className={`ft fwd ${B.fwd.tone}`}><span className="k">{t("HACIA ADELANTE", "FORWARD")}</span><b>{B.fwd.label}</b><span className="src">{B.gap == null ? "—" : B.gap > 0 ? t(`${B.gap} días después de la promesa`, `${B.gap} days after the promise`) : t(`margen ${-B.gap} días`, `${-B.gap} days margin`)}</span></div>
        <div className="ft"><span className="k">{t("ETA TRANSPORTISTA", "CARRIER ETA")}</span><b className="mono">{dm(s.deliveredAt ?? s.carrierEta)}</b><span className="src">{s.deliveredAt ? t("entregado según el transportista", "delivered per carrier") : `${s.carrierEtaSource ?? s.carrierName}${s.carrierEtaAt ? ` · ${t("reportada", "reported")} ${i.day(s.carrierEtaAt)}` : ""}`}</span></div>
        <div className="ft solu"><span className="k">{t("SOLU ESPERA", "SOLU EXPECTED")}</span><b className="mono">{B.exp.date ? `${B.exp.done ? "" : "≈ "}${dm(B.exp.date)}` : "—"}</b><span className="src">{B.exp.conditional ? t("condicional · ", "conditional · ") : ""}{B.exp.calc}</span></div>
        <div className="ft prom"><span className="k">{t("PROMESA AL CLIENTE", "CUSTOMER PROMISE")}</span><b className="mono">{dm(d.promisedDate)}</b><span className="src">{d.promiseText ?? "—"} · {t("no cambia con la ETA", "doesn't change with the ETA")}</span></div>
      </section>

      {/* Interpretation first */}
      <section className={`fwd-banner ${B.fwd.tone}`}>
        <span className="k">{B.fwd.label}</span>
        <b>{B.fwd.headline}</b>
        {B.fwd.detail && <p>{B.fwd.detail}</p>}
        {B.fwd.key === "PROTECTED" && (
          <p className="src">{t(`${B.scans.length} lecturas normales del transportista${B.withinChanges.length ? ` · ${B.withinChanges.length} ajuste(s) de ETA dentro del margen` : ""} · 0 acciones sugeridas.`, `${B.scans.length} normal carrier checkpoints${B.withinChanges.length ? ` · ${B.withinChanges.length} ETA adjustment(s) within margin` : ""} · 0 suggested actions.`)}</p>
        )}
      </section>

      {B.opts.length > 0 && (
        <section className="jblock">
          <div className="jbh"><b>{t("OPCIONES", "OPTIONS")}</b><span className="grow" /><span className="src">{t("Cada una con su efecto en la fecha esperada", "Each with its effect on the expected date")}</span></div>
          <div className="fopts">
            {B.opts.map((o) => {
              const c = chosen.get(o.key);
              return (
                <div key={o.key} className={`fopt${c ? " on" : ""}`}>
                  <b>{o.title}</b>
                  <p className="small">{o.what}</p>
                  <div className="fopt-eff">
                    <span className="src">{t("SOLU esperaría", "SOLU would expect")}</span>
                    <span className="mono">{o.newExpected ? dm(o.newExpected) : "—"}</span>
                    {fitsSig(o.fits, o.partial)}
                  </div>
                  <p className="src">{o.assumption}</p>
                  {o.draft && <details className="fopt-draft"><summary className="small">{t("Ver borrador del mensaje", "See message draft")}</summary><p className="small">{o.draft}</p></details>}
                  {c ? <span className="small ok-t">✓ {t(`Elegida por ${c.decidedByName} · ${i.day(c.decidedAt)}`, `Chosen by ${c.decidedByName} · ${i.day(c.decidedAt)}`)}</span>
                    : editable && open && (
                      <form action={chooseOption.bind(null, s.id, o.key)} className="qa-row">
                        <input name="note" placeholder={t("Nota (opcional)", "Note (optional)")} aria-label={t("Nota", "Note")} />
                        <button type="submit" className="secondary sm">{t("Elegir", "Choose")}</button>
                      </form>
                    )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="jbody">
        <div className="jmain">
          {/* Forward timeline */}
          <section className="jblock">
            <div className="jbh"><b>{t("LÍNEA HACIA ADELANTE", "FORWARD TIMELINE")}</b><span className="grow" /><span className="src">{t("planeado (hueco) · real o esperado (lleno)", "planned (hollow) · actual or expected (filled)")}</span></div>
            <div className="fvl">
              <div className="fvl-track">
                {B.nowPos != null && <span className="fvl-today" style={{ left: `${B.nowPos}%` }}><em>{t("Hoy", "Today")}</em></span>}
                {B.promisePos != null && <span className="fvl-prom" style={{ left: `${B.promisePos}%` }}><em>{t("Promesa", "Promise")}</em></span>}
                {B.ms.map((m, n) => (
                  <span key={m.key}>
                    {m.planned && m.delta !== 0 && <span className="fvl-mk plan" style={{ left: `${B.pos(m.planned)}%` }} title={`${m.label} · ${t("planeado", "planned")} ${i.day(m.planned)}`} />}
                    {m.shown && <span className={`fvl-mk ${m.done ? "done" : "exp"}${m.key === "receipt" && B.promise && m.shown > B.promise ? " late" : ""}`} style={{ left: `${B.pos(m.shown)}%` }} title={`${m.label} · ${i.day(m.shown)}`}>{n + 1}</span>}
                  </span>
                ))}
              </div>
              <ol className="fvl-legend">
                {B.ms.map((m, n) => (
                  <li key={m.key} className={m.done ? "done" : ""}>
                    <span className="n">{n + 1}</span>
                    <span><b>{m.label}</b><span className="mono">{m.shown ? i.day(m.shown) : "—"}</span><span className="src">{m.done ? t("real", "actual") : m.shown ? t("esperado", "expected") : t("sin dato", "no data")}{m.delta ? ` · ${m.delta > 0 ? "+" : ""}${m.delta} ${t("d vs plan", "d vs plan")}` : ""}</span></span>
                  </li>
                ))}
              </ol>
            </div>
            {B.deviation && (
              <table className="fexp">
                <thead><tr><th /><th>{t("Planeado", "Planned")}</th><th>{t("Real / esperado", "Actual / expected")}</th><th className="n">{t("Desvío", "Deviation")}</th></tr></thead>
                <tbody>{B.ms.filter((m) => m.planned || m.shown).map((m) => <tr key={m.key} className={m.delta && m.delta > 0 ? "late" : ""}><td>{m.label}</td><td className="mono">{i.day(m.planned)}</td><td className="mono">{i.day(m.shown)}{m.done ? "" : " ≈"}</td><td className="n mono">{m.delta == null ? "—" : m.delta === 0 ? "0" : `${m.delta > 0 ? "+" : ""}${m.delta} d`}</td></tr>)}</tbody>
              </table>
            )}
          </section>

          {/* Checkpoints */}
          <section className="jblock">
            <div className="jbh"><b>{t("LO QUE REPORTÓ EL TRANSPORTISTA", "WHAT THE CARRIER REPORTED")}</b></div>
            <details className="fscans">
              <summary><span className="sig ok">✓</span> {t(`${B.scans.length} lecturas normales`, `${B.scans.length} normal checkpoints`)}{B.lastScan ? t(` · última: ${B.lastScan.location ?? "—"}, ${i.day(B.lastScan.at)}`, ` · last: ${B.lastScan.location ?? "—"}, ${i.day(B.lastScan.at)}`) : ""}{B.withinChanges.length ? t(` · ETA ajustada ${B.withinChanges.length} ${B.withinChanges.length === 1 ? "vez" : "veces"} dentro del margen`, ` · ETA adjusted ${B.withinChanges.length} ${B.withinChanges.length === 1 ? "time" : "times"} within margin`) : ""}</summary>
              <ul className="plain small">{s.events.filter((e) => (e.kind === "SCAN" && !e.material) || (e.kind === "ETA_CHANGE" && !e.material)).map((e) => <li key={e.id}><span className="mono">{i.day(e.at)}</span> · {e.location ? `${e.location} · ` : ""}{e.text}</li>)}</ul>
            </details>
            {B.material.length === 0 ? <p className="quiet-p">{t("Sin excepciones materiales.", "No material exceptions.")}</p> : (
              <ul className="fexc">
                {B.material.map(({ e, impact, tone }) => (
                  <li key={e.id} className={tone}>
                    <span className="mono">{i.day(e.at)}</span>
                    <div><b>{e.text}</b>{e.location && <span className="src"> · {e.location}</span>}<span className="block small">{impact}</span>{e.source && <span className="src block">{e.source}</span>}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {s.international && (
            <section className={`jblock${s.customs === "HOLD" ? " fdocs-hold" : ""}`}>
              <div className="jbh"><b>{t("DOCUMENTOS Y ADUANA", "DOCUMENTS & CUSTOMS")}</b><span className="grow" />
                <span className={`sig ${s.customs === "HOLD" ? "risk" : s.customs === "CLEARED" ? "ok" : "wait"}`}>{({ NOT_REQUIRED: t("No aplica", "N/A"), PENDING: t("Pendiente de nacionalizar", "Pending clearance"), HOLD: t("Retenido", "Held"), CLEARED: t("Liberado", "Cleared") })[s.customs]}</span>
              </div>
              <ul className="qv-checks">
                {B.docs.map((x) => (
                  <li key={x.key} className={x.ready ? "ok" : "no"}>
                    <span className="ic" aria-hidden>{x.ready ? "✓" : "!"}</span>
                    <span>{x.label}{editable && open && <form action={toggleDoc.bind(null, s.id, x.key)} className="inline-f"><button type="submit" className="linkb">{x.ready ? t("marcar pendiente", "mark pending") : t("marcar listo", "mark ready")}</button></form>}</span>
                  </li>
                ))}
              </ul>
              {s.customsNote && <p className="small" style={{ marginTop: 8 }}>{s.customsNote}</p>}
            </section>
          )}

          {B.showMap && (
            <section className="jblock">
              <div className="jbh"><b>{t("RUTA ACTUAL", "CURRENT ROUTE")}</b><span className="grow" /><span className="src">{t("esquemática · según lecturas del transportista", "schematic · from carrier checkpoints")}</span></div>
              <RouteMap pts={B.pts} dest={{ lat: s.destLat!, lng: s.destLng! }} destLabel={s.destination ?? ""} title={t("Ruta del envío", "Shipment route")} />
            </section>
          )}
          <ShipmentDates shipmentId={s.id} lang={i.es ? "ES" : "EN"} editable={editable} />
          <ShipmentCustoms shipmentId={s.id} lang={i.es ? "ES" : "EN"} editable={editable} />
          <ShipmentAudit shipmentId={s.id} lang={i.es ? "ES" : "EN"} editable={editable} canMoney={canEditMoney(user, d.ownerId)} />
        </div>

        <aside className="jrail">
          {editable && open && (
            <div>
              <div className="jbh"><b>{t("REGISTRAR", "RECORD")}</b></div>
              <div className="qa-bar col">
                {!s.deliveredAt && (
                  <details className="qa"><summary className="qa-btn">{t("Nueva ETA del transportista", "New carrier ETA")}</summary><div className="qa-pop wide">
                    <form action={updateEta.bind(null, s.id)} className="qa-form">
                      <label>{t("Fecha que da el transportista", "Date the carrier gives")}<input name="carrierEta" type="date" defaultValue={dayInput(s.carrierEta)} required /></label>
                      <label>{t("Fuente", "Source")}<input name="source" placeholder={t("Ej.: tracking web", "E.g.: tracking site")} /></label>
                      <span className="src">{t("Solo cambia la verdad del transportista. La promesa no se toca.", "Only the carrier's truth changes. The promise isn't touched.")}</span>
                      <button type="submit">{t("Guardar", "Save")}</button>
                    </form>
                  </div></details>
                )}
                {!s.deliveredAt && (
                  <details className="qa"><summary className="qa-btn">{t("Lectura o excepción", "Checkpoint or exception")}</summary><div className="qa-pop wide">
                    <form action={addCheckpoint.bind(null, s.id)} className="qa-form">
                      <label>{t("Dónde", "Where")}<input name="location" /></label>
                      <label>{t("Qué reportó", "What it reported")}<input name="text" required /></label>
                      <label className="chk"><input type="checkbox" name="exception" value="1" /> {t("Es una excepción (cambia el resultado o pide acción)", "It's an exception (changes the result or needs action)")}</label>
                      <button type="submit">{t("Registrar", "Record")}</button>
                    </form>
                  </div></details>
                )}
                {s.international && s.customs !== "HOLD" && s.customs !== "CLEARED" && (
                  <details className="qa"><summary className="qa-btn">{t("Retenido en aduana", "Customs hold")}</summary><div className="qa-pop wide">
                    <form action={setCustoms.bind(null, s.id, "HOLD")} className="qa-form"><label>{t("Qué pide la aduana", "What customs asks for")}<input name="note" required /></label><button type="submit">{t("Registrar retención", "Record hold")}</button></form>
                  </div></details>
                )}
                {s.international && s.customs !== "CLEARED" && (
                  <form action={setCustoms.bind(null, s.id, "CLEARED")}><button type="submit" className="qa-btn">{t("✓ Liberado por la aduana", "✓ Cleared by customs")}</button></form>
                )}
                {!s.deliveredAt && (
                  <details className="qa"><summary className="qa-btn">{t("El transportista entregó", "Carrier delivered")}</summary><div className="qa-pop wide">
                    <form action={markDelivered.bind(null, s.id)} className="qa-form"><label>{t("Prueba de entrega (quién firmó)", "Proof of delivery (who signed)")}<input name="note" /></label><button type="submit">{t("Registrar entrega", "Record delivery")}</button></form>
                  </div></details>
                )}
              </div>
            </div>
          )}
          {editable && open && (s.deliveredAt || s.receipt === "DISPUTED") && (
            <div>
              <div className="jbh"><b>{t("RECIBO DEL CLIENTE", "CUSTOMER RECEIPT")}</b></div>
              <form action={confirmReceipt.bind(null, s.id)} className="qa-form">
                <label>{t("Quién recibió", "Received by")}<input name="receivedByName" required /></label>
                <button type="submit" className="wide">{s.receipt === "DISPUTED" ? t("Resuelto: confirmar recibo completo", "Resolved: confirm full receipt") : t("Confirmar recibo", "Confirm receipt")}</button>
                <span className="src">{t("Crea la remisión y habilita la factura.", "Creates the delivery note and enables invoicing.")}</span>
              </form>
              {s.receipt !== "DISPUTED" && (
                <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("Discrepancia (falta, daño, no llegó)", "Discrepancy (short, damaged, not arrived)")}</summary><div className="qa-pop wide">
                  <form action={disputeReceipt.bind(null, s.id)} className="qa-form"><label>{t("Qué dice el cliente", "What the customer says")}<input name="note" required /></label><button type="submit" className="secondary">{t("Registrar discrepancia", "Record discrepancy")}</button></form>
                </div></details>
              )}
            </div>
          )}
          {s.delivery && <p className="small"><span className="sig ok">✓</span> {t("Remisión", "Delivery note")} <Link href={`/operaciones/remisiones/${s.delivery.id}`}>{s.delivery.code}</Link></p>}
          <div>
            <div className="jbh"><b>{t("CONTENIDO", "CONTENTS")}</b></div>
            <ul className="plain small">{s.lines.map((l) => <li key={l.id}><span className="mono">{l.qty} ×</span> {l.description}</li>)}{s.lines.length === 0 && <li>—</li>}</ul>
          </div>
          {s.decisions.length > 0 && (
            <div>
              <div className="jbh"><b>{t("DECISIONES", "DECISIONS")}</b></div>
              <ul className="plain small">{s.decisions.map((x) => <li key={x.id}><b>{x.title}</b><span className="src block">{x.decidedByName} · {i.day(x.decidedAt)}{x.note ? ` · ${x.note}` : ""}</span></li>)}</ul>
            </div>
          )}
          <p className="note ai">{t("SOLU no notifica cada lectura del transportista. Solo interrumpe si la fecha esperada cruza la promesa.", "SOLU doesn't notify every carrier scan. It only interrupts if the expected date crosses the promise.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
