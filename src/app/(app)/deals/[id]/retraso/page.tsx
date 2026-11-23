import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canEdit, canManageAll } from "@/lib/permissions";
import { mailConfig } from "@/lib/mail";
import { aiConfigured } from "@/lib/ai";
import { delayCase, getDelayTags } from "@/lib/delay";
import { DelayDesk } from "./DelayDesk";

// AVISO DE RETRASO: one late delivery, handled in one place. What the record says, what caused the delay, the new
// date and the email to the customer. Reached from the Resumen del día (and from its case-by-case walk).

export default async function DelayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; msg?: string }> }) {
  const [{ id }, sp, user] = await Promise.all([params, searchParams, requireUser()]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const [c, tags] = await Promise.all([delayCase(id, i), getDelayTags()]);
  if (!c) notFound();
  const mine = canEdit(user, c.ownerId);
  const cfg = mailConfig();
  const mailOn = cfg.configured || process.env.MAIL_DRY_RUN === "1";

  const okMsg: Record<string, string> = {
    enviado: t("Listo: el correo salió al cliente y la nueva fecha quedó guardada con su causa.", "Done: the email went to the customer and the new date is saved with its cause."),
    guardado: t("Listo: la nueva fecha quedó guardada con su causa. No se envió ningún correo.", "Done: the new date is saved with its cause. No email was sent."),
    incierto: t("La nueva fecha quedó guardada. El envío del correo no se pudo confirmar: SOLU lo revisa en los próximos minutos en «Respuestas a nuestros correos»; conviene no reenviarlo todavía.", "The new date is saved. The email could not be confirmed as sent: SOLU checks it in the next minutes under “Replies to our emails”; it is better not to resend it yet."),
  };
  const errMsg: Record<string, string> = {
    causa: t("Elige qué causó el retraso. No se guardó ni se envió nada.", "Pick what caused the delay. Nothing was saved or sent."),
    fecha: t("Elige la nueva fecha de entrega, de hoy en adelante. No se guardó ni se envió nada.", "Pick the new delivery date, from today onwards. Nothing was saved or sent."),
    destino: t("Revisa el correo del cliente en «Para» y en «Copia». No se guardó ni se envió nada.", "Check the customer's email in “To” and “Copy”. Nothing was saved or sent."),
    asunto: t("Falta el asunto del correo. No se guardó ni se envió nada.", "The email subject is missing. Nothing was saved or sent."),
    texto: t("Falta el texto del correo. No se guardó ni se envió nada.", "The email text is missing. Nothing was saved or sent."),
    enlace: t("El texto tiene un enlace acortado o con números en lugar de nombre; cámbialo por el enlace completo. No se envió nada.", "The text has a shortened link or one with numbers instead of a name; replace it with the full link. Nothing was sent."),
    correo: t("El correo de la empresa no está conectado en este servidor. No se envió nada.", "The company mailbox is not connected on this server. Nothing was sent."),
    envio: t(`El correo no salió${sp.msg ? `: ${sp.msg}` : ""}. La fecha no se cambió; puedes intentarlo otra vez.`, `The email did not go out${sp.msg ? `: ${sp.msg}` : ""}. The date was not changed; you can try again.`),
  };
  const toneSig = { risk: "risk", attn: "attn", info: "info", ok: "ok" } as const;

  return (
    <div className="rt">
      <div className="ph">
        <div>
          <h1>{t("Aviso de retraso", "Delay notice")}</h1>
          <p><b>{c.code}</b> · {c.customer} · {c.title}{c.customerPo ? ` · ${t("OC del cliente", "customer PO")} ${c.customerPo}` : ""}</p>
        </div>
        <Link className="btn secondary" href={`/deals/${c.id}`}>{t("Abrir la Necesidad completa", "Open the full Need")}</Link>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className={`note ${sp.ok === "incierto" ? "attn" : "okn"}`} role="status">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk" role="alert">{errMsg[sp.err]}</div>}

      <section className="card" id="situacion">
        <b>{t("SITUACIÓN DEL PEDIDO", "STATE OF THE ORDER")}</b>
        <p>{c.late ? <span className="sig risk">{t(`${c.daysLate} ${c.daysLate === 1 ? "día" : "días"} después de la fecha prometida`, `${c.daysLate} day(s) past the promised date`)}</span> : <span className="sig ok">{t("Sin retraso frente a la fecha prometida", "Not late against the promised date")}</span>}</p>
        <ul className="rt-facts">{c.facts.map((f, k) => <li key={k}><span className={`sig ${toneSig[f.tone]}`} aria-hidden>●</span>{f.text}</li>)}</ul>
        <p className="src">{t("Hechos tomados del pedido, de sus órdenes al proveedor y de sus seguimientos.", "Facts taken from the order, its supplier orders and its follow-ups.")}</p>
      </section>

      {!c.late ? (
        <section className="card">
          <p><span className="sig ok">{t("Nada que avisar", "Nothing to notify")}</span> {c.won ? t("Este pedido no tiene una entrega atrasada en este momento.", "This order has no late delivery right now.") : t("Esta Necesidad todavía no es un pedido aceptado, así que no tiene una fecha de entrega prometida que avisar.", "This Need is not an accepted order yet, so it has no promised delivery date to notify.")}</p>
          <p><Link href={`/deals/${c.id}`}>{t("Abrir la Necesidad", "Open the Need")}</Link></p>
        </section>
      ) : !mine ? (
        <section className="card">
          <p><span className="sig wait">{t("Solo lectura", "Read only")}</span> {t(`El aviso al cliente lo hace quien lleva este pedido (${c.ownerName}), o Gerencia.`, `The notice to the customer is made by whoever carries this order (${c.ownerName}), or Management.`)}</p>
        </section>
      ) : (
        <DelayDesk
          ui={user.lang} dealId={c.id} tags={tags.value.filter((x) => x.active)} code={c.code} title={c.title} customerPo={c.customerPo} promised={c.promised}
          suggest={c.suggest} minDate={c.minDate} mailLang={c.lang} contact={c.contact} others={c.others} sender={user.name} from={cfg.from ?? "sales@indsolusa.com"}
          aiOn={aiConfigured()} mailOn={mailOn} idem={randomUUID()} failed={!!sp.err}
        />
      )}
      {c.late && mine && (
        <p className="src rt-conf">{t("Las causas de esta lista las define la administración. ", "The causes in this list are defined by the administration. ")}{(canManageAll(user) || user.role === "ADMINISTRACION") && <Link href="/administracion/causas-retraso">{t("Configurar las causas de retraso", "Set up the delay causes")}</Link>}</p>
      )}
    </div>
  );
}
