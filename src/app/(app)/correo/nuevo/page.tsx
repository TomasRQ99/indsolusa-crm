import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { mailConfig } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { TEMPLATES, type TemplateKey } from "@/lib/email-templates";
import { sendComposed } from "../actions";

export default async function ComposeMail({ searchParams }: { searchParams: Promise<{ tpl?: string; id?: string; lang?: string; err?: string; msg?: string }> }) {
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
  const other = c.lang === "EN" ? "ES" : "EN";
  const langHref = `/correo/nuevo?${new URLSearchParams({ tpl, id: sp.id!, lang: other })}`;
  const errs: Record<string, string> = {
    correo: t("El correo de la empresa no está configurado.", "Company email isn't configured."),
    permiso: t("Solo el responsable del Journey (o un administrador) puede enviar este correo.", "Only the Journey owner (or an admin) can send this email."),
    destino: t("Escribe un correo de destino válido.", "Enter a valid recipient email."),
    asunto: t("Escribe el asunto.", "Enter the subject."),
    texto: t("El mensaje está vacío.", "The message is empty."),
    envio: t("No se pudo enviar: ", "Couldn't send: ") + (sp.msg ?? ""),
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

      <form key={c.lang} action={sendComposed} className="stack">
        <input type="hidden" name="tpl" value={tpl} />
        <input type="hidden" name="id" value={sp.id} />
        <input type="hidden" name="lang" value={c.lang} />
        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("PARA", "TO")}</b><span className="grow" />
            <span className="src">{c.lang === "ES" ? "Español" : "English"} · <Link href={langHref}>{other === "ES" ? t("Cambiar a español", "Switch to Spanish") : t("Cambiar a inglés", "Switch to English")}</Link></span>
          </div>
          <div className="loc-docgrid">
            <label>{c.toName}<input type="email" name="to" defaultValue={c.to ?? ""} required placeholder={t("correo@empresa.com", "name@company.com")} /></label>
          </div>
          {!c.to && <p className="note">{t("No hay correo guardado para este destinatario. Escríbelo aquí y agrégalo también a su ficha.", "No email saved for this recipient. Type it here and add it to their record too.")}</p>}
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
          <textarea name="body" rows={18} defaultValue={c.mail.text} className="mail-body" />
          <p className="src">{t("Si no cambias el texto, sale con formato (tabla de partes). Si lo editas, sale como texto simple con tus cambios.", "If you don't change the text, it goes out formatted (parts table). If you edit it, it goes out as plain text with your changes.")} {t("Si pegas enlaces, SOLU les quita los parámetros de rastreo (utm, fbclid…).", "If you paste links, SOLU removes their tracking parameters (utm, fbclid…).")}</p>
          <details className="loc-preview"><summary>{t("Ver cómo se verá con formato", "Preview with formatting")}</summary>
            <div className="mail-preview" dangerouslySetInnerHTML={{ __html: c.mail.html }} />
          </details>
        </section>

        <div className="loc-rowacts">
          <button type="submit" disabled={!c.canSend}>{t("Enviar correo", "Send email")}</button>
          <Link className="btn secondary" href={c.back}>{t("Cancelar", "Cancel")}</Link>
        </div>
      </form>
    </>
  );
}
