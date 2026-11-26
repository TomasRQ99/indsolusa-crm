import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { aiConfigured, aiSpentThisMonth, monthlyCap } from "@/lib/ai";
import { HUNT_STALE_MS, contactNote, confidenceLabel, failText, leadsMailedAt, needsToSaveOn, type HuntAnswers, type Understood } from "@/lib/web-hunt";
import { HuntWaiting } from "@/components/HuntWaiting";
import { HuntForm } from "@/components/HuntForm";
import { WebLeadCard } from "@/components/WebLeadCard";
import { saveLead, startHunt } from "../actions";

export default async function HuntPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; l?: string; n?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const hunt = await db.webHunt.findUnique({
    where: { id },
    include: {
      leads: { orderBy: { position: "asc" }, include: { deal: { select: { id: true, code: true, title: true } }, supplier: { select: { id: true, name: true } } } },
      deal: { select: { id: true, code: true, title: true, account: { select: { name: true } } } },
      part: { select: { id: true, mpn: true } },
    },
  });
  if (!hunt) notFound();
  const [needs, spent, mailed] = await Promise.all([needsToSaveOn(user), aiSpentThisMonth(), leadsMailedAt(hunt.leads.map((l) => l.id))]);
  const cap = monthlyCap();
  const cNote = contactNote(sp.ok, sp.err, sp.n, t);
  const aiState = !aiConfigured() ? "OFF" : spent.usd + 0.1 > cap ? "CAP" : "ON";
  const answers = (hunt.answers ?? {}) as HuntAnswers;
  const und = hunt.understood as Understood | null;
  const questions = (Array.isArray(hunt.questions) ? hunt.questions : []) as string[];
  const stale = hunt.status === "RUNNING" && Date.now() - hunt.createdAt.getTime() > HUNT_STALE_MS;
  const status = stale ? "FAILED" : hunt.status;
  const failCode = stale ? "STALE" : hunt.failCode;
  const back = `/localizar?${new URLSearchParams({ q: hunt.query, ...(hunt.dealId ? { deal: hunt.dealId } : {}) })}`;
  const asked = [
    answers.brand ? t(`marca ${answers.brand}`, `brand ${answers.brand}`) : null,
    answers.qty ? t(`cantidad ${answers.qty}`, `quantity ${answers.qty}`) : null,
    t(`entrega en ${answers.country || "Colombia"}`, `delivery in ${answers.country || "Colombia"}`),
    answers.condition === "ANY" ? t("nueva, usada o reacondicionada", "new, used or refurbished") : t("solo nueva", "new only"),
    answers.equivalents ? t("acepta equivalentes", "equivalents accepted") : null,
    answers.details || null,
  ].filter(Boolean).join(" · ");
  const groups = (["HIGH", "MEDIUM", "LOW"] as const).map((c) => ({ c, leads: hunt.leads.filter((l) => l.confidence === c) })).filter((g) => g.leads.length);
  const HINT: Record<string, string> = {
    HIGH: t("El número de parte exacto se vio en la página del vendedor.", "The exact part number was seen on the seller's page."),
    MEDIUM: t("Todo indica que la tienen, pero falta comprobarlo en la página.", "Everything suggests they have it, but it still has to be checked on the page."),
    LOW: t("Vendedores a los que vale la pena preguntar; la pieza no se vio publicada.", "Sellers worth asking; the piece was not seen listed."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/localizar">{t("Localizar repuestos", "Find parts")}</Link> · {t("Búsqueda en internet", "Internet search")}</div>
          <h1>{hunt.query}</h1>
          <p>{asked}</p>
          <p className="src">{t(`Buscado por ${hunt.userName} el ${i.day(hunt.createdAt)}`, `Searched by ${hunt.userName} on ${i.day(hunt.createdAt)}`)}{status === "DONE" && hunt.searches > 0 ? t(` · ${hunt.searches} consulta(s) al buscador`, ` · ${hunt.searches} search engine query(ies)`) : ""}{status === "DONE" && canManageAll(user) && hunt.costUsd != null ? t(` · costo de IA USD ${Number(hunt.costUsd).toFixed(2)}`, ` · AI cost USD ${Number(hunt.costUsd).toFixed(2)}`) : ""}</p>
        </div>
        <span className="grow" />
        <div><Link className="btn secondary" href={back}>{t("Volver a Localizar repuestos", "Back to Find parts")}</Link></div>
      </div>

      {hunt.deal && (
        <div className="loc-ctx">
          <span>{t(`Buscando para la Necesidad ${hunt.deal.code ?? ""} · ${hunt.deal.title} (${hunt.deal.account.name})`, `Sourcing for Need ${hunt.deal.code ?? ""} · ${hunt.deal.title} (${hunt.deal.account.name})`)}</span>
          <span className="grow" />
          <Link className="link small" href={`/deals/${hunt.deal.id}?tab=locate`}>{t("Volver a la Necesidad", "Back to Need")}</Link>
        </div>
      )}

      {sp.ok === "guardada" && <p className="note okn" role="status">{t("Opción guardada en la Necesidad. La encuentras allá en «Localizar» y en «Fuente», bajo «OPCIONES ENCONTRADAS EN INTERNET».", "Option saved on the Need. You will find it there under “Locate” and “Source”, in “OPTIONS FOUND ON THE INTERNET”.")}</p>}
      {sp.ok === "correo" && <p className="note okn" role="status">{t("Correo enviado al vendedor. Su respuesta aparecerá en MI DÍA → Respuestas; el vendedor queda marcado «Correo enviado».", "Email sent to the seller. Their reply will show under MY DAY → Replies; the seller is marked “Email sent”.")}</p>}
      {sp.ok === "correo-interno" && <p className="note" role="status">{t("El texto quedó como nota interna en la Necesidad. Al vendedor no se le envió nada.", "The text was kept as an internal note on the Need. Nothing was sent to the seller.")}</p>}
      {cNote && <p className={`note ${cNote.good ? "okn" : "attn"}`} role={cNote.good ? "status" : "alert"}>{cNote.text}</p>}
      {sp.err === "necesidad" && <p className="note attn" role="alert">{t("Falta elegir la Necesidad donde se guarda: escógela en la lista de esa opción y vuelve a guardar.", "The Need to save it on is missing: pick it in that option's list and save again.")}</p>}
      {sp.err === "permiso" && <p className="note attn" role="alert">{t("Solo el dueño de esa Necesidad, Gerencia o el Director Comercial pueden guardarle opciones.", "Only that Need's owner, Management or the Commercial Director can save options on it.")}</p>}

      {status === "RUNNING" && (
        <section className="jblock">
          <HuntWaiting startedAt={hunt.createdAt.toISOString()} lang={user.lang === "EN" ? "EN" : "ES"} />
          <p className="src" style={{ marginTop: 8 }}>{t("Puedes dejar esta página abierta o irte y volver después: la búsqueda sigue sola y el resultado queda guardado aquí.", "You can leave this page open or go and come back later: the search carries on by itself and the result is kept here.")}</p>
        </section>
      )}

      {status === "FAILED" && (
        <section className="jblock">
          <p className="note attn" role="alert"><span><b>{failText(failCode, t)}</b> {t("No se guardó ningún resultado. Puedes intentarlo otra vez.", "No result was saved. You can try again.")}{canManageAll(user) && hunt.failNote ? <><br /><span className="src">{hunt.failNote}</span></> : null}</span></p>
          <div style={{ marginTop: 10 }}><HuntForm t={t} q={hunt.query} dealId={hunt.dealId} partId={hunt.partId} needs={needs} answers={answers} state={aiState} cap={cap} /></div>
        </section>
      )}

      {status === "DONE" && (
        <>
          <section className="jblock">
            <div className="jbh"><b>{t("LO QUE SOLU ENTENDIÓ", "WHAT SOLU UNDERSTOOD")}</b></div>
            <dl className="qv-dl">
              <dt>{t("La pieza", "The piece")}</dt><dd>{und?.what || <span className="muted">—</span>}</dd>
              <dt>{t("Número de parte", "Part number")}</dt><dd className="mono">{und?.partNumber ?? "—"}{und?.brand ? <span className="src"> · {und.brand}</span> : null}</dd>
              {und && und.alternates.length > 0 && (
                <><dt>{t("También se vende como", "Also sold as")}</dt><dd>{und.alternates.map((a) => <span key={a.code} className="block"><span className="mono">{a.code}</span>{a.note ? <span className="src"> {a.note}</span> : null}</span>)}</dd></>
              )}
              {hunt.summary && <><dt>{t("Resumen", "Summary")}</dt><dd>{hunt.summary}</dd></>}
            </dl>
          </section>

          {hunt.leads.length === 0 ? (
            <section className="jblock">
              <p><b>{t("No se encontró ningún vendedor para esta pieza.", "No seller was found for this piece.")}</b></p>
              <p className="src">{t("Prueba con el número de parte completo, la marca, o permite equivalentes y piezas usadas.", "Try the full part number, the brand, or allow equivalents and used pieces.")}</p>
            </section>
          ) : (
            <>
              <p className="wl-count">{t(`${hunt.leads.length} vendedor(es) encontrados:`, `${hunt.leads.length} seller(s) found:`)} {groups.map((g) => <span key={g.c} className={`sig ${g.c === "HIGH" ? "ok" : g.c === "MEDIUM" ? "attn" : "wait"}`}>{g.leads.length} · {confidenceLabel(g.c, t)}</span>)}</p>
              <p className="src" style={{ margin: "0 0 12px" }}>{t("La confianza dice qué tan seguro es que ESE vendedor tiene ESTA pieza. No califica al vendedor ni su precio. Lo que se ve en una página es una referencia: la oferta real es la que el vendedor te confirme.", "Confidence says how sure it is that THAT seller has THIS piece. It does not rate the seller or the price. What a page shows is a reference: the real offer is what the seller confirms to you.")}</p>
              {groups.map((g) => (
                <section key={g.c} className="jblock loc-sec">
                  <div className="jbh"><b>{confidenceLabel(g.c, t).toUpperCase()}</b><span className="grow" /><span className="src">{HINT[g.c]}</span></div>
                  <div className="loc-list">
                    {g.leads.map((l) => (
                      <WebLeadCard key={l.id} l={l} t={t} n2={i.n2} mailedAt={mailed.get(l.id)} day={i.day} openContact={sp.l === l.id && !!sp.err?.startsWith("contacto")}>
                        {l.deal ? (
                          <p className="wl-saved">
                            <span className="sig ok">{l.supplier ? t("Es la fuente de la Necesidad", "It is the Need's source") : t("Guardada", "Saved")}</span>{" "}
                            <Link href={`/deals/${l.deal.id}?tab=source#internet`}>{l.deal.code ?? t("la Necesidad", "the Need")} · {l.deal.title}</Link>
                            {l.supplier && <> · <Link href={`/suppliers/${l.supplier.id}`}>{t(`proveedor ${l.supplier.name}`, `supplier ${l.supplier.name}`)}</Link></>}
                          </p>
                        ) : needs.length === 0 ? (
                          <p className="src wl-saved">{t("Para guardar esta opción necesitas una Necesidad abierta a tu nombre.", "To save this option you need an open Need in your name.")} <Link href="/deals">{t("Ir a Necesidades", "Go to Needs")}</Link></p>
                        ) : (
                          <form action={saveLead.bind(null, l.id)} className="wl-save">
                            <label className={sp.err === "necesidad" && sp.l === l.id ? "req-miss" : undefined}>{t("Guardar en la Necesidad", "Save on the Need")}
                              <select name="dealId" defaultValue={hunt.dealId ?? ""}>
                                <option value="">{t("Elige una Necesidad…", "Pick a Need…")}</option>
                                {needs.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                              </select>
                            </label>
                            <button type="submit" name="intent" value="save" className="secondary">{t("Guardar opción", "Save option")}</button>
                            <button type="submit" name="intent" value="source">{t("Guardar y usar como fuente", "Save and use as source")}</button>
                          </form>
                        )}
                      </WebLeadCard>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {questions.length > 0 && aiState === "ON" && (
            <section className="jblock loc-sec" id="afinar">
              <div className="jbh"><b>{t("PREGUNTAS QUE AFINARÍAN LA BÚSQUEDA", "QUESTIONS THAT WOULD SHARPEN THE SEARCH")}</b><span className="grow" /><span className="src">{t("opcional: responde las que sepas", "optional: answer the ones you know")}</span></div>
              <form action={startHunt} className="wl-form">
                <input type="hidden" name="q" value={hunt.query} />
                {hunt.dealId && <input type="hidden" name="deal" value={hunt.dealId} />}
                {hunt.partId && <input type="hidden" name="part" value={hunt.partId} />}
                {(["brand", "qty", "country", "details"] as const).map((k) => answers[k] ? <input key={k} type="hidden" name={k} value={answers[k]} /> : null)}
                <input type="hidden" name="condition" value={answers.condition ?? "NEW"} />
                <input type="hidden" name="equivalents" value={answers.equivalents ? "1" : "0"} />
                {questions.map((q, n) => (
                  <label key={n} className="wide">{q}<input type="hidden" name={`qq_${n}`} value={q} /><input name={`qa_${n}`} maxLength={200} /></label>
                ))}
                <div className="wide wl-go"><button type="submit" className="secondary">{t("Buscar otra vez con estas respuestas", "Search again with these answers")}</button><span className="src">{t("Es una búsqueda nueva: vuelve a tardar de 1 a 3 minutos.", "It is a new search: it takes 1 to 3 minutes again.")}</span></div>
              </form>
            </section>
          )}

          <details className="qa" style={{ marginTop: 12 }}>
            <summary className="qa-btn">{t("Buscar otra vez cambiando las respuestas", "Search again with different answers")}</summary>
            <div style={{ marginTop: 10 }}><HuntForm t={t} q={hunt.query} dealId={hunt.dealId} partId={hunt.partId} needs={needs} answers={answers} showQuery state={aiState} cap={cap} /></div>
          </details>
        </>
      )}
    </>
  );
}
