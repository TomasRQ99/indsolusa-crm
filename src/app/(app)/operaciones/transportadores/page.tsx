import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { getSellers } from "@/lib/sellers";
import { adapters } from "@/lib/carriers/gateway";
import { DHL_KEY, dhlCredentialStatus } from "@/lib/carriers/dhl";
import { saveCarrierAccount } from "./actions";
import { saveRatingRule } from "@/app/(app)/logistica/auditoria-actions";

// Operaciones O5b · carriers: which accounts exist, which company owns each, and whether its credentials are in
// place on the server. Presence only: a credential is never shown, stored in the database or typed on this screen.

export default async function CarriersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const edit = isGerencia(user);
  const [rules, accounts, sellers, attempts] = await Promise.all([
    db.carrierRatingRule.findMany({ orderBy: [{ carrier: "asc" }, { service: "asc" }] }),
    db.carrierAccount.findMany({ orderBy: { createdAt: "asc" } }),
    getSellers(),
    db.carrierIntegrationAttempt.count({ where: { state: "UNCERTAIN" } }),
  ]);
  const dhl = adapters().find((a) => a.key === DHL_KEY);
  const errMsg: Record<string, string> = { permiso: t("Solo Gerencia registra cuentas de transportadores.", "Only Management registers carrier accounts."), datos: t("Indica un nombre y una referencia en mayúsculas, sin espacios (ej.: DHL_USA).", "Give a name and a reference in capitals, no spaces (e.g.: DHL_USA).") };
  const yes = (ok: boolean) => <span className={`sig ${ok ? "ok" : "wait"}`}>{ok ? t("Está", "Present") : t("Falta", "Missing")}</span>;

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Transportadores", "Carriers")}</h1>
          <p>{t("SOLU habla con los transportadores a través de una sola capa. Hoy todo transportador se maneja a mano; DHL Express se conectará aquí. Las credenciales nunca se escriben en esta pantalla ni se guardan en SOLU: viven en la configuración del servidor.", "SOLU talks to carriers through one layer. Today every carrier is handled by hand; DHL Express will connect here. Credentials are never typed on this screen or stored in SOLU: they live in the server's settings.")}</p>
        </div>
      </div>
      {sp.ok === "guardada" && <div className="note okn">{t("Cuenta guardada.", "Account saved.")}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {attempts > 0 && <div className="note attn">{t(`${attempts} operación(es) con un transportador quedaron inciertas: se revisan antes de repetir nada.`, `${attempts} carrier operation(s) are uncertain: they are checked before anything is repeated.`)}</div>}

      <section className="card">
        <b>DHL Express · MyDHL API</b>
        <p className="small">{dhl && dhl.capabilities.length > 0 ? t("Conexión activa.", "Connection active.") : t("Conexión aún no activa: las funciones (tarifas, guías, recogidas, rastreo, prueba de entrega) se escriben a partir de la especificación oficial de DHL y se prueban en su ambiente de pruebas antes de usarse.", "Connection not active yet: the functions (rates, waybills, pickups, tracking, proof of delivery) are written from DHL's official specification and verified in its test environment before use.")}</p>
        {accounts.length === 0 ? <p className="small muted">{t("Aún no hay cuentas registradas.", "No accounts registered yet.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cuenta", "Account")}</th><th>{t("Empresa dueña", "Owning company")}</th><th>{t("Ambiente", "Environment")}</th><th>{t("Clave", "Key")}</th><th>{t("Secreto", "Secret")}</th><th>{t("Número de cuenta", "Account number")}</th><th>{t("Estado", "Status")}</th></tr></thead>
            <tbody>{accounts.map((a) => { const s = dhlCredentialStatus(a.secretRef); return (
              <tr key={a.id}>
                <td><b>{a.label}</b>{a.accountLast4 && <span className="mono small"> ····{a.accountLast4}</span>}<span className="src block mono">{a.secretRef}</span></td>
                <td className="small">{sellers.find((x) => x.key === a.sellerKey)?.legalName || a.sellerKey}</td>
                <td className="small">{a.environment === "PRODUCTION" ? t("Producción", "Production") : t("Pruebas", "Test")}</td>
                <td>{yes(s.key)}<span className="src block mono">{s.names.key}</span></td>
                <td>{yes(s.secret)}<span className="src block mono">{s.names.secret}</span></td>
                <td>{yes(s.account)}<span className="src block mono">{s.names.account}</span></td>
                <td>{a.active ? <span className="sig ok">{t("Activa", "Active")}</span> : <span className="sig wait">{t("Inactiva", "Inactive")}</span>}{!s.complete && <span className="src block">{t("Faltan credenciales en el servidor", "Credentials missing on the server")}</span>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}
        {edit && (
          <details className="qa" style={{ marginTop: 10 }}><summary className="qa-btn">{t("+ Registrar o actualizar una cuenta DHL", "+ Register or update a DHL account")}</summary>
            <form action={saveCarrierAccount} className="qa-form" style={{ marginTop: 8, maxWidth: 640 }}>
              <div className="qa-row">
                <label>{t("Nombre para reconocerla", "Name to recognise it")}<input name="label" required maxLength={120} placeholder="DHL Express · USA" /></label>
                <label style={{ flex: "0 0 180px" }}>{t("Referencia (mayúsculas)", "Reference (capitals)")}<input name="secretRef" required maxLength={32} placeholder="DHL_USA" /></label>
              </div>
              <div className="qa-row">
                <label>{t("Empresa dueña", "Owning company")}<select name="sellerKey" defaultValue="USA">{sellers.map((s) => <option key={s.key} value={s.key}>{s.legalName || s.key}</option>)}</select></label>
                <label style={{ flex: "0 0 150px" }}>{t("Ambiente", "Environment")}<select name="environment" defaultValue="TEST"><option value="TEST">{t("Pruebas", "Test")}</option><option value="PRODUCTION">{t("Producción", "Production")}</option></select></label>
                <label style={{ flex: "0 0 150px" }}>{t("Últimos 4 dígitos de la cuenta", "Last 4 digits of the account")}<input name="accountLast4" maxLength={4} inputMode="numeric" /></label>
                <label style={{ flex: "0 0 100px" }}>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue="USD" /></label>
              </div>
              <label className="chk"><input type="checkbox" name="active" value="1" /> {t("Activa", "Active")}</label>
              <button type="submit">{t("Guardar cuenta", "Save account")}</button>
              <span className="src block">{t("Aquí no se escribe ninguna clave. La clave, el secreto y el número completo de cuenta se agregan en la configuración del servidor (Render) con los tres nombres que muestra la tabla.", "No key is typed here. The key, the secret and the full account number are added in the server's settings (Render) under the three names the table shows.")}</span>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="reglas">
        <b>{t("REGLAS PARA REVISAR FACTURAS DE FLETE", "RULES FOR CHECKING FREIGHT INVOICES")}</b>
        <p className="small">{t("Peso volumétrico = largo × ancho × alto (cm) ÷ divisor. Se cobra el mayor entre el peso real y el volumétrico, redondeado hacia arriba. Una diferencia por debajo de la tolerancia es normal; entre la tolerancia y el umbral de reclamo se revisa; por encima se recomienda reclamar.", "Volumetric weight = length × width × height (cm) ÷ divisor. The larger of actual and volumetric weight is charged, rounded up. A difference below the tolerance is normal; between the tolerance and the claim threshold it is reviewed; above it a claim is recommended.")}</p>
        {sp.ok === "regla" && <div className="note okn">{t("Regla guardada. Aplica a las facturas que se registren desde ahora.", "Rule saved. It applies to invoices recorded from now on.")}</div>}
        {sp.err === "regla" && <div className="note risk">{t("Revisa los valores: divisor entre 1000 y 10000, y el umbral de reclamo no puede ser menor que la tolerancia.", "Check the values: divisor between 1000 and 10000, and the claim threshold cannot be below the tolerance.")}</div>}
        <div className="tscroll"><table>
          <thead><tr><th>{t("Transportador", "Carrier")}</th><th className="n">{t("Divisor", "Divisor")}</th><th className="n">{t("Redondeo kg", "Rounding kg")}</th><th className="n">{t("Tolerancia", "Tolerance")}</th><th className="n">{t("Reclamar sobre", "Claim above")}</th><th>{t("Estado", "Status")}</th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}>
              <td><b>{r.carrier === "DEFAULT" ? t("Cualquier otro", "Any other") : r.carrier}</b>{r.service && <span className="small"> · {r.service}</span>}<span className="src block">v{r.version}{r.updatedByName ? ` · ${r.updatedByName} · ${i.day(r.updatedAt)}` : ""}</span></td>
              <td className="n mono">{r.divisor}</td><td className="n mono">{i.n2(Number(r.roundingKg))}</td>
              <td className="n mono">{i.n2(Number(r.tolerancePct))} % · USD {i.n2(Number(r.toleranceUsd))}</td><td className="n mono">{i.n2(Number(r.claimPct))} %</td>
              <td>{r.confirmed ? <span className="sig ok">{t("Confirmada con contrato", "Confirmed with contract")}</span> : <span className="sig wait">{t("Por confirmar con el contrato", "To confirm against the contract")}</span>}{r.note && <span className="src block">{r.note}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {edit && (
          <details className="qa" style={{ marginTop: 10 }}><summary className="qa-btn">{t("Cambiar o agregar una regla", "Change or add a rule")}</summary>
            <form action={saveRatingRule} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
              <div className="qa-row">
                <label>{t("Transportador (DHL, FEDEX, UPS, DEFAULT u otro)", "Carrier (DHL, FEDEX, UPS, DEFAULT or other)")}<input name="carrier" required maxLength={40} /></label>
                <label>{t("Servicio (vacío = todos)", "Service (empty = all)")}<input name="service" maxLength={60} /></label>
              </div>
              <div className="qa-row">
                <label>{t("Divisor", "Divisor")}<input name="divisor" inputMode="numeric" required defaultValue="5000" /></label>
                <label>{t("Redondeo (kg)", "Rounding (kg)")}<input name="roundingKg" inputMode="decimal" required defaultValue="0.5" /></label>
                <label>{t("Mínimo cobrable (kg)", "Minimum chargeable (kg)")}<input name="minChargeKg" inputMode="decimal" /></label>
              </div>
              <div className="qa-row">
                <label>{t("Tolerancia %", "Tolerance %")}<input name="tolerancePct" inputMode="decimal" required defaultValue="3" /></label>
                <label>{t("Tolerancia USD", "Tolerance USD")}<input name="toleranceUsd" inputMode="decimal" required defaultValue="10" /></label>
                <label>{t("Reclamar sobre %", "Claim above %")}<input name="claimPct" inputMode="decimal" required defaultValue="10" /></label>
              </div>
              <label>{t("Nota (contrato, fecha, quién lo confirmó)", "Note (contract, date, who confirmed it)")}<input name="note" maxLength={200} /></label>
              <label className="chk"><input type="checkbox" name="confirmed" value="1" /> {t("Confirmada contra el contrato con el transportador", "Confirmed against the carrier contract")}</label>
              <button type="submit">{t("Guardar regla", "Save rule")}</button>
            </form>
          </details>
        )}
      </section>
    </>
  );
}
