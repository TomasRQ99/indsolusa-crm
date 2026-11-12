import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAdminPeople, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { ASSET_CATS, ASSET_STATUS, assetDue } from "@/lib/admin-rules";
import { getAdminPolicy } from "@/lib/admin-store";
import { createAsset } from "./actions";

// Módulo 14 §2H · Activos: what the company owns, who has it and what it needs soon (insurance, maintenance,
// warranty). Everyone sees what they have in their care; Administración sees everything.

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; compra?: string; ver?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const all = canFinance(user) || canAdminPeople(user);
  const [rows, pol, ips] = await Promise.all([
    db.asset.findMany({ where: { ...(all ? {} : { custodianId: user.id }), ...(sp.ver === "baja" ? {} : { status: { not: "DISPOSED" } }) }, orderBy: [{ category: "asc" }, { name: "asc" }], include: { custodian: { select: { name: true } } } }),
    getAdminPolicy(),
    all ? db.internalPurchase.findMany({ where: { status: "APPROVED", purpose: "CAPITAL_ASSET", asset: null }, select: { id: true, code: true, description: true, amount: true, currency: true } }) : [],
  ]);
  const T = today();
  const due = rows.flatMap((a) => assetDue(a, T, pol.value.obligationLeadDays).map((d) => ({ a, d }))).sort((x, y) => Number(y.d.late) - Number(x.d.late));
  const pre = ips.find((p) => p.id === sp.compra);
  const errMsg: Record<string, string> = { permiso: t("Solo Administración, Finanzas o Gerencia registran activos.", "Only Administration, Finance or Management record assets."), datos: t("Faltan datos: nombre, tipo y a nombre de qué empresa está. No se guardó nada.", "Missing data: name, kind and which company owns it. Nothing was saved."), "no-existe": t("Ese activo no existe.", "That asset doesn't exist.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Activos y custodia", "Assets and custody")}</h1><p>{all ? t("Lo que la empresa tiene, quién lo tiene a cargo y lo que necesita pronto.", "What the company owns, who is responsible for it and what it needs soon.") : t("Lo que tienes a tu cargo.", "What you are responsible for.")}</p></div></div>
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {due.length > 0 && <section className="card" id="atencion"><b>{t("NECESITAN ALGO", "THEY NEED SOMETHING")} · {due.length}</b>
        <ul className="plain small">{due.map(({ a, d }, k) => <li key={k}><span className={`sig ${d.late ? "risk" : "attn"}`}>{t(d.text.es, d.text.en)}</span> <Link href={`/administracion/activos/${a.id}`}><b>{a.code}</b> · {a.name}</Link>{d.on ? ` · ${i.day(d.on)}` : ""}{a.custodian ? ` · ${a.custodian.name}` : ""}</li>)}</ul>
      </section>}

      <section className="card"><b>{t("ACTIVOS", "ASSETS")} · {rows.length}</b>
        {rows.length === 0 ? <p className="small muted">{all ? t("Aún no hay activos registrados.", "No assets recorded yet.") : t("No tienes activos a tu cargo.", "You have no assets in your care.")}{all ? <> <a href="#nuevo">{t("Registrar un activo", "Record an asset")} →</a></> : null}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Activo", "Asset")}</th><th>{t("Tipo", "Kind")}</th><th>{t("Quién lo tiene", "Who has it")}</th><th>{t("Dónde", "Where")}</th><th className="n">{t("Valor", "Value")}</th><th>{t("Estado", "Status")}</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}><td><Link href={`/administracion/activos/${a.id}`}><b>{a.code}</b> · {a.name}</Link>{a.plate ? <span className="src block">{a.plate}{a.odometerKm != null ? ` · ${i.n(a.odometerKm)} km` : ""}</span> : a.serial ? <span className="src block">{a.serial}</span> : null}</td>
                <td className="small">{ASSET_CATS[a.category] ? t(ASSET_CATS[a.category].es, ASSET_CATS[a.category].en) : a.category}</td>
                <td>{a.custodian?.name ?? <span className="muted">—</span>}</td><td className="small">{a.location ?? "—"}</td>
                <td className="n mono">{a.value != null ? `${a.currency} ${i.n2(a.value)}` : "—"}</td>
                <td><span className={`sig ${ASSET_STATUS[a.status]?.tone ?? "wait"}`}>{ASSET_STATUS[a.status] ? t(ASSET_STATUS[a.status].es, ASSET_STATUS[a.status].en) : a.status}</span></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {all && <p className="small">{sp.ver === "baja" ? <Link href="/administracion/activos">{t("Ocultar los dados de baja", "Hide disposed")}</Link> : <Link href="/administracion/activos?ver=baja">{t("Ver también los dados de baja", "Also show disposed")}</Link>}</p>}
      </section>

      {all && <section className="card" id="nuevo">
        <b>{t("REGISTRAR UN ACTIVO", "RECORD AN ASSET")}</b>
        <form action={createAsset} className="qa-form">
          {ips.length > 0 && <label>{t("Viene de una compra interna aprobada", "It comes from an approved internal purchase")}<select name="internalPurchaseId" defaultValue={pre?.id ?? ""}><option value="">{t("No", "No")}</option>{ips.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description} · {p.currency} {i.n2(p.amount)}</option>)}</select></label>}
          <div className="qa-row">
            <label style={{ flex: 2 }}>{t("Nombre", "Name")}<input name="name" required maxLength={160} defaultValue={pre?.description ?? ""} /></label>
            <label>{t("Tipo", "Kind")}<select name="category">{Object.entries(ASSET_CATS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label>{t("A nombre de (empresa dueña)", "Legal owner (company)")}<input name="legalOwner" required maxLength={120} defaultValue="Industry Solutions USA" /></label>
          </div>
          <div className="qa-row">
            <label>{t("Valor", "Value")}<input name="value" inputMode="decimal" defaultValue={pre ? String(pre.amount) : ""} /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" defaultValue={pre?.currency ?? "USD"} maxLength={3} style={{ width: 70 }} /></label>
            <label>{t("Fecha de compra", "Acquired on")}<input type="date" name="acquiredOn" /></label>
            <label>{t("Serial", "Serial")}<input name="serial" maxLength={80} /></label>
            <label>{t("Dónde está", "Where it is")}<input name="location" maxLength={120} /></label>
          </div>
          <div className="qa-row">
            <label>{t("Garantía hasta", "Warranty until")}<input type="date" name="warrantyUntil" /></label>
            <label>{t("Aseguradora", "Insurer")}<input name="insurer" maxLength={120} /></label>
            <label>{t("Seguro hasta", "Insured until")}<input type="date" name="insuranceUntil" /></label>
            <label>{t("Próximo mantenimiento", "Next maintenance")}<input type="date" name="nextMaintenanceOn" /></label>
          </div>
          <div className="qa-row">
            <label>{t("Placa (vehículos)", "Plate (vehicles)")}<input name="plate" maxLength={20} /></label>
            <label>{t("Kilometraje", "Odometer (km)")}<input name="odometerKm" inputMode="numeric" /></label>
            <label style={{ flex: 2 }}>{t("Documentos (dónde están)", "Documents (where they are)")}<input name="documentsNote" maxLength={500} /></label>
          </div>
          <div><button type="submit">{t("Registrar", "Record")}</button></div>
        </form>
        <p className="src">{t("Después de registrarlo, asígnalo a quien lo tendrá a cargo.", "After recording it, assign it to whoever will be responsible for it.")}</p>
      </section>}
    </>
  );
}
