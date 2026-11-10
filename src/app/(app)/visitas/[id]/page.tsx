import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { OBJECTIVE_CATS, VISIT_STATUS, readObjectives, visitBrief } from "@/lib/visits";
import { ValueKindSelect } from "@/components/ValueKindSelect";
import { cancelVisit, closeCommitment, recordOutcome } from "../actions";

// Comercial C8a · one visit: the brief (derived, nothing re-typed), the objectives, and the outcome the person confirms.

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const v = await db.visitPlan.findUnique({ where: { id }, include: { account: { select: { id: true, name: true } }, owner: { select: { name: true } }, mission: { select: { title: true } }, commitments: { orderBy: { createdAt: "asc" } } } });
  if (!v) notFound();
  const editable = canEdit(user, v.ownerId);
  const b = await visitBrief(v.accountId, v.id);
  const objs = readObjectives(v.objectives);
  const met = Array.isArray(v.objectivesMet) ? (v.objectivesMet as boolean[]) : [];
  const money = (x: unknown) => i.money(x);
  const now = today();
  const ownDeals = await db.deal.findMany({ where: { id: { in: v.commitments.map((c) => c.dealId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true } });

  const okMsg: Record<string, string> = {
    planeada: t("Visita planeada. Abajo está el contexto que SOLU ya tiene del cliente.", "Visit planned. Below is the context SOLU already has on the customer."),
    "sin-plan": t("Visita registrada. Cuenta lo que pasó en «Cómo fue».", "Visit recorded. Tell what happened in «How it went»."),
    hecha: t("Visita cerrada. Quedó en el historial del cliente.", "Visit closed. It's in the customer's history."),
    "hecha-need": t("Visita cerrada y la necesidad nueva quedó como Journey.", "Visit closed and the new need is now a Journey."),
    cancelada: t("Visita cancelada.", "Visit cancelled."), compromiso: t("Compromiso actualizado.", "Commitment updated."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Solo quien hace la visita o la dirección la actualizan.", "Only whoever makes the visit or management update it."),
    aprendido: t("Escribe qué aprendiste: es lo más valioso de la visita.", "Write what you learned: it's the most valuable part of the visit."),
    necesidad: t("Para crear la necesidad, escribe qué resultado busca el cliente.", "To create the need, write what result the customer is after."),
    motivo: t("Escribe el motivo.", "Write the reason."), cerrada: t("Esta visita ya está cerrada.", "This visit is already closed."),
  };

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/visitas">{t("Visitas", "Visits")}</Link> · <Link href={`/accounts/${v.account.id}`}>{v.account.name}</Link>{v.mission && <> · {v.mission.title}</>}</p>
          <span className="grow" />
          <span className={`sig ${v.status === "DONE" ? "ok" : v.status === "CANCELLED" ? "wait" : "attn"}`}>{t(VISIT_STATUS[v.status].es, VISIT_STATUS[v.status].en)}</span>
        </div>
        <div className="jh-title"><h1>{t(`Visita a ${v.account.name}`, `Visit to ${v.account.name}`)}</h1></div>
        <p className="jh-sub">{i.date(v.happenedAt ?? v.plannedAt)} · {v.owner.name}{v.unplanned ? ` · ${t("sin planear", "unplanned")}` : ""}{v.meetWith ? ` · ${t("con", "with")} ${v.meetWith}` : ""}</p>
      </header>

      <section className="jblock">
        <div className="jbh"><b>{t("PARA QUÉ VAMOS", "WHAT WE'RE GOING FOR")}</b></div>
        <ul className="mk-ul">{objs.map((o, k) => <li key={k}>{v.status === "DONE" && <span className={`sig ${met[k] ? "ok" : "wait"}`}>{met[k] ? t("logrado", "met") : t("no logrado", "not met")}</span>} <b>{t(OBJECTIVE_CATS[o.cat].es, OBJECTIVE_CATS[o.cat].en)}</b>{o.text && ` — ${o.text}`}</li>)}</ul>
      </section>

      <section className="jblock" id="brief">
        <div className="jbh"><b>{t("LO QUE YA SABEMOS DEL CLIENTE", "WHAT WE ALREADY KNOW ABOUT THE CUSTOMER")}</b><span className="grow" /><span className="src">{t("Armado de SOLU, sin volver a escribir", "Built from SOLU, no re-typing")}</span></div>
        <div className="exc-grid">
          <dl className="qv-dl tight">
            <dt>{t("Contactos", "Contacts")}</dt><dd className="small">{b.account.contacts.length === 0 ? "—" : b.account.contacts.map((c) => <span key={c.id} className="block">{c.firstName} {c.lastName}{c.title ? ` · ${c.title}` : ""}{c.phone ? ` · ${c.phone}` : ""}</span>)}</dd>
            <dt>{t("Plantas", "Plants")}</dt><dd className="small">{b.account.plants.length === 0 ? "—" : b.account.plants.map((p) => `${p.name}${p.city ? ` (${p.city})` : ""}`).join(" · ")}</dd>
            <dt>{t("Cartera abierta", "Open receivables")}</dt><dd className="mono">{money(b.ar.open)}{b.ar.overdueCount > 0 && <span className="risk-t"> · {t(`${money(b.ar.overdue)} vencida`, `${money(b.ar.overdue)} overdue`)}</span>}</dd>
            <dt>{t("Bloqueos de caja", "Cash blockers")}</dt><dd className="small">{b.blockers.length === 0 ? t("Ninguno", "None") : b.blockers.map((x) => <span key={x.id} className="block"><Link href={`/deals/${x.deal.id}`}>{x.deal.code ?? x.deal.title}</Link> · {money(x.blockedValue)} · {x.narrative}</span>)}</dd>
          </dl>
          <dl className="qv-dl tight">
            <dt>{t("Necesidades abiertas", "Open needs")}</dt><dd className="small">{b.deals.length === 0 ? "—" : b.deals.map((d) => <span key={d.id} className="block"><Link href={`/deals/${d.id}`}>{d.code ?? d.title}</Link> · {d.title}{d.nextMove ? ` → ${d.nextMove}` : ""}</span>)}</dd>
            <dt>{t("Cotizaciones esperando decisión", "Quotes awaiting decision")}</dt><dd className="small">{b.quotes.length === 0 ? "—" : b.quotes.map((q) => <span key={q.id} className="block"><Link href={`/cotizaciones/${q.id}`}>Nº {q.number}{q.rev ? `-R${q.rev}` : ""}</Link> · {money(q.protSale)}{q.protSale && Number(q.protSale) > 0 ? ` · Eságara ${money(q.protEsagra)} (${i.pct((Number(q.protEsagra) / Number(q.protSale)) * 100)})` : ""}{q.decisionAt ? ` · ${t("decide", "decides")} ${i.day(q.decisionAt)}` : ""}</span>)}</dd>
            <dt>{t("POs en ejecución", "POs in progress")}</dt><dd className="small">{b.pos.length === 0 ? "—" : b.pos.map((p) => <span key={p.id} className="block"><Link href={`/po/${p.id}`}>PO {p.number}</Link> · {p.deal.title}{p.deal.promisedDate ? ` · ${t("promesa", "promise")} ${i.day(p.deal.promisedDate)}` : ""}</span>)}</dd>
            <dt>{t("Compromisos anteriores", "Earlier commitments")}</dt><dd className="small">{b.commitments.length === 0 ? "—" : b.commitments.map((c) => <span key={c.id} className="block">{c.side === "US" ? t("Nosotros", "Us") : t("Cliente", "Customer")}: {c.what}{c.dueAt ? ` · ${i.day(c.dueAt)}` : ""}</span>)}</dd>
            <dt>{t("Futuro visible", "Visible future")}</dt><dd className="small">{b.futures.length === 0 ? "—" : b.futures.map((f) => <span key={f.id} className="block">{f.description}{f.expectedAt ? ` · ${i.day(f.expectedAt)}` : ""}</span>)}</dd>
          </dl>
        </div>
        {b.lastVisits.length > 0 && <p className="src">{t("Visitas anteriores", "Earlier visits")}: {b.lastVisits.map((x) => `${i.day(x.happenedAt)} (${x.owner.name}): ${(x.learned ?? "").slice(0, 100)}`).join(" · ")}</p>}
      </section>

      {v.status === "DONE" && (
        <section className="jblock">
          <div className="jbh"><b>{t("CÓMO FUE", "HOW IT WENT")}</b></div>
          <p className="pre">{v.learned}</p>
          {v.nextMove && <p className="small"><b>{t("Próximo paso", "Next step")}:</b> {v.nextMove}{v.nextMoveDate && ` · ${i.day(v.nextMoveDate)}`}</p>}
          {ownDeals.map((d) => <p key={d.id} className="small">{t("Necesidad creada", "Need created")}: <Link href={`/deals/${d.id}`}>{d.code ?? d.title}</Link> · {d.title}</p>)}
        </section>
      )}
      {v.status === "CANCELLED" && <section className="jblock"><p className="small">{t("Cancelada", "Cancelled")}: {v.cancelReason}</p></section>}

      {v.commitments.length > 0 && (
        <section className="jblock">
          <div className="jbh"><b>{t("COMPROMISOS", "COMMITMENTS")}</b></div>
          {v.commitments.map((c) => (
            <div key={c.id} className="frow" style={{ marginBottom: 6 }}>
              <span className={`sig ${c.side === "US" ? "attn" : "wait"}`}>{c.side === "US" ? t("Nosotros", "Us") : t("Cliente", "Customer")}</span>
              <span>{c.what}{c.dueAt && <span className={c.status === "OPEN" && c.dueAt < now ? "risk-t" : "muted"}> · {i.day(c.dueAt)}</span>}</span>
              <span className="grow" />
              {c.status !== "OPEN" ? <span className="src">{c.status === "KEPT" ? t("cumplido", "kept") : t("descartado", "dropped")}{c.closedNote ? ` · ${c.closedNote}` : ""}</span> : editable && (
                <details className="qa"><summary className="qa-btn">{t("Cerrar", "Close")}</summary>
                  <div className="qa-pop right">
                    <form action={closeCommitment.bind(null, c.id)} className="qa-form">
                      <select name="status" defaultValue="KEPT"><option value="KEPT">{t("Cumplido", "Kept")}</option><option value="DROPPED">{t("Descartado", "Dropped")}</option></select>
                      <input name="closedNote" maxLength={300} placeholder={t("Nota (obligatoria si se descarta)", "Note (required if dropped)")} />
                      <button type="submit">{t("Guardar", "Save")}</button>
                    </form>
                  </div>
                </details>
              )}
            </div>
          ))}
        </section>
      )}

      {v.status === "PLANNED" && editable && (
        <section className="jblock" id="resultado">
          <div className="jbh"><b>{t("CÓMO FUE · CERRAR LA VISITA", "HOW IT WENT · CLOSE THE VISIT")}</b></div>
          <form action={recordOutcome.bind(null, v.id)} className="qa-form">
            <div className="qa-row"><label>{t("Fecha en que ocurrió", "Date it happened")}<input name="happenedAt" type="date" defaultValue={dayInput(v.plannedAt && v.plannedAt < now ? v.plannedAt : now)} /></label></div>
            <label>{t("¿Qué aprendiste?", "What did you learn?")}<textarea name="learned" rows={3} required maxLength={2000} /></label>
            {objs.length > 0 && <div className="qa-row" style={{ flexWrap: "wrap" }}>{objs.map((o, k) => <label key={k} className="chk"><input type="checkbox" name={`met_${k}`} value="1" /> {t("Logrado", "Met")}: {t(OBJECTIVE_CATS[o.cat].es, OBJECTIVE_CATS[o.cat].en)}</label>)}</div>}
            <ValueKindSelect es={i.es} />
            <b className="small">{t("Compromisos (de los dos lados)", "Commitments (both sides)")}</b>
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="qa-row">
                <select name={`side_${k}`} defaultValue={k % 2 ? "CUSTOMER" : "US"} style={{ flex: "0 0 120px" }} aria-label={t("Quién", "Who")}><option value="US">{t("Nosotros", "Us")}</option><option value="CUSTOMER">{t("Cliente", "Customer")}</option></select>
                <input name={`what_${k}`} maxLength={300} placeholder={t("Qué se comprometió", "What was committed")} aria-label={t("Compromiso", "Commitment")} />
                <input name={`due_${k}`} type="date" aria-label={t("Para cuándo", "By when")} />
              </div>
            ))}
            <details><summary className="small">{t("¿Apareció una necesidad nueva?", "Did a new need come up?")}</summary>
              <label>{t("Nombre corto", "Short name")}<input name="needTitle" maxLength={200} placeholder={t("Ej.: Variadores para la línea 3", "E.g.: Drives for line 3")} /></label>
              <label>{t("Resultado que busca el cliente", "Result the customer is after")}<input name="needResult" maxLength={600} /></label>
              <span className="src block">{t("Se crea como Journey a tu nombre solo si lo escribes aquí.", "It's created as a Journey in your name only if you write it here.")}</span>
            </details>
            <div className="qa-row">
              <label>{t("Próximo paso", "Next step")}<input name="nextMove" maxLength={300} /></label>
              <label style={{ flex: "0 0 auto" }}>{t("Fecha", "Date")}<input name="nextMoveDate" type="date" /></label>
            </div>
            <button type="submit">{t("Cerrar la visita", "Close the visit")}</button>
          </form>
          <details style={{ marginTop: 10 }}><summary className="small">{t("Cancelar la visita", "Cancel the visit")}</summary>
            <form action={cancelVisit.bind(null, v.id)} className="qa-form"><input name="cancelReason" required maxLength={300} placeholder={t("Motivo", "Reason")} /><button type="submit" className="secondary">{t("Cancelar visita", "Cancel visit")}</button></form>
          </details>
        </section>
      )}

    </div>
  );
}
