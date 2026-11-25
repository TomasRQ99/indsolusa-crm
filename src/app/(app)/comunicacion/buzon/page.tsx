import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { aiConfigured } from "@/lib/ai";
import { boxAddress, boxKey, MailboxError, readList, type BoxKey, type Folder, type MailRow } from "@/lib/mailbox";
import { imapAllowed, imapBox } from "@/lib/mailbox-imap";

// Correos del buzón: pick one email, received or sent, from your own mailbox or the company's, and build a Need from
// it with AI. Only reads; nothing is stored until the person creates the Need.

export default async function MailboxPage({ searchParams }: { searchParams: Promise<{ box?: string; f?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser()]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const mine2 = imapAllowed(user);
  const x = imapBox();
  const box: BoxKey = boxKey(sp.box) === "externo" && !mine2 ? "mio" : boxKey(sp.box);
  const folder: Folder = sp.f === "in" ? "in" : "out";
  const address = boxAddress(box, user);
  const aiOn = aiConfigured();
  let rows: MailRow[] = [];
  let err: MailboxError["code"] | null = null;
  let detail = "";
  if (!address && box !== "externo") err = "NOT_CONFIGURED";
  else try { rows = await readList(box, folder, user); } catch (e) { err = e instanceof MailboxError ? e.code : "OTHER"; detail = e instanceof Error && e.message !== err ? e.message.slice(0, 160) : ""; }
  const errs: Record<string, string> = {
    NOT_CONFIGURED: t("El correo de la empresa (Microsoft) no está configurado en este servidor.", "Company email (Microsoft) isn't configured on this server."),
    DENIED: t("Microsoft no dio permiso para leer este buzón. En Microsoft Entra, la app de SOLU necesita el permiso de aplicación Mail.Read con «Grant admin consent», y el buzón no debe estar excluido.", "Microsoft denied reading this mailbox. In Microsoft Entra, SOLU's app needs the Mail.Read application permission with “Grant admin consent”, and the mailbox must not be excluded."),
    NO_MAILBOX: t(`Microsoft no encontró el buzón ${address ?? ""}. SOLU solo puede leer buzones de la misma cuenta de Microsoft 365 que el correo de la empresa. Si tu correo es otro, cámbialo en EQUIPO → Configuración → Mi perfil.`, `Microsoft did not find the mailbox ${address ?? ""}. SOLU can only read mailboxes of the same Microsoft 365 account as the company email. If your email is a different one, change it in TEAM → Settings → My profile.`),
    OTHER: t("No se pudo leer el buzón: ", "Couldn't read the mailbox: ") + detail,
    X_SETUP: t(`Al buzón ${x.address || "conectado"} le faltan datos en Render: ${x.missing.join(", ")}. Gerencia los pega en Render → Environment y guarda con «Save, rebuild, and deploy».`, `The mailbox ${x.address || "connected"} is missing data in Render: ${x.missing.join(", ")}. Management pastes them in Render → Environment and saves with “Save, rebuild, and deploy”.`),
    X_AUTH: t("El servidor del correo no aceptó el usuario o la contraseña. Revisa en Render MAILBOX2_PASSWORD (y MAILBOX2_USER si el usuario no es el correo completo). Si cambiaste la contraseña del buzón, hay que cambiarla también en Render.", "The mail server did not accept the user or the password. Check MAILBOX2_PASSWORD in Render (and MAILBOX2_USER if the user is not the full address). If you changed the mailbox password, change it in Render too."),
    X_FOLDER: t("SOLU no encontró la carpeta de enviados de este buzón. Escribe su nombre exacto en Render, en MAILBOX2_SENT_FOLDER. Carpetas que tiene el buzón: ", "SOLU did not find this mailbox's sent folder. Type its exact name in Render, in MAILBOX2_SENT_FOLDER. Folders the mailbox has: ") + detail,
    X_OWNER: t("Ese buzón solo lo abre su dueño.", "Only its owner opens that mailbox."),
  };
  const href = (b: BoxKey, f: Folder) => `/comunicacion/buzon?box=${b}&f=${f}`;
  const when = (d: Date) => `${i.dateShort(d)} ${new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" }).format(d)}`;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/comunicacion">{t("Mi día · Comunicación", "My day · Communication")}</Link></div>
          <h1>{t("Correos del buzón", "Mailbox emails")}</h1>
          <p>{t("Elige un correo, enviado o recibido, y SOLU arma la Necesidad con IA a partir de su texto. Aquí solo se lee: no se mueve, no se marca y no se guarda ningún correo.", "Pick an email, sent or received, and SOLU builds the Need with AI from its text. This only reads: no email is moved, marked or stored.")}</p>
        </div>
      </div>
      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("1 · QUÉ BUZÓN", "1 · WHICH MAILBOX")}</b><span className="grow" /><span className="src">{address ?? (box === "externo" ? x.address : "") ?? "—"}</span></div>
        <div className="mb-pick">
          <Link className={`chip${box === "mio" ? " on" : ""}`} href={href("mio", folder)}>{t("Mi buzón", "My mailbox")}</Link>
          <Link className={`chip${box === "empresa" ? " on" : ""}`} href={href("empresa", folder)}>{t("Buzón de la empresa", "Company mailbox")}</Link>
          {mine2 && <Link className={`chip${box === "externo" ? " on" : ""}`} href={href("externo", folder)}>{x.address || t("Mi otro buzón", "My other mailbox")}</Link>}
          <span className="mb-sep" />
          <Link className={`chip${folder === "out" ? " on" : ""}`} href={href(box, "out")}>{t("Enviados", "Sent")}</Link>
          <Link className={`chip${folder === "in" ? " on" : ""}`} href={href(box, "in")}>{t("Recibidos", "Received")}</Link>
        </div>
        <span className="src">{t("«Mi buzón» es el correo con el que entras a SOLU. Nadie puede abrir aquí el buzón de otra persona.", "“My mailbox” is the email you log in to SOLU with. Nobody can open another person's mailbox here.")}{mine2 ? t(` El buzón ${x.address} está conectado solo para ti; los demás no lo ven.`, ` The mailbox ${x.address} is connected for you only; nobody else sees it.`) : ""}</span>
      </section>
      {err && <p className="note risk" role="alert">{errs[err]}</p>}
      {!aiOn && <p className="note attn">{t("La IA no está conectada: puedes ver los correos, pero no armar la Necesidad desde aquí.", "AI is not connected: you can see the emails, but not build the Need from here.")}</p>}
      {!err && (
        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("2 · ELIGE EL CORREO", "2 · PICK THE EMAIL")}</b><span className="grow" /><span className="src">{t(`los ${rows.length} más recientes`, `the ${rows.length} most recent`)}</span></div>
          {rows.length === 0 ? <p className="quiet-p">{t("No hay correos en esta carpeta.", "There are no emails in this folder.")}</p> : (
            <ul className="rp-list">{rows.map((m) => (
              <li key={m.id}>
                <span><b>{m.subject}</b><span className="src block">{folder === "out" ? t("Para", "To") : t("De", "From")} {(folder === "out" ? m.to : m.from) || "—"} · {when(m.at)}</span>{m.preview ? <span className="src block">{m.preview}</span> : null}</span>
                {aiOn && <Link className="btn secondary ai-need-btn mb-go" href={`/deals?${new URLSearchParams({ mail: m.id, box, f: folder })}`}><span aria-hidden>✦</span> {t("Crear Necesidad con IA", "Create Need with AI")}</Link>}
              </li>
            ))}</ul>
          )}
        </section>
      )}
    </>
  );
}
