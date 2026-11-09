import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { mailConfig } from "@/lib/mail";
import { domainReport, sendingDomain, templateReview, type Level } from "@/lib/mail-health";
import { recheckDomain } from "../actions";

const ICON: Record<Level, string> = { ok: "✓", warn: "!", fail: "✕", info: "i" };

export default async function DeliveryHealth({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const from = mailConfig().from ?? "sales@";
  const own = sendingDomain();
  const asked = sp.d && /^[a-z0-9.-]{3,253}$/i.test(sp.d) ? sp.d.toLowerCase() : null;
  const rep = await domainReport({ domain: asked ?? undefined });
  const tpls = templateReview(user.name, from);
  const L = (x: { es: string; en: string }) => t(x.es, x.en);
  const levelText: Record<Level, string> = { ok: t("Bien", "Good"), warn: t("Revisar", "Review"), fail: t("Falta o tiene error", "Missing or wrong"), info: t("Para saber", "Good to know") };
  const bad = rep.checks?.filter((c) => c.level === "fail" || c.level === "warn").length ?? 0;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/correo/respuestas">{t("Respuestas a nuestros correos", "Replies to our emails")}</Link></div>
          <h1>{t("Que nuestros correos lleguen", "Making sure our emails arrive")}</h1>
          <p>{t("Revisión de solo lectura: SOLU consulta el DNS público del dominio y revisa las plantillas. No cambia nada; si algo falta, aquí está el paso a paso para quien administra el dominio en GoDaddy y Microsoft 365.", "Read-only review: SOLU queries the domain's public DNS and reviews the templates. It changes nothing; if something is missing, here are the steps for whoever manages the domain in GoDaddy and Microsoft 365.")}</p>
        </div>
      </div>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("DOMINIO", "DOMAIN")} {rep.domain ?? "—"}</b>{rep.domain === own && <span className="src">· {t(`el de ${from}`, `the one of ${from}`)}</span>}<span className="grow" />
          {rep.at && <span className="src">{t("revisado", "checked")} {i.dateShort(rep.at)}</span>}</div>
        {rep.error === "NO_DOMAIN" ? <p className="note attn">{t("No hay correo de envío configurado (MAIL_FROM).", "No sending email configured (MAIL_FROM).")}</p>
          : rep.error ? <p className="note attn">{t(`No se pudo consultar el DNS desde el servidor (${rep.error}). Intenta de nuevo en unos minutos.`, `Couldn't query DNS from the server (${rep.error}). Try again in a few minutes.`)}</p>
          : <>
            <p className={`note ${bad ? "attn" : "okn"}`}>{bad ? t(`${bad} punto(s) por revisar. Mientras tanto los correos salen, pero tienen más riesgo de llegar a spam o de que alguien suplante el dominio.`, `${bad} item(s) to review. Emails still go out meanwhile, but with more risk of landing in spam or of someone impersonating the domain.`) : t("Todo en orden: SPF, DKIM y DMARC configurados.", "All good: SPF, DKIM and DMARC set up.")}</p>
            <ul className="mh-list">{rep.checks!.map((c) => (
              <li key={c.key} className={`mh-${c.level}`}>
                <span className="mh-ico" aria-hidden>{ICON[c.level]}</span>
                <div>
                  <b>{L(c.title)}</b> <span className="mh-lv">{levelText[c.level]}</span>
                  <p>{L(c.meaning)}</p>
                  {c.found && <p className="mono small mh-rec">{c.found}</p>}
                  {c.fix && <details><summary>{t("Cómo arreglarlo", "How to fix it")}</summary><p>{L(c.fix)}</p></details>}
                </div>
              </li>
            ))}</ul>
          </>}
        <form action={recheckDomain} className="mh-form">
          <input name="domain" placeholder={own ?? "dominio.com"} defaultValue={asked ?? ""} aria-label={t("Dominio", "Domain")} />
          <button type="submit" className="secondary">{t("Revisar de nuevo", "Check again")}</button>
        </form>
        <p className="src">{t("Vacío = el dominio de envío. Los cambios de DNS pueden tardar hasta unas horas en verse.", "Empty = the sending domain. DNS changes can take a few hours to show.")}</p>
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("PLANTILLAS", "TEMPLATES")}</b><span className="grow" /><span className="src">{t("con datos de ejemplo", "with sample data")}</span></div>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Plantilla", "Template")}</th><th className="n">{t("Tamaño", "Size")}</th><th className="n">{t("Enlaces", "Links")}</th><th>{t("Texto simple", "Plain text")}</th><th>{t("Notas", "Notes")}</th></tr></thead>
          <tbody>{tpls.map((x) => (
            <tr key={x.key} className={`mh-${x.level}`}>
              <td>{t(x.name.es, x.name.en)}</td><td className="n">{x.kb} KB</td><td className="n">{x.links}</td><td>{x.plain ? t("sí", "yes") : t("no", "no")}</td>
              <td className="small">{x.notes.length ? x.notes.map((n, k) => <span key={k} className="block">{L(n)}</span>) : t("Sin observaciones.", "No remarks.")}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="src">{t("Al enviar, SOLU quita los parámetros de rastreo de los enlaces (utm, fbclid, gclid…) y no envía enlaces acortados ni a direcciones IP. Los correos no llevan píxeles de seguimiento.", "When sending, SOLU removes tracking parameters from links (utm, fbclid, gclid…) and doesn't send shortened links or links to IP addresses. Emails carry no tracking pixels.")}</p>
      </section>
    </>
  );
}
