import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { getSellers } from "@/lib/sellers";
import { adapters } from "@/lib/carriers/gateway";
import { DHL_KEY, dhlCredentialStatus } from "@/lib/carriers/dhl";
import { saveCarrierAccount } from "./actions";

// Operaciones O5b · carriers: which accounts exist, which company owns each, and whether its credentials are in
// place on the server. Presence only: a credential is never shown, stored in the database or typed on this screen.

export default async function CarriersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const edit = isGerencia(user);
  const [accounts, sellers, attempts] = await Promise.all([
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
    </>
  );
}
