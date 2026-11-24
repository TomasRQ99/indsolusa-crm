import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { mailConfig } from "@/lib/mail";
import { cleanKeys, composeFollowUps } from "@/lib/followups";
import MailBodyHints from "@/components/MailBodyHints";
import { sendFollowUps } from "../actions";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// The one follow-up email, already written from the ticked items. Nothing is sent until "Enviar correo".
export default async function FollowUpMailPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const sp = await searchParams;
  const a = one(sp.a).slice(0, 40), cId = one(sp.c).slice(0, 40) || null;
  const keys = cleanKeys(sp.k == null ? [] : Array.isArray(sp.k) ? sp.k : [sp.k]);
  const back = `/cotizaciones/seguimientos?${new URLSearchParams({ a, ...(cId ? { c: cId } : {}) })}`;
  if (!a) redirect("/cotizaciones/seguimientos");
  if (!keys.length) redirect(`${back}&err=nada`);
  const notes: Record<string, string> = {};
  for (const k of keys) notes[k] = one(sp[`n_${k}`]);
  const forced = one(sp.lang);
  const from = mailConfig().from ?? "sales@indsolusa.com";
  const c = await composeFollowUps({ accountId: a, contactId: cId, keys, notes, lang: forced === "ES" || forced === "EN" ? forced : null }, user, from);
  if (!c) redirect(`${back}&err=cambio`);

  const qs = new URLSearchParams({ a, ...(cId ? { c: cId } : {}) });
  for (const it of c.items) { qs.append("k", it.key); if (c.notes[it.key]) qs.append(`n_${it.key}`, c.notes[it.key]); }
  const other = c.lang === "EN" ? "ES" : "EN";
  const langHref = `/cotizaciones/seguimientos/correo?${qs}&lang=${other}`;
  const quotes = c.items.filter((x) => x.kind === "Q");
  const msg = one(sp.msg);
  const errs: Record<string, string> = {
    correo: t("El correo de la empresa no está configurado.", "Company email isn't configured."),
    destino: t("Revisa los correos: falta el destinatario principal o alguno está mal escrito. Varios correos van separados por coma.", "Check the addresses: the main recipient is missing or one is mistyped. Several addresses are separated by commas."),
    asunto: t("Escribe el asunto.", "Enter the subject."),
    texto: t("El mensaje está vacío.", "The message is empty."),
    adjuntos: t("No se envió: las cotizaciones marcadas pesan más de 3 MB en total, y el buzón no las acepta. Desmarca alguna.", "Not sent: the ticked quotations weigh more than 3 MB in total and the mailbox won't accept them. Untick some."),
    envio: t("No se pudo enviar: ", "Couldn't send: ") + msg,
    enlace: t("No se envió: el texto tiene un enlace acortado o a una dirección IP, y los filtros de spam suelen bloquearlos. Usa el enlace completo: ", "Not sent: the text has a shortened link or a link to an IP address, which spam filters often block. Use the full link: ") + msg,
  };
  const err = one(sp.err);
  const kindName = (k: string) => ({ N: t("Solicitud", "Request"), Q: t("Cotización", "Quote"), O: t("Orden de compra", "Purchase order"), E: t("Entrega", "Delivery"), I: t("Factura", "Invoice"), P: t("Proyecto", "Project") })[k] ?? k;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href={back}>{t("Seguimientos", "Follow-ups")} · {c.account.name}</Link></div>
          <h1>{t("Correo de seguimiento", "Follow-up email")}</h1>
          <p>{t(`Un solo correo para ${c.items.length === 1 ? "1 pendiente" : `${c.items.length} pendientes`} de ${c.account.name}. Sale desde ${from}.`, `A single email for ${c.items.length === 1 ? "1 pending item" : `${c.items.length} pending items`} of ${c.account.name}. Sent from ${from}.`)}</p>
        </div>
      </div>
      {err && errs[err] && <p className="note attn">{errs[err]}</p>}

      <section className="jblock loc-sec" id="incluye">
        <div className="jbh"><b>{t("ESTE CORREO HACE SEGUIMIENTO A", "THIS EMAIL FOLLOWS UP")}</b><span className="grow" /><Link className="link small" style={{ marginLeft: 10 }} href={back}>{t("Cambiar la selección", "Change the selection")}</Link></div>
        <ul className="fu-incl">
          {c.items.map((it) => (
            <li key={it.key}><span className="sig wait">{kindName(it.kind)}</span> <Link href={it.href}>{it.title}</Link> <span className="src">· {it.sub}{c.notes[it.key] ? ` · ${t("tu nota", "your note")}: «${c.notes[it.key]}»` : ""}</span></li>
          ))}
        </ul>
      </section>

      <form key={c.lang} action={sendFollowUps} className="stack">
        <input type="hidden" name="a" value={a} />
        {cId && <input type="hidden" name="c" value={cId} />}
        <input type="hidden" name="lang" value={c.lang} />
        <input type="hidden" name="idem" value={randomUUID()} />
        {c.items.map((it) => <input key={it.key} type="hidden" name="k" value={it.key} />)}
        {c.items.filter((it) => c.notes[it.key]).map((it) => <input key={it.key} type="hidden" name={`n_${it.key}`} value={c.notes[it.key]} />)}

        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("PARA", "TO")}</b><span className="grow" />
            <span className="src">{c.lang === "ES" ? "Español" : "English"} · <Link href={langHref}>{other === "ES" ? t("Cambiar a español", "Switch to Spanish") : t("Cambiar a inglés", "Switch to English")}</Link></span>
          </div>
          <div className="mail-to">
            <label>{t("Para", "To")} · {c.toName}<input type="text" inputMode="email" name="to" defaultValue={c.to ?? ""} required autoComplete="off" placeholder={t("correo@empresa.com", "name@company.com")} /></label>
            <label>{t("CC (con copia)", "CC (copy)")}<input type="text" inputMode="email" name="cc" autoComplete="off" placeholder={t("opcional", "optional")} /></label>
            <label>{t("CCO (copia oculta)", "BCC (hidden copy)")}<input type="text" inputMode="email" name="bcc" autoComplete="off" placeholder={t("opcional", "optional")} /></label>
          </div>
          <span className="src">{t("Puedes escribir varios correos en cada casilla, separados por coma. El primero de «Para» es el destinatario principal: con ese SOLU empareja la respuesta.", "You can type several addresses in each box, separated by commas. The first one under “To” is the main recipient: SOLU matches the reply with that one.")}</span>
          {!c.to && <p className="note">{t("No hay correo guardado para esta persona. Escríbelo aquí y agrégalo también a su ficha.", "No email saved for this person. Type it here and add it to their record too.")}</p>}
        </section>

        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("ASUNTO", "SUBJECT")}</b><span className="grow" /><span className="src">{t("elige uno", "pick one")}</span></div>
          <div className="mail-subjects">
            {c.mail.subjects.map((s, k) => (
              <label key={k}><input type="radio" name="subject" value={k} defaultChecked={k === 0} /> <span>{s}</span></label>
            ))}
            <label><input type="radio" name="subject" value="custom" /> <input name="customSubject" maxLength={250} placeholder={t("Otro asunto…", "Other subject…")} /></label>
          </div>
        </section>

        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("MENSAJE", "MESSAGE")}</b></div>
          <MailBodyHints original={c.mail.text} tpl="FOLLOWUPS" ui={user.lang === "EN" ? "EN" : "ES"} />
          <p className="src">{t("El texto ya trae cada pendiente con sus datos. Puedes cambiar lo que quieras antes de enviar.", "The text already carries each pending item with its data. You can change anything before sending.")}</p>
          <details className="loc-preview"><summary>{t("Ver cómo se verá con formato", "Preview with formatting")}</summary>
            <div className="mail-preview" dangerouslySetInnerHTML={{ __html: c.mail.html }} />
          </details>
        </section>

        {quotes.length > 0 && (
          <section className="jblock loc-sec" id="adjuntos">
            <div className="jbh"><b>{t("ARCHIVOS ADJUNTOS", "ATTACHMENTS")}</b><span className="grow" /><span className="src">{t("opcional · máximo 3 MB en total", "optional · 3 MB in total at most")}</span></div>
            <div className="mail-subjects">
              {quotes.map((q) => (
                <label key={q.id}><input type="checkbox" name="pdf" value={q.id} /> <span><b>{t("Adjuntar la cotización en PDF", "Attach the quotation as a PDF")}</b> · {q.title} <a href={`/documentos/cotizacion/${q.id}?lang=${c.lang}`} target="_blank" rel="noopener">{t("verla", "view it")}</a></span></label>
              ))}
            </div>
            <span className="src">{t("Sirve cuando el cliente pudo haber perdido el correo original.", "Useful when the customer may have lost the original email.")}</span>
          </section>
        )}

        <div className="loc-rowacts">
          <button type="submit">{t("Enviar correo", "Send email")}</button>
          <Link className="btn secondary" href={back}>{t("Cancelar", "Cancel")}</Link>
        </div>
      </form>
    </>
  );
}
