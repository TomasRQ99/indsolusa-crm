import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { OutlookNote } from "@/components/OutlookNote";
import { PasswordForm } from "./PasswordForm";
import { connectOutlook, disconnectOutlook, setGuide, setTestMode, setWorkday } from "./actions";
import { canManageAll } from "@/lib/permissions";
import { db } from "@/lib/db";
import { saveProjectAlerts } from "../proyectos/actions";
import { mySignatures } from "@/lib/signatures";
import { SignatureCard } from "@/components/SignatureCard";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ cal?: string; ok?: string; err?: string }> }) {
  const { cal, ok, err } = await searchParams;
  const user = await requireUser();
  const signatures = await mySignatures(user.id);
  const pj = await db.user.findUnique({ where: { id: user.id }, select: { projectAlerts: true, projectAsks: true } });
  const i = makeI18n(user.lang);
  const { t } = i;
  return (
    <>
      <div className="ph"><div><h1>{t("Mi perfil", "My profile")}</h1><p>{user.name} · {user.email} · <span className="badge">{user.role}</span></p></div></div>
      <OutlookNote code={cal} t={t} />
      <div className="grid cols-2">
        <div className="card" id="pendientes">
          <h2>{t("Pendientes por aprobar", "Pending approvals")}</h2>
          <p className="small muted" style={{ marginBottom: 12 }}>{t("La lista de todo lo que espera una decisión tuya (autorizar una compra, aceptar la OC de un cliente, liberar una orden, aprobar un pago), cada cosa con el botón que te lleva a donde se aprueba.", "The list of everything that waits for a decision of yours (authorize a purchase, accept a customer's PO, release an order, approve a payment), each with the button that takes you to where it is approved.")}</p>
          <a className="btn" href="/profile/pendientes">{t("Ver mis pendientes por aprobar", "See my pending approvals")} →</a>
        </div>
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
          <p className="small"><a href="/profile/autorizaciones">{t("Rangos de autorización por nivel", "Authorisation ranges by level")}</a></p>
          <p className="src">{t("Comisión, reparto Comercial / Operativo y costo del dinero. Se propone un cambio y Gerencia lo aprueba.", "Commission, Commercial / Operational split and cost of money. A change is proposed and Management approves it.")}</p>
        </div>
        <div className="card" id="guia">
          <h2>{t("Guía en pantalla (entrenamiento)", "On-screen guide (training)")}</h2>
          <p className="small" style={{ marginBottom: 8 }}>
            <span className={`sig ${user.guideOn ? "ok" : "wait"}`}>{user.guideOn ? t("Encendida", "On") : t("Apagada", "Off")}</span>
          </p>
          <p className="small muted" style={{ marginBottom: 12 }}>
            {user.guideOn
              ? t("Al escribir lo que necesitas en la barra de búsqueda, SOLU te ofrece una guía paso a paso y marca en la pantalla dónde hacer clic. Cuando ya conozcas SOLU puedes apagarla: la búsqueda de registros sigue igual.", "When you type what you need in the search bar, SOLU offers a step-by-step guide and marks on screen where to click. Once you know SOLU you can turn it off: record search stays the same.")
              : t("La barra de búsqueda solo busca registros y no aparecen guías ni marcas en pantalla. Puedes encenderla de nuevo cuando quieras.", "The search bar only searches records, and no guides or marks appear on screen. You can turn it back on any time.")}
          </p>
          <form action={setGuide}>
            <input type="hidden" name="on" value={user.guideOn ? "0" : "1"} />
            <button type="submit" className={user.guideOn ? "secondary sm" : "sm"}>{user.guideOn ? t("Apagar la guía de entrenamiento", "Turn off the training guide") : t("Encender la guía de entrenamiento", "Turn on the training guide")}</button>
          </form>
          <p className="src" style={{ marginTop: 8 }}>{t("Solo cambia para ti. No se usa para medir a nadie.", "It only changes for you. It is never used to measure anyone.")}</p>
        </div>
        <div className="card" id="modo-prueba">
          <h2>{t("Modo prueba", "Test mode")}</h2>
          <p className="small" style={{ marginBottom: 8 }}>
            <span className={`sig ${user.testMode ? "wait" : "ok"}`}>{user.testMode ? t("Activado: ves la información de prueba", "On: you see the test information") : t("Desactivado: solo ves información real", "Off: you only see real information")}</span>
            {ok === "modo-prueba" && <> <span className="sig ok">{t("Guardado", "Saved")}</span></>}
          </p>
          <p className="small muted" style={{ marginBottom: 12 }}>
            {user.testMode
              ? t("En las listas, los conteos y los totales aparecen los datos de ejemplo de SOLU, que dicen «(ejemplo)», y los clientes y proveedores marcados como prueba, con sus Necesidades, cotizaciones, pedidos, facturas, pagos y tareas. Desactívalo para trabajar solo con información real. No se borra nada: puedes activarlo de nuevo cuando quieras.", "Lists, counts and totals include SOLU's sample data, marked “(ejemplo)”, and the customers and suppliers marked as test, with their Needs, quotes, orders, invoices, payments and tasks. Turn it off to work with real information only. Nothing is deleted: you can turn it back on any time.")
              : t("Las listas, los conteos y los totales dejan por fuera los datos de ejemplo y los clientes y proveedores marcados como prueba, con todo lo que cuelga de ellos. Nada se borró: al activarlo vuelven tal como estaban.", "Lists, counts and totals leave out the sample data and the customers and suppliers marked as test, with everything that hangs from them. Nothing was deleted: turn it on and they come back exactly as they were.")}
          </p>
          <form action={setTestMode}>
            <input type="hidden" name="on" value={user.testMode ? "0" : "1"} />
            <button type="submit" className={user.testMode ? "sm" : "secondary sm"}>{user.testMode ? t("Desactivar modo prueba", "Turn off test mode") : t("Activar modo prueba", "Turn on test mode")}</button>
          </form>
          {canManageAll(user) && <p className="small" style={{ marginTop: 12 }}><a href="/profile/modo-prueba">{t("Elegir qué clientes y proveedores son de prueba", "Choose which customers and suppliers are test")} →</a></p>}
          <p className="src" style={{ marginTop: 8 }}>{t("Solo cambia para ti: cada persona lo decide en su perfil. Un registro de prueba que abras por su enlace directo se sigue abriendo.", "It only changes for you: each person decides it in their profile. A test record you open by its direct link still opens.")}</p>
        </div>
        <SignatureCard lang={user.lang === "EN" ? "EN" : "ES"} list={signatures} ok={ok} err={err} />
        <div className="card" id="avisos-proyectos">
          <h2>{t("Avisos de mis proyectos", "Notices from my projects")}</h2>
          {ok === "avisos-proyectos" && <p className="small"><span className="sig ok">{t("Guardado", "Saved")}</span></p>}
          <p className="small muted" style={{ marginBottom: 10 }}>{t("Las alarmas que tú pones siempre te llegan. Aquí eliges lo que SOLU te avisa por su cuenta, en la campana y en Mi Día. Nunca por correo.", "The alarms you set always reach you. Here you choose what SOLU tells you on its own, on the bell and in My Day. Never by email.")}</p>
          <form action={saveProjectAlerts} className="qa-form">
            <label style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="projectAlerts" value="1" defaultChecked={pj?.projectAlerts !== false} style={{ marginTop: 3 }} /> <span>{t("Un resumen de mis fechas de hoy y mañana, de lo mío que está atrasado y de la etapa atrasada en los proyectos que llevo", "A summary of my dates for today and tomorrow, of what is mine and overdue, and of a late stage in the projects I lead")}</span></label>
            <label style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="projectAsks" value="1" defaultChecked={pj?.projectAsks !== false} style={{ marginTop: 3 }} /> <span>{t("Cuando alguien me pide el avance de una tarea o una fecha", "When someone asks me how a task or a date is going")}</span></label>
            <button type="submit" className="sm" style={{ alignSelf: "flex-start" }}>{t("Guardar mis avisos", "Save my notices")}</button>
          </form>
          <p className="src" style={{ marginTop: 8 }}>{t("Siempre te llegan: una invitación, una asignación de Gerencia, una mención con @ y el aviso de que un proyecto que llevas se quedó sin movimiento. Aunque apagues los avisos, todo sigue visible dentro de cada proyecto.", "You always get: an invitation, an assignment by Management, an @ mention and the notice that a project you lead has stopped moving. Even with notices off, everything stays visible inside each project.")}</p>
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
