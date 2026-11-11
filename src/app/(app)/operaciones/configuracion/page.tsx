import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { OPS_POLICY_BOUNDS, OPS_POLICY_KEY, type OpsPolicy } from "@/lib/ops-rules";
import { getOpsPolicy } from "@/lib/ops-home";
import { saveLocation, saveOpsPolicy } from "./actions";

// Operaciones · settings: the thresholds Operations works with, and the warehouses. Everyone can read them;
// Gerencia changes them.

export default async function OpsSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const edit = isGerencia(user);
  const [pol, history, locations, stock] = await Promise.all([
    getOpsPolicy(),
    db.marketSetting.findMany({ where: { key: OPS_POLICY_KEY }, orderBy: { version: "desc" }, take: 6 }),
    db.stockLocation.findMany({ orderBy: { name: "asc" } }),
    db.stockLot.groupBy({ by: ["locationId"], where: { outAt: null }, _sum: { qty: true } }),
  ]);
  const F: { k: keyof OpsPolicy; label: string; help: string; unit: string }[] = [
    { k: "narrowDays", label: t("Margen para considerar una promesa «justa»", "Margin to call a promise \"narrow\""), help: t("Si lo esperado queda a estos días o menos de la fecha prometida, la promesa se marca justa.", "If what is expected lands within these days of the promised date, the promise is marked narrow."), unit: t("días", "days") },
    { k: "upcomingDays", label: t("Ventana de pagos próximos", "Upcoming payments window"), help: t("Cuántos días hacia adelante cuenta el inicio de Operaciones como «pagos próximos».", "How many days ahead the Operations home counts as \"upcoming payments\"."), unit: t("días", "days") },
    { k: "graceDays", label: t("Gracia para un compromiso del proveedor", "Grace for a supplier commitment"), help: t("Días después de la fecha, sin evidencia, antes de marcarlo incumplido.", "Days after the date, without evidence, before marking it missed."), unit: t("días", "days") },
    { k: "warrantyMonths", label: t("Garantía por defecto", "Default warranty"), help: t("Los meses que propone el formulario al registrar una garantía. Siempre se puede cambiar en cada caso.", "The months the form proposes when recording a warranty. It can always be changed case by case."), unit: t("meses", "months") },
    { k: "courierMaxKg", label: t("Courier: peso físico máximo", "Courier: maximum physical weight"), help: t("Hasta este peso el envío va por la cuenta courier.", "Up to this weight the shipment goes on the courier account."), unit: "kg" },
    { k: "cargoOverKg", label: t("Carga: peso físico desde el cual es importación formal", "Cargo: physical weight above which it is a formal import"), help: t("Por encima de este peso físico (no volumétrico) va por la cuenta de carga, con nacionalización.", "Above this physical (not volumetric) weight it goes on the cargo account, with nationalisation."), unit: "kg" },
    { k: "cargoFobUsd", label: t("Carga: valor FOB desde el cual es importación formal", "Cargo: FOB value above which it is a formal import"), help: t("Valor del bien solo, sin fletes, servicios ni certificaciones.", "Value of the goods alone, without freight, services or certifications."), unit: "USD" },
    { k: "warrantyEndingDays", label: t("Aviso de garantía por terminar", "Warranty ending notice"), help: t("Con cuántos días de anticipación aparece una garantía como «por terminar».", "How many days ahead a warranty shows as \"ending\"."), unit: t("días", "days") },
  ];
  const okMsg: Record<string, string> = { politica: t("Umbrales guardados como una versión nueva.", "Thresholds saved as a new version."), igual: t("No hubo cambios.", "No changes."), bodega: t("Bodega guardada.", "Warehouse saved.") };
  const errMsg: Record<string, string> = { permiso: t("Solo Gerencia cambia la configuración de Operaciones.", "Only Management changes the Operations settings."), valor: t("Algún valor está fuera del rango permitido. No se guardó nada.", "A value is outside its allowed range. Nothing was saved."), bodega: t("Escribe el nombre de la bodega.", "Write the warehouse name."), "bodega-stock": t("Esa bodega todavía tiene inventario: no se puede desactivar.", "That warehouse still holds stock: it can't be switched off."), "bodega-repetida": t("Ya existe una bodega con ese nombre.", "A warehouse with that name already exists.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Configuración de Operaciones", "Operations settings")}</h1><p>{t("Los umbrales con los que SOLU decide qué mostrar como atención, y las bodegas. Cada cambio queda como una versión con quién y cuándo.", "The thresholds SOLU uses to decide what to show as attention, and the warehouses. Each change is kept as a version with who and when.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="umbrales">
        <b>{t("UMBRALES", "THRESHOLDS")}</b> <span className="small muted">{pol.version ? t(`versión ${pol.version}`, `version ${pol.version}`) : t("valores iniciales, aún sin confirmar", "starting values, not confirmed yet")}</span>
        <form action={saveOpsPolicy} className="qa-form" style={{ marginTop: 8, maxWidth: 720 }}>
          {F.map((f) => (
            <label key={f.k}>{f.label} ({f.unit}, {OPS_POLICY_BOUNDS[f.k][0]}–{OPS_POLICY_BOUNDS[f.k][1]})
              <input name={f.k} type="number" min={OPS_POLICY_BOUNDS[f.k][0]} max={OPS_POLICY_BOUNDS[f.k][1]} step={1} required defaultValue={pol.value[f.k]} disabled={!edit} style={{ maxWidth: 140 }} />
              <span className="src">{f.help}</span>
            </label>
          ))}
          {edit ? <button type="submit">{t("Guardar umbrales", "Save thresholds")}</button> : <span className="src">{t("Solo Gerencia los cambia.", "Only Management changes them.")}</span>}
        </form>
        {history.length > 0 && <ul className="plain small" style={{ marginTop: 8 }}>{history.map((h) => <li key={h.id}><span className="mono">v{h.version}</span> · {h.updatedByName} · {i.day(h.createdAt)} · <span className="muted">{F.map((f) => `${(h.value as Record<string, number>)[f.k] ?? "—"}`).join(" / ")}</span></li>)}</ul>}
        <p className="src">{t("Otros valores viven en sus propias pantallas: aprobaciones de compra en Requerimientos, reglas de peso y tolerancias de flete en Transportadores.", "Other values live on their own screens: purchase approvals in Requirements, weight rules and freight tolerances in Carriers.")}</p>
      </section>

      <section className="card" id="bodegas">
        <b>{t("BODEGAS", "WAREHOUSES")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Bodega", "Warehouse")}</th><th>{t("País", "Country")}</th><th className="n">{t("Unidades hoy", "Units today")}</th><th>{t("Estado", "State")}</th>{edit && <th />}</tr></thead>
          <tbody>{locations.map((l) => (
            <tr key={l.id}>
              <td><b>{l.name}</b><span className="src block mono">{l.key}</span></td><td className="small">{l.country ?? "—"}</td>
              <td className="n mono">{stock.find((s) => s.locationId === l.id)?._sum.qty ?? 0}</td>
              <td>{l.active ? <span className="sig ok">{t("Activa", "Active")}</span> : <span className="sig wait">{t("Inactiva", "Inactive")}</span>}</td>
              {edit && <td><details className="qa"><summary className="linkb">{t("cambiar", "change")}</summary>
                <form action={saveLocation} className="qa-row" style={{ alignItems: "flex-end", marginTop: 6 }}>
                  <input type="hidden" name="id" value={l.id} />
                  <label>{t("Nombre", "Name")}<input name="name" required maxLength={80} defaultValue={l.name} /></label>
                  <label>{t("País", "Country")}<input name="country" maxLength={60} defaultValue={l.country ?? ""} /></label>
                  <label className="chk"><input type="checkbox" name="active" value="1" defaultChecked={l.active} /> {t("Activa", "Active")}</label>
                  <button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Guardar", "Save")}</button>
                </form></details></td>}
            </tr>
          ))}</tbody>
        </table></div>
        {edit && (
          <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Agregar bodega", "+ Add warehouse")}</summary>
            <form action={saveLocation} className="qa-row" style={{ alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
              <label>{t("Nombre", "Name")}<input name="name" required maxLength={80} placeholder={t("Ej.: Bodega Bogotá", "E.g.: Bogotá warehouse")} /></label>
              <label style={{ flex: "0 0 200px" }}>{t("País", "Country")}<input name="country" maxLength={60} /></label>
              <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Agregar", "Add")}</button>
            </form>
          </details>
        )}
      </section>
    </>
  );
}
