import { Fragment } from "react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { demoLoaded } from "@/lib/demo";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { TestEmailButton } from "@/components/TestEmailButton";
import { mailConfig } from "@/lib/mail";
import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import { createUser, loadDemoData, removeDemoData, setUserRole, toggleUserActive } from "./actions";

export default async function UsersPage() {
  const admin = await requireRole("GERENCIA");
  const i = makeI18n(admin.lang);
  const { t } = i;
  const [users, demo] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } }),
    demoLoaded(),
  ]);
  const mail = mailConfig();
  const roleOptions = <>{ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</option>)}</>;
  const roleHelp: Record<string, [string, string]> = {
    NEGOCIADOR_COMERCIAL: ["Edita las Necesidades que lleva.", "Edits the Necessities they own."],
    NEGOCIADOR_OPERATIVO: ["Lo suyo, más compras, envíos, remisiones y solicitudes a proveedores de cualquier Necesidad. No cambia la cotización al cliente.", "Their own, plus purchasing, shipments, delivery notes and supplier RFQs on any Necessity. Doesn't change the customer quote."],
    FINANZAS: ["Facturas, cobros, caja, verificación bancaria, ejecución y conciliación de pagos, pago de comisiones. Aprueba pagos a proveedores hasta USD 25.000. Decide cupos, plazos y excepciones de crédito.", "Invoices, collections, cash, bank verification, payment execution and reconciliation, commission payouts. Approves supplier payments up to USD 25,000. Decides credit limits, terms and exceptions."],
    ADMINISTRACION: ["Lo mismo que Finanzas por ahora, y aprueba compras junto con Finanzas hasta el límite que fije Gerencia.", "The same as Finance for now, and approves purchases with Finance up to the limit Management sets."],
    JUNTA: ["Solo lectura: abre la Vista de Junta, la identidad, las funciones y su propio perfil. No ve personas, comisiones ni fichas de clientes, y no puede guardar nada.", "Read-only: opens the Board view, the identity, the functions and their own profile. Sees no people, commissions or customer records, and can save nothing."],
    MARKETING: ["Como Negociador Comercial, y además carga datos de mercado.", "Like a Commercial Negotiator, plus loads market data."],
    DIRECTOR_COMERCIAL: ["Edita todo; aprueba pagos hasta USD 25.000 y excepciones de Eságara; ve y apoya solicitudes de cupo (no las decide); ve Insights.", "Edits everything; approves payments up to USD 25,000 and Eságara exceptions; sees and supports credit requests (doesn't decide them); sees Insights."],
    GERENCIA: ["Todo lo anterior, sin límite de pagos, y además personas, datos y política de comisiones.", "All of the above, with no payment limit, plus people, data and commission policy."],
  };

  return (
    <>
      <div className="ph"><div><div className="crumb">{t("Equipo", "Team")}</div><h1>{t("Usuarios y datos", "Users & data")}</h1></div></div>

      <div className="grid cols-2">
        <div className="card">
          <h2>{t("Datos de ejemplo", "Sample data")}</h2>
          {demo ? (
            <>
              <p className="small" style={{ marginBottom: 10 }}>{t("Los datos de ejemplo están cargados. Todo lo marcado \"(ejemplo)\" se puede quitar con un clic sin tocar tus datos reales.", "Sample data is loaded. Everything marked \"(ejemplo)\" can be removed in one click without touching your real data.")}</p>
              <form action={removeDemoData}><button className="danger" type="submit">{t("Quitar datos de ejemplo", "Remove sample data")}</button></form>
            </>
          ) : (
            <>
              <p className="small" style={{ marginBottom: 10 }}>{t("Carga clientes, Necesidades, remisiones, facturas, pagos y comisiones de ejemplo para ver cada pantalla funcionando. Todo queda marcado \"(ejemplo)\".", "Load sample customers, Necessities, delivery notes, invoices, payments and commissions to see every screen working. Everything is marked \"(ejemplo)\".")}</p>
              <form action={loadDemoData}><button type="submit">{t("Cargar datos de ejemplo", "Load sample data")}</button></form>
            </>
          )}
        </div>
        <div className="card">
          <h2>{t("Envío de correo", "Email delivery")}</h2>
          {mail.configured ? <p className="small">{t("Enviando como", "Sending as")} <b>{mail.from}</b> · {mail.description}.</p> : <p className="error">{t("No configurado.", "Not configured.")}</p>}
          {mail.configured && <TestEmailButton es={i.es} />}
        </div>
      </div>

      <div className="card">
        <h2>{t("Invitar usuario", "Invite user")}</h2>
        <form action={createUser} className="inline">
          <label>{t("Nombre", "Name")}<input name="name" required /></label>
          <label>{t("Correo", "Email")}<input name="email" type="email" required /></label>
          <label>{t("Contraseña temporal", "Temporary password")}<input name="password" type="password" minLength={10} required /></label>
          <label>{t("Rol", "Role")}<select name="role" defaultValue="NEGOCIADOR_COMERCIAL">{roleOptions}</select></label>
          <button type="submit">{t("Crear usuario", "Create user")}</button>
        </form>
        <dl className="qv-dl" style={{ marginTop: 10 }}>
          {ROLES.map((r) => <Fragment key={r}><dt>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</dt><dd className="small">{t(...roleHelp[r])}</dd></Fragment>)}
        </dl>
        <p className="src" style={{ marginTop: 6 }}>{t("Todos pueden ver todos los registros.", "Everyone can see all records.")}</p>
      </div>

      <div className="card flush">
        <table>
          <thead><tr><th>{t("Nombre", "Name")}</th><th>{t("Correo", "Email")}</th><th>{t("Rol", "Role")}</th><th>{t("Estado", "Status")}</th><th>{t("Creado", "Created")}</th><th /></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === admin.id;
              return (
                <tr key={u.id} className={u.active ? undefined : "muted"}>
                  <td><b>{u.name}</b>{self && t(" (tú)", " (you)")}</td>
                  <td>{u.email}</td>
                  <td>{self ? <span className="badge">{t(ROLE_LABEL[u.role].es, ROLE_LABEL[u.role].en)}</span> : (
                    <form action={setUserRole.bind(null, u.id)}><AutoSubmitSelect name="role" defaultValue={u.role} aria-label={t(`Rol de ${u.name}`, `Role for ${u.name}`)}>{roleOptions}</AutoSubmitSelect></form>
                  )}</td>
                  <td>{u.active ? t("Activo", "Active") : t("Desactivado", "Deactivated")}</td>
                  <td>{i.date(u.createdAt)}</td>
                  <td>{!self && <form action={toggleUserActive.bind(null, u.id)}><button className={u.active ? "danger sm" : "secondary sm"} type="submit">{u.active ? t("Desactivar", "Deactivate") : t("Reactivar", "Reactivate")}</button></form>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
