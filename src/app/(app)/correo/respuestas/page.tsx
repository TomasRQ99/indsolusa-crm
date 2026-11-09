import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { lastReplySync, replyReport, syncRepliesQuietly } from "@/lib/mail-replies";
import { TEMPLATES, type TemplateKey } from "@/lib/email-templates";
import { checkReplies } from "../actions";

export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ ok?: string; n?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  await syncRepliesQuietly();
  const r = await replyReport(90);
  const st = lastReplySync();
  const when = st ? `${i.dateShort(st.at)} ${new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" }).format(st.at)}` : "";
  const tplName = (k: string) => (k in TEMPLATES ? t(TEMPLATES[k as TemplateKey].es, TEMPLATES[k as TemplateKey].en) : k);
  const hrs = (h: number | null) => (h == null ? "—" : h < 24 ? t(`${Math.max(1, Math.round(h))} h`, `${Math.max(1, Math.round(h))} h`) : t(`${i.n2(h / 24).replace(/0$/, "")} días`, `${i.n2(h / 24).replace(/0$/, "")} days`));
  // No fake precision: a "typical" time needs at least 3 replies; with 1–2 we show the facts.
  const typ = (h: number | null, n: number) => (h == null ? "—" : n >= 3 ? hrs(h) : n === 1 ? t(`${hrs(h)} (1 vez)`, `${hrs(h)} (once)`) : t(`${hrs(h)} (2 veces)`, `${hrs(h)} (twice)`));
  const of = (a: number, b: number) => (b ? `${a} ${t("de", "of")} ${b}` : "—");
  const errs: Record<string, string> = {
    DENIED: t("Microsoft no dio permiso para leer el buzón. En Microsoft Entra, la app necesita el permiso de aplicación Mail.Read con “Grant admin consent”.", "Microsoft denied reading the mailbox. In Microsoft Entra the app needs the Mail.Read application permission with “Grant admin consent”."),
    NOT_CONFIGURED: t("El correo de la empresa (Microsoft Graph) no está configurado en este servidor.", "Company email (Microsoft Graph) isn't configured on this server."),
    OTHER: t("No se pudo revisar el buzón: ", "Couldn't check the mailbox: ") + (st?.message ?? ""),
  };
  const hrefFor = (m: (typeof r.waiting)[number]) =>
    m.refKind === "RFQR" ? `/correo/nuevo?tpl=FOLLOWUP&id=${m.refId}` : m.refKind === "SPO" ? `/compras/${m.refId}` : m.refKind === "QUOTE" ? `/cotizaciones/${m.refId}` : m.refKind === "INVOICE" ? `/administracion/cobrar?f=${m.refId}` : m.supplierId ? `/suppliers/${m.supplierId}` : "#";

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mi día · Correo", "My day · Email")}</div>
          <h1>{t("Respuestas a nuestros correos", "Replies to our emails")}</h1>
          <p>{t("Qué correos enviados desde sales@ ya tienen respuesta, por plantilla y por proveedor. Solo se lee el buzón (no se mueve ni se marca nada) y solo las respuestas a correos que SOLU envió. No mide personas.", "Which emails sent from sales@ have been answered, by template and by supplier. The mailbox is only read (nothing is moved or marked) and only replies to emails SOLU sent. It doesn't measure people.")}</p>
        </div>
        <div className="grow" />
        <Link className="btn secondary" href="/correo/entrega">{t("¿Llegan nuestros correos?", "Do our emails arrive?")}</Link>
        <form action={checkReplies}><button type="submit" className="secondary">{t("Revisar el buzón ahora", "Check the mailbox now")}</button></form>
      </div>
      {sp.ok === "incierto" && <p className="note attn">{t("Microsoft no confirmó el envío: puede que sí haya salido. Para no duplicarlo, no lo reenvíes: SOLU lo busca en Enviados en los próximos minutos y lo marca como enviado, o como no enviado para que puedas reintentarlo.", "Microsoft didn't confirm the send: it may have gone out. To avoid a duplicate, don't resend it: SOLU looks for it in Sent Items in the next few minutes and marks it as sent, or as not sent so you can retry.")}</p>}
      {sp.ok === "revisado" && <p className="note okn">{t(`Buzón revisado: ${sp.n ?? 0} respuesta(s) nueva(s).`, `Mailbox checked: ${sp.n ?? 0} new repl(ies).`)}</p>}
      {st && !st.ok && <p className="note attn">{errs[st.code ?? "OTHER"] ?? errs.OTHER}</p>}
      <p className="src">{st ? (st.ok ? t(`Última revisión: ${when} · conexión con Microsoft correcta.`, `Last check: ${when} · Microsoft connection OK.`) : t("Última revisión con error (arriba).", "Last check failed (above).")) : t("Aún no se ha revisado el buzón desde que arrancó el servidor.", "The mailbox hasn't been checked since the server started.")} {t("Se revisa sola cada 10 minutos cuando alguien abre esta página o una solicitud de cotización.", "It checks by itself every 10 minutes when someone opens this page or a quote request.")}</p>

      <section className="sum">
        <div><span className="k">{t("Enviados", "Sent")}</span><span className="v">{r.total.sent}</span><span className="s">{t(`últimos ${r.days} días`, `last ${r.days} days`)}</span></div>
        <div><span className="k">{t("Con respuesta", "Answered")}</span><span className="v">{r.total.replied}</span><span className="s">{of(r.total.replied, r.total.sent)}</span></div>
        <div><span className="k">{t("Tiempo típico de respuesta", "Typical reply time")}</span><span className="v">{typ(r.total.medianHours, r.total.replied)}</span><span className="s">{t("mediana", "median")}</span></div>
        <div><span className="k">{t("Rebotados", "Bounced")}</span><span className="v">{r.total.bounced}</span><span className="s">{t("dirección a revisar", "address to check")}</span></div>
      </section>

      {r.unconfirmed.length > 0 && (
        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("SIN CONFIRMAR", "NOT CONFIRMED")}</b><span className="grow" /><span className="src">{t("SOLU los busca en Enviados antes de permitir reintentar", "SOLU looks for them in Sent Items before allowing a retry")}</span></div>
          <ul className="rp-list">{r.unconfirmed.map((m) => (
            <li key={m.id}><span><b>{m.supplier?.name ?? m.account?.name ?? m.toAddr}</b> · {tplName(m.template)}{m.refCode ? <span className="mono"> · {m.refCode}</span> : null}<span className="src block">{i.day(m.sentAt)} · {m.subject}</span></span></li>
          ))}</ul>
        </section>
      )}
      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("POR PLANTILLA", "BY TEMPLATE")}</b></div>
        {r.templates.length === 0 ? <p className="quiet-p">{t("Aún no hay correos enviados desde SOLU.", "No emails sent from SOLU yet.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Plantilla", "Template")}</th><th className="n">{t("Enviados", "Sent")}</th><th className="n">{t("Con respuesta", "Answered")}</th><th className="n">{t("Tiempo típico", "Typical time")}</th><th className="n">{t("Solo respuesta automática", "Auto-reply only")}</th><th className="n">{t("Rebotados", "Bounced")}</th></tr></thead>
            <tbody>{r.templates.map((x) => (
              <tr key={x.tpl}><td>{tplName(x.tpl)}</td><td className="n">{x.sent}</td><td className="n">{of(x.replied, x.sent)}</td><td className="n">{typ(x.medianHours, x.replied)}</td><td className="n">{x.auto || "—"}</td><td className="n">{x.bounced || "—"}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("POR PROVEEDOR", "BY SUPPLIER")}</b><span className="grow" /><span className="src">{t("hechos, sin puntaje", "facts, no score")}</span></div>
        {r.suppliers.length === 0 ? <p className="quiet-p">{t("Aún no hay correos a proveedores.", "No supplier emails yet.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Enviados", "Sent")}</th><th className="n">{t("Con respuesta", "Answered")}</th><th className="n">{t("Tiempo típico", "Typical time")}</th><th>{t("Última respuesta", "Last reply")}</th><th className="n">{t("Rebotados", "Bounced")}</th></tr></thead>
            <tbody>{r.suppliers.map((x) => (
              <tr key={x.id}><td><Link href={`/suppliers/${x.id}`}>{x.name}</Link></td><td className="n">{x.sent}</td><td className="n">{of(x.replied, x.sent)}</td><td className="n">{typ(x.medianHours, x.replied)}</td><td>{x.lastReply ? i.day(x.lastReply) : "—"}</td><td className="n">{x.bounced || "—"}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("ESPERANDO RESPUESTA (MÁS DE 2 DÍAS)", "WAITING FOR A REPLY (OVER 2 DAYS)")}</b></div>
        {r.waiting.length === 0 ? <p className="quiet-p">{t("Nada esperando más de 2 días.", "Nothing waiting over 2 days.")}</p> : (
          <ul className="rp-list">{r.waiting.map((m) => (
            <li key={m.id}><span><b>{m.supplier?.name ?? m.account?.name ?? m.toAddr}</b> · {tplName(m.template)}{m.refCode ? <span className="mono"> · {m.refCode}</span> : null}<span className="src block">{t("enviado el", "sent on")} {i.day(m.sentAt)}{m.autoReplyAt ? t(" · solo respuesta automática", " · auto-reply only") : ""}</span></span>
              <Link className="link small" href={hrefFor(m)}>{m.refKind === "RFQR" ? t("Recordar", "Follow up") : t("Abrir", "Open")}</Link></li>
          ))}</ul>
        )}
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("ÚLTIMAS RESPUESTAS", "LATEST REPLIES")}</b></div>
        {r.recent.length === 0 ? <p className="quiet-p">{t("Aún no se han encontrado respuestas.", "No replies found yet.")}</p> : (
          <ul className="rp-list">{r.recent.map((m) => (
            <li key={m.id}><span><b>{m.supplier?.name ?? m.account?.name ?? m.toAddr}</b> · {tplName(m.template)}{m.refCode ? <span className="mono"> · {m.refCode}</span> : null}
              {m.bouncedAt ? <span className="src block rp-warn">{t("Rebotó el", "Bounced on")} {i.day(m.bouncedAt)} · {m.toAddr}</span>
                : <span className="src block">{t("Respondió el", "Replied on")} {i.day(m.repliedAt!)} · {m.replyFrom}{m.replyPreview ? ` · “${m.replyPreview}”` : ""}</span>}</span>
              {m.refKind === "RFQR" && !m.bouncedAt && <Link className="link small" href={`/localizar/ofertas/nueva?rfqr=${m.refId}`}>{t("Registrar su cotización", "Record their quote")}</Link>}</li>
          ))}</ul>
        )}
      </section>
    </>
  );
}
