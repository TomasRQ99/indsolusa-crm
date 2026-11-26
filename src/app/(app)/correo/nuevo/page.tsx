import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { mailConfig } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { TEMPLATES, type TemplateKey } from "@/lib/email-templates";
import { saveInternal, sendComposed } from "../actions";
import MailBodyHints from "@/components/MailBodyHints";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai";
import { draftWithAi, rewriteWithAi } from "../ai-actions";
import { REWRITE_PRESETS } from "@/lib/mail-ai";
import { imapAllowed, imapBox } from "@/lib/mailbox-imap";

export default async function ComposeMail({ searchParams }: { searchParams: Promise<{ tpl?: string; id?: string; lang?: string; err?: string; msg?: string; borrador?: string; ok?: string; to?: string; cc?: string; bcc?: string }> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const sp = await searchParams;
  const tpl = (sp.tpl ?? "") as TemplateKey;
  const cfg = mailConfig();
  const from = cfg.from ?? "sales@indsolusa.com";
  const c = tpl in TEMPLATES && tpl !== "RFQ" && sp.id ? await composeFrom({ tpl, id: sp.id, lang: sp.lang === "ES" || sp.lang === "EN" ? sp.lang : null }, user, from) : null;
  if (!c) {
    return <div className="card"><p>{t("No se encontró el registro para este correo.", "The record for this email wasn't found.")} <Link href="/">{t("Volver", "Back")}</Link></p></div>;
  }
  const meta = TEMPLATES[tpl];
  // A draft written with AI for this same Need opens in the text box; the person reads and edits it before sending.
  const aiKind = tpl === "PROGRESS" || tpl === "OFFER";
  const draft = sp.borrador && c.dealId ? await db.aiDraft.findFirst({ where: { id: sp.borrador.slice(0, 40), dealId: c.dealId, kind: tpl }, select: { subject: true, body: true, createdByName: true } }) : null;
  const aiOn = aiConfigured();
  const ownBox = imapAllowed(user) && imapBox().ready ? imapBox().address : null;
  const other = c.lang === "EN" ? "ES" : "EN";
  const langHref = `/correo/nuevo?${new URLSearchParams({ tpl, id: sp.id!, lang: other })}`;
  const errs: Record<string, string> = {
    correo: t("El correo de la empresa no está configurado.", "Company email isn't configured."),
    permiso: t("Solo el responsable de la Necesidad (o un administrador) puede enviar este correo.", "Only the Need owner (or an admin) can send this email."),
    destino: t("Revisa los correos: falta el destinatario principal o alguno está mal escrito. Varios correos van separados por coma.", "Check the addresses: the main recipient is missing or one is mistyped. Several addresses are separated by commas."),
    asunto: t("Escribe el asunto.", "Enter the subject."),
    texto: t("El mensaje está vacío.", "The message is empty."),
    adjuntos: t("No se envió: los archivos marcados pesan más de 3 MB en total, y el buzón no los acepta. Desmarca alguno.", "Not sent: the ticked files weigh more than 3 MB in total and the mailbox won't accept them. Untick some."),
    envio: t("No se pudo enviar: ", "Couldn't send: ") + (sp.msg ?? ""),
    "ia-prompt": t("Escribe qué quieres cambiar del correo, o usa uno de los botones.", "Type what you want changed in the email, or use one of the buttons."),
    "ia-off": t("La IA no está conectada todavía. Puedes enviar el texto de abajo, que ya trae los datos de la Necesidad.", "AI is not connected yet. You can send the text below, which already carries the Need's data."),
    "ia-tope": t("La IA llegó al tope de gasto de este mes. Puedes enviar el texto de abajo.", "AI reached this month's spending cap. You can send the text below."),
    "ia-fallo": t("La IA no pudo redactar el correo esta vez. Intenta de nuevo, o usa el texto de abajo.", "AI could not draft the email this time. Try again, or use the text below."),
    enlace: t("No se envió: el texto tiene un enlace acortado o a una dirección IP, y los filtros de spam suelen bloquearlos. Usa el enlace completo: ", "Not sent: the text has a shortened link or a link to an IP address, which spam filters often block. Use the full link: ") + (sp.msg ?? ""),
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href={c.back}>{c.about}</Link></div>
          <h1>{t(meta.es, meta.en)}</h1>
          <p>{t(meta.help.es, meta.help.en)} {t(`Sale desde ${from}.`, `Sent from ${from}.`)}</p>
        </div>
      </div>
      {sp.err && errs[sp.err] && <p className="note attn">{errs[sp.err]}</p>}
      {c.warn && <p className="note attn">{c.warn}</p>}
      {!c.canSend && !c.warn && <p className="note attn">{errs.permiso}</p>}

      {aiKind && (
        <section className="jblock loc-sec" id="ia">
          <div className="jbh"><b>{t("REDACTAR CON IA", "DRAFT WITH AI")}</b><span className="grow" />{draft ? <span className="sig ok">{t("Borrador de IA cargado abajo", "AI draft loaded below")}</span> : aiOn ? <span className="sig info">{t("Disponible", "Available")}</span> : <span className="sig wait">{t("IA sin conectar", "AI not connected")}</span>}</div>
          {aiOn ? (
            <form action={draftWithAi} className="qa-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="tpl" value={tpl} /><input type="hidden" name="id" value={sp.id} /><input type="hidden" name="lang" value={c.lang} />
              <button type="submit" className="secondary" disabled={!c.canSend} style={{ flex: "0 0 auto" }}>{draft ? t("Redactar otra versión con IA", "Draft another version with AI") : t("Redactar con IA", "Draft with AI")}</button>
              <span className="src" style={{ flex: "1 1 320px" }}>{t("Escribe un correo personalizado con lo que SOLU sabe de esta Necesidad: qué pidió el cliente, qué quiere lograr, la pieza, el plazo y lo que sigue. Nunca nombra al proveedor ni menciona costos. No envía nada: tú lo lees, lo cambias y lo envías.", "It writes a personalised email from what SOLU knows about this Need: what the customer asked for, what they want to achieve, the piece, the lead time and what comes next. It never names the supplier or mentions costs. It sends nothing: you read it, change it and send it.")}</span>
            </form>
          ) : (
            <p className="src">{t("Cuando se conecte la IA, aquí aparecerá el botón «Redactar con IA». Mientras tanto, el texto de abajo ya viene escrito con los datos de la Necesidad y lo puedes editar.", "Once AI is connected, the “Draft with AI” button will appear here. Meanwhile, the text below is already written from the Need's data and you can edit it.")}</p>
          )}
          {draft && <p className="note attn" style={{ marginBottom: 0 }}>{t(`Borrador escrito por IA a pedido de ${draft.createdByName}. Léelo completo antes de enviar: revisa precios, fechas y nombres.`, `Draft written by AI at ${draft.createdByName}'s request. Read all of it before sending: check prices, dates and names.`)}</p>}
        </section>
      )}

      {sp.ok === "reescrito" && draft && <p className="note okn" role="status">{t("La IA reescribió el correo: el texto nuevo está en «MENSAJE». Léelo antes de enviar; puedes pedirle otro cambio.", "AI rewrote the email: the new text is under “MESSAGE”. Read it before sending; you can ask for another change.")}</p>}
      {draft && !aiKind && sp.ok !== "reescrito" && <p className="note attn">{t(`Respuesta preparada por IA a pedido de ${draft.createdByName}. Léela completa antes de enviar: revisa nombres, números de parte y lo que se le pide al cliente. SOLU agrega el número de la Necesidad en el asunto.`, `Reply prepared by AI at ${draft.createdByName}'s request. Read all of it before sending: check names, part numbers and what the customer is asked for. SOLU adds the Need number to the subject.`)}</p>}
      <form key={`${c.lang}-${sp.borrador ?? ""}`} action={sendComposed} className="stack">
        <input type="hidden" name="tpl" value={tpl} />
        <input type="hidden" name="id" value={sp.id} />
        <input type="hidden" name="lang" value={c.lang} />
        <input type="hidden" name="idem" value={randomUUID()} />
        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("PARA", "TO")}</b><span className="grow" />
            <span className="src">{c.lang === "ES" ? "Español" : "English"} · <Link href={langHref}>{other === "ES" ? t("Cambiar a español", "Switch to Spanish") : t("Cambiar a inglés", "Switch to English")}</Link></span>
          </div>
          {ownBox && (
            <label className="mail-from">{t("Enviar desde", "Send from")}
              <select name="fromBox" defaultValue="empresa">
                <option value="empresa">{from} · {t("correo de la empresa", "company email")}</option>
                <option value="externo">{ownBox} · {t("mi buzón", "my mailbox")}</option>
              </select>
              <span className="src">{t("Desde tu buzón, el cliente te responde a ti y la respuesta llega a tu correo: SOLU no la empareja sola en «Respuestas». La copia queda en tus Enviados.", "From your mailbox, the customer replies to you and the reply arrives in your own email: SOLU does not match it by itself under “Replies”. The copy stays in your Sent folder.")}</span>
            </label>
          )}
          <div className="mail-to">
            <label>{t("Para", "To")} · {c.toName}<input type="text" inputMode="email" name="to" defaultValue={sp.to ?? c.to ?? ""} required autoComplete="off" placeholder={t("correo@empresa.com", "name@company.com")} /></label>
            <label>{t("CC (con copia)", "CC (copy)")}<input type="text" inputMode="email" name="cc" defaultValue={sp.cc ?? ""} autoComplete="off" placeholder={t("opcional", "optional")} /></label>
            <label>{t("CCO (copia oculta)", "BCC (hidden copy)")}<input type="text" inputMode="email" name="bcc" defaultValue={sp.bcc ?? ""} autoComplete="off" placeholder={t("opcional", "optional")} /></label>
          </div>
          <span className="src">{t("Puedes escribir varios correos en cada casilla, separados por coma. El primero de «Para» es el destinatario principal: con ese SOLU empareja la respuesta. Los de CCO reciben el correo sin que los demás los vean.", "You can type several addresses in each box, separated by commas. The first one under “To” is the main recipient: SOLU matches the reply with that one. BCC recipients get the email without the others seeing them.")}</span>
          {!c.to && <p className="note">{t("No hay correo guardado para este destinatario. Escríbelo aquí y agrégalo también a su ficha.", "No email saved for this recipient. Type it here and add it to their record too.")}</p>}
        </section>

        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("ASUNTO", "SUBJECT")}</b><span className="grow" /><span className="src">{t("elige uno", "pick one")}</span></div>
          <div className="mail-subjects">
            {c.mail.subjects.map((s, k) => (
              <label key={k}><input type="radio" name="subject" value={k} defaultChecked={!draft && k === 0} /> <span>{s}</span></label>
            ))}
            <label><input type="radio" name="subject" value="custom" defaultChecked={!!draft} /> <input name="customSubject" maxLength={250} defaultValue={draft?.subject ?? ""} placeholder={t("Otro asunto…", "Other subject…")} /></label>
          </div>
        </section>

        <section className="jblock loc-sec">
          <div className="jbh" id="mensaje"><b>{t("MENSAJE", "MESSAGE")}</b></div>
          <MailBodyHints original={c.mail.text} tpl={tpl} ui={user.lang === "EN" ? "EN" : "ES"} initial={draft?.body ?? null} />
          {c.dealId && (
            <div className="ai-rw" id="reescribir">
              <b className="ai-rw-h"><span aria-hidden>✦</span> {t("Reescribir con IA", "Rewrite with AI")}</b>
              {aiOn ? (
                <>
                  <label className="ai-rw-l">{t("Dile a la IA cómo quieres el correo", "Tell the AI how you want the email")}
                    <textarea name="aiPrompt" rows={2} maxLength={1500} placeholder={t("Ej.: más corto y que pida la foto de la placa; menciona que la línea está parada y que respondemos mañana", "E.g.: shorter and ask for the nameplate photo; mention that the line is stopped and that we reply tomorrow")} />
                  </label>
                  <div className="ai-rw-act">
                    <button type="submit" className="secondary ai-rw-go" data-preset="" formAction={rewriteWithAi.bind(null, "")} formNoValidate disabled={!c.canSend}>{t("Reescribir con IA", "Rewrite with AI")}</button>
                    {Object.entries(REWRITE_PRESETS).map(([k, p]) => <button key={k} type="submit" className="secondary sm" data-preset={k} formAction={rewriteWithAi.bind(null, k)} formNoValidate disabled={!c.canSend}>{t(p.es, p.en)}</button>)}
                  </div>
                  <span className="src">{t("La IA toma el texto que está arriba, con tus cambios, y lo reescribe como le pidas. No cambia números de parte, cantidades, precios ni fechas, y no envía nada: el texto nuevo vuelve a esta misma casilla para que lo revises. Puedes pedirle cambios las veces que quieras.", "AI takes the text above, with your changes, and rewrites it as you ask. It does not change part numbers, quantities, prices or dates, and it sends nothing: the new text comes back to this same box for you to review. You can ask for changes as many times as you like.")}</span>
                </>
              ) : <span className="src">{t("Se enciende cuando la empresa conecte su llave de IA.", "It turns on once the company connects its AI key.")}</span>}
            </div>
          )}
          <p className="src">{t("Si no cambias el texto, sale con formato (tabla de partes). Si lo editas, sale como texto simple con tus cambios.", "If you don't change the text, it goes out formatted (parts table). If you edit it, it goes out as plain text with your changes.")} {t("Si pegas enlaces, SOLU les quita los parámetros de rastreo (utm, fbclid…).", "If you paste links, SOLU removes their tracking parameters (utm, fbclid…).")}</p>
          <details className="loc-preview"><summary>{t("Ver cómo se verá con formato", "Preview with formatting")}</summary>
            <div className="mail-preview" dangerouslySetInnerHTML={{ __html: c.mail.html }} />
          </details>
        </section>

        {(c.files || c.quotePdf) && (
          <section className="jblock loc-sec" id="adjuntos">
            <div className="jbh"><b>{t("ARCHIVOS ADJUNTOS", "ATTACHMENTS")}</b><span className="grow" /><span className="src">{t("fotos y PDF guardados en la Necesidad · máximo 3 MB en total", "photos and PDFs saved on the Need · 3 MB in total at most")}</span></div>
            {c.quotePdf && (
              <div className="mail-subjects">
                <label><input type="checkbox" name="attachQuote" value="1" defaultChecked /> <span><b>{t("La cotización en PDF", "The quotation as a PDF")}</b> · {c.quotePdf.name} <a href={`/documentos/cotizacion/${sp.id}?lang=${c.lang}`} target="_blank" rel="noopener">{t("verla", "view it")}</a></span></label>
              </div>
            )}
            {!c.files ? null : c.files.length === 0 ? <p className="src">{t("Esta Necesidad no tiene archivos. Se agregan en la Necesidad, pestaña Necesidad, bloque «Fotos y archivos».", "This Need has no files. Add them on the Need, Need tab, “Photos and files” block.")}</p> : (
              <div className="mail-subjects">
                {(c.files ?? []).map((f) => <label key={f.id}><input type="checkbox" name="attach" value={f.id} /> <span>{f.name} <span className="src">· {f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span></span></label>)}
              </div>
            )}
            <span className="src">{t("Marca solo lo que el cliente debe recibir. Las observaciones de uso interno nunca se envían.", "Tick only what the customer should receive. Internal notes are never sent.")}</span>
          </section>
        )}

        {(tpl === "ACK" || tpl === "PROGRESS") && c.dealId && <p className="src">{t("«Guardar solo interno, sin enviar» deja este texto en la historia de la Necesidad como nota interna. El cliente no recibe nada, y puedes enviarle el correo más adelante desde la Necesidad.", "“Keep internal only, don't send” leaves this text in the Need's history as an internal note. The customer receives nothing, and you can send them the email later from the Need.")}</p>}
        <div className="loc-rowacts">
          <button type="submit" disabled={!c.canSend}>{t("Enviar correo", "Send email")}</button>
          {(tpl === "ACK" || tpl === "PROGRESS") && c.dealId && <button type="submit" className="secondary" formAction={saveInternal} formNoValidate disabled={!c.canSend}>{t("Guardar solo interno, sin enviar", "Keep internal only, don't send")}</button>}
          <Link className="btn secondary" href={c.back}>{t("Cancelar", "Cancel")}</Link>
        </div>
      </form>
    </>
  );
}
