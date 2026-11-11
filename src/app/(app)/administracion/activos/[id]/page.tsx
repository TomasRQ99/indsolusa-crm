import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canAdminPeople, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { ASSET_CATS, ASSET_EVENTS, ASSET_STATUS, assetDue } from "@/lib/admin-rules";
import { getAdminPolicy } from "@/lib/admin-store";
import { recordAssetEvent } from "../actions";

// Módulo 14 §2H · one asset: where it stands today and its whole history, which is never edited.

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const a = await db.asset.findUnique({ where: { id }, include: { custodian: { select: { id: true, name: true } }, events: { orderBy: [{ at: "desc" }, { createdAt: "desc" }] }, internalPurchase: { select: { id: true, code: true } } } });
  if (!a) notFound();
  const manage = canFinance(user) || canAdminPeople(user);
  const holder = a.custodianId === user.id;
  if (!manage && !holder) return <div className="note risk">{t("Este activo lo ven quien lo tiene a cargo y Administración.", "This asset is seen by whoever is responsible for it and by Administration.")}</div>;
  const [pol, people] = await Promise.all([getAdminPolicy(), manage ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : []]);
  const T = today();
  const due = assetDue(a, T, pol.value.obligationLeadDays);
  const live = a.status !== "DISPOSED";
  const vehicle = a.category === "VEHICLE";
  const okMsg: Record<string, string> = { creado: t("Activo registrado. Asígnalo a quien lo tendrá a cargo.", "Asset recorded. Assign it to whoever will be responsible for it."), registrado: t("Registrado en la historia del activo.", "Recorded in the asset's history.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso para esto.", "You don't have permission for this."), baja: t("Este activo ya fue dado de baja.", "This asset was already disposed."), fecha: t("La fecha no puede ser futura.", "The date can't be in the future."), persona: t("Elige a quién se le entrega (o escribe a dónde se traslada).", "Choose who receives it (or type where it is moved to)."), igual: t("Eso no cambia nada: ya está así.", "That changes nothing: it is already so."), nota: t("Escribe qué pasó.", "Write what happened."), km: t("El kilometraje no puede ser menor que el último registrado.", "The odometer can't be lower than the last reading."), seguro: t("El seguro necesita aseguradora y fecha final.", "The insurance needs an insurer and an end date."), datos: t("Faltan datos.", "Missing data.") };

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/administracion/activos">{t("Activos", "Assets")}</Link></div>
        <h1>{a.code} · {a.name}</h1>
        <p>{ASSET_CATS[a.category] ? t(ASSET_CATS[a.category].es, ASSET_CATS[a.category].en) : a.category} · {t("a nombre de", "owned by")} {a.legalOwner} <span className={`sig ${ASSET_STATUS[a.status]?.tone ?? "wait"}`}>{ASSET_STATUS[a.status] ? t(ASSET_STATUS[a.status].es, ASSET_STATUS[a.status].en) : a.status}</span></p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {due.map((d) => <div key={d.key} className={`note ${d.late ? "risk" : "attn"}`}>{t(d.text.es, d.text.en)}{d.on ? ` · ${i.date(d.on)}` : ""}</div>)}

      <section className="card"><b>{t("HOY", "TODAY")}</b>
        <dl className="qv-dl">
          <dt>{t("Quién lo tiene", "Who has it")}</dt><dd>{a.custodian?.name ?? <span className="muted">{t("nadie", "nobody")}</span>}</dd>
          <dt>{t("Dónde", "Where")}</dt><dd>{a.location ?? "—"}</dd>
          <dt>{t("Valor", "Value")}</dt><dd className="mono">{a.value != null ? `${a.currency} ${i.n2(a.value)}` : "—"}{a.acquiredOn ? ` · ${t("comprado el", "acquired")} ${i.date(a.acquiredOn)}` : ""}{a.internalPurchase ? <> · <Link href={`/administracion/compras-internas/${a.internalPurchase.id}`}>{a.internalPurchase.code}</Link></> : null}</dd>
          {a.serial && <><dt>{t("Serial", "Serial")}</dt><dd className="mono">{a.serial}</dd></>}
          {(vehicle || a.plate) && <><dt>{t("Placa y kilometraje", "Plate and odometer")}</dt><dd className="mono">{a.plate ?? "—"} · {a.odometerKm != null ? `${i.n(a.odometerKm)} km` : "—"}</dd></>}
          <dt>{t("Garantía", "Warranty")}</dt><dd>{a.warrantyUntil ? `${t("hasta", "until")} ${i.date(a.warrantyUntil)}` : "—"}</dd>
          <dt>{t("Seguro", "Insurance")}</dt><dd>{a.insurer ? `${a.insurer}${a.insuranceUntil ? ` · ${t("hasta", "until")} ${i.date(a.insuranceUntil)}` : ""}` : <span className="muted">{t("sin seguro registrado", "no insurance recorded")}</span>}</dd>
          <dt>{t("Próximo mantenimiento", "Next maintenance")}</dt><dd>{a.nextMaintenanceOn ? i.date(a.nextMaintenanceOn) : "—"}</dd>
          {a.documentsNote && <><dt>{t("Documentos", "Documents")}</dt><dd className="small">{a.documentsNote}</dd></>}
        </dl>
      </section>

      {live && manage && <section className="card" id="mover"><b>{t("ENTREGAR, TRASLADAR O DEVOLVER", "HAND OVER, MOVE OR RETURN")}</b>
        <form action={recordAssetEvent.bind(null, a.id)} className="qa-form">
          <div className="qa-row">
            <label>{t("Qué pasa", "What happens")}<select name="kind"><option value="ASSIGNED">{t("Se entrega a una persona", "Handed to a person")}</option><option value="TRANSFERRED">{t("Se traslada de lugar", "Moved to another place")}</option>{a.custodianId && <option value="RETURNED">{t("Se devuelve a la empresa", "Returned to the company")}</option>}</select></label>
            <label>{t("A quién", "To whom")}<select name="toUserId" defaultValue=""><option value="">—</option>{people.filter((p) => p.id !== a.custodianId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>{t("Dónde queda", "Where it will be")}<input name="location" maxLength={120} placeholder={a.location ?? ""} /></label>
            <label>{t("Fecha", "Date")}<input type="date" name="at" defaultValue={dayInput(T)} max={dayInput(T)} /></label>
          </div>
          <label>{t("Nota o acta de entrega", "Note or handover record")}<input name="note" maxLength={500} /></label>
          <div><button type="submit">{t("Registrar", "Record")}</button></div>
        </form>
      </section>}

      {live && <section className="card" id="hecho"><b>{t("REGISTRAR ALGO QUE PASÓ", "RECORD SOMETHING THAT HAPPENED")}</b>
        <form action={recordAssetEvent.bind(null, a.id)} className="qa-form">
          <div className="qa-row">
            <label>{t("Qué", "What")}<select name="kind"><option value="MAINTENANCE">{t("Mantenimiento hecho", "Maintenance done")}</option>{(vehicle || a.odometerKm != null) && <option value="ODOMETER">{t("Kilometraje", "Odometer reading")}</option>}{manage && <option value="INSURANCE">{t("Seguro nuevo o renovado", "New or renewed insurance")}</option>}{manage && <option value="DOCUMENT">{t("Documento", "Document")}</option>}</select></label>
            <label>{t("Fecha", "Date")}<input type="date" name="at" defaultValue={dayInput(T)} max={dayInput(T)} /></label>
            <label>{t("Costo (USD)", "Cost (USD)")}<input name="costUsd" inputMode="decimal" /></label>
            {(vehicle || a.odometerKm != null) && <label>{t("Kilometraje", "Odometer (km)")}<input name="odometerKm" inputMode="numeric" /></label>}
          </div>
          <div className="qa-row">
            <label>{t("Próximo mantenimiento", "Next maintenance")}<input type="date" name="nextOn" /></label>
            {manage && <label>{t("Aseguradora", "Insurer")}<input name="insurer" maxLength={120} defaultValue={a.insurer ?? ""} /></label>}
            {manage && <label>{t("Seguro hasta", "Insured until")}<input type="date" name="until" /></label>}
          </div>
          <label>{t("Qué se hizo", "What was done")}<input name="note" maxLength={500} /></label>
          <label>{t("Soporte (factura, póliza, foto)", "Evidence (invoice, policy, photo)")}<input name="evidence" maxLength={200} /></label>
          <div><button type="submit" className="secondary">{t("Registrar", "Record")}</button></div>
        </form>
      </section>}

      <section className="card" id="historia"><b>{t("HISTORIA", "HISTORY")} · {a.events.length}</b>
        <ul className="plain small">{a.events.map((e) => (
          <li key={e.id}><span className="mono">{i.date(e.at)}</span> · <b>{ASSET_EVENTS[e.kind] ? t(ASSET_EVENTS[e.kind].es, ASSET_EVENTS[e.kind].en) : e.kind}</b>
            {(e.kind === "ASSIGNED" || e.kind === "TRANSFERRED" || e.kind === "RETURNED") ? <> · {e.fromName ?? t("la empresa", "the company")} → {e.toName ?? (e.kind === "RETURNED" ? t("la empresa", "the company") : e.fromName ?? "—")}{e.location ? ` · ${e.location}` : ""}</> : null}
            {e.odometerKm != null ? ` · ${i.n(e.odometerKm)} km` : ""}{e.costUsd != null ? ` · USD ${i.n2(e.costUsd)}` : ""}{e.note ? ` · ${e.note}` : ""}{e.evidence ? ` · ${e.evidence}` : ""} <span className="muted">· {e.byName}</span></li>
        ))}</ul>
        <p className="src">{t("La historia no se edita ni se borra: una corrección es un registro nuevo.", "History is never edited or deleted: a correction is a new record.")}</p>
      </section>

      {live && manage && <details id="baja"><summary className="small">{t("Dar de baja (venta, pérdida, fin de vida)", "Dispose (sale, loss, end of life)")}</summary>
        <form action={recordAssetEvent.bind(null, a.id)} className="qa-row" style={{ alignItems: "center" }}><input type="hidden" name="kind" value="DISPOSED" /><input name="note" required placeholder={t("Qué pasó con el activo", "What happened to the asset")} aria-label={t("Motivo", "Reason")} /><input type="date" name="at" defaultValue={dayInput(T)} max={dayInput(T)} aria-label={t("Fecha", "Date")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }} data-confirm={t("¿Dar de baja este activo? No se puede deshacer.", "Dispose this asset? It can't be undone.")}>{t("Dar de baja", "Dispose")}</button></form>
      </details>}
    </>
  );
}
