import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { OutlookNote } from "@/components/OutlookNote";
import { PasswordForm } from "./PasswordForm";
import { connectOutlook, disconnectOutlook, setWorkday } from "./actions";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ cal?: string }> }) {
  const { cal } = await searchParams;
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  return (
    <>
      <div className="ph"><div><h1>{t("Mi perfil", "My profile")}</h1><p>{user.name} · {user.email} · <span className="badge">{user.role}</span></p></div></div>
      <OutlookNote code={cal} t={t} />
      <div className="grid cols-2">
        <div className="card" id="outlook">
          <h2>{t("Calendario de Outlook", "Outlook calendar")}</h2>
          {user.outlookConnectedAt ? (
            <>
              <p className="small" style={{ marginBottom: 10 }}>
                <span className="sig ok">{t("Conectado", "Connected")}</span>{" "}
                {t(`Buzón ${user.email} · desde el ${i.date(user.outlookConnectedAt)}`, `Mailbox ${user.email} · since ${i.date(user.outlookConnectedAt)}`)}
              </p>
              <ul className="small muted" style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                <li>{t("Mi Día lee tu agenda para decirte cuándo tienes reunión con un cliente.", "My Day reads your calendar to tell you when you meet a customer.")}</li>
                <li>{t("«Agendar en Outlook» pone el siguiente movimiento en tu primer espacio libre.", "\"Schedule in Outlook\" puts the next move in your first free slot.")}</li>
                <li>{t("Mi Plan puede enviar tus bloques reservados a tu calendario.", "My Plan can send your reserved blocks to your calendar.")}</li>
              </ul>
              <form action={disconnectOutlook}><button type="submit" className="secondary sm">{t("Desconectar", "Disconnect")}</button></form>
            </>
          ) : (
            <>
              <p className="small muted" style={{ marginBottom: 12 }}>
                {t(
                  `Conecta el calendario de tu propio buzón (${user.email}). SOLU solo puede usar el calendario del correo con el que ingresas, nunca el de otra persona.`,
                  `Connect the calendar of your own mailbox (${user.email}). SOLU can only use the calendar of the email you sign in with, never someone else's.`,
                )}
              </p>
              <form action={connectOutlook}><button type="submit">{t("Conectar mi calendario", "Connect my calendar")}</button></form>
            </>
          )}
        </div>
        <div className="card" id="configuracion">
          <h2>{t("Configuración", "Settings")}</h2>
          <p className="small"><a href="/profile/rentabilidad">{t("Modificar números de Rentabilidad", "Change profitability numbers")}</a></p>
          <p className="src">{t("Comisión, reparto Comercial / Operativo y costo del dinero. Se propone un cambio y Gerencia lo aprueba.", "Commission, Commercial / Operational split and cost of money. A change is proposed and Management approves it.")}</p>
        </div>
        <div className="card">
          <h2>{t("Mi jornada", "My working day")}</h2>
          <p className="small muted" style={{ marginBottom: 10 }}>{t("Mi Plan y Outlook usan este dato para saber cuánto cabe en cada día (desde las 08:00). No se usa para medir a nadie.", "My Plan and Outlook use this to know how much fits in each day (from 08:00). It is never used to measure anyone.")}</p>
          <form action={setWorkday} className="inline">
            <label>{t("Horas por día", "Hours per day")}<input name="hours" type="number" min="1" max="14" step="0.5" defaultValue={user.workdayMinutes / 60} /></label>
            <button type="submit">{t("Guardar", "Save")}</button>
          </form>
        </div>
        <div className="card">
          <h2>{t("Cambiar contraseña", "Change password")}</h2>
          <PasswordForm es={i.es} />
        </div>
      </div>
    </>
  );
}
