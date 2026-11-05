import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { demoLoaded } from "@/lib/demo";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { TestEmailButton } from "@/components/TestEmailButton";
import { mailConfig } from "@/lib/mail";
import { createUser, loadDemoData, removeDemoData, setUserRole, toggleUserActive } from "./actions";

export default async function UsersPage() {
  const admin = await requireRole("ADMIN");
  const i = makeI18n(admin.lang);
  const { t } = i;
  const [users, demo] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } }),
    demoLoaded(),
  ]);
  const mail = mailConfig();
  const roleOptions = (
    <>
      <option value="REP">{t("Comercial", "Rep")}</option>
      <option value="MANAGER">{t("Gerencia", "Manager")}</option>
      <option value="ADMIN">{t("Administración", "Admin")}</option>
    </>
  );

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
              <p className="small" style={{ marginBottom: 10 }}>{t("Carga clientes, Journeys, remisiones, facturas, pagos y comisiones de ejemplo para ver cada pantalla funcionando. Todo queda marcado \"(ejemplo)\".", "Load sample customers, Journeys, delivery notes, invoices, payments and commissions to see every screen working. Everything is marked \"(ejemplo)\".")}</p>
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
          <label>{t("Rol", "Role")}<select name="role" defaultValue="REP">{roleOptions}</select></label>
          <button type="submit">{t("Crear usuario", "Create user")}</button>
        </form>
        <p className="src" style={{ marginTop: 6 }}>{t("Comercial edita lo suyo. Gerencia edita todo y aprueba pagos, cupos y comisiones. Administración además gestiona usuarios.", "Reps edit their own records. Managers edit everything and approve payments, credit and commissions. Admins also manage users.")}</p>
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
                  <td>{self ? <span className="badge">{u.role}</span> : (
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
