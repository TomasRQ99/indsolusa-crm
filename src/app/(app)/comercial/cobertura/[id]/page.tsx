import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/domain";
import { SCAN_KINDS, coverageScan, handBack, isActive, returnBrief, type Handover, type ScanItem } from "@/lib/coverage";
import { HANDOVER_CLASSES, HANDOVER_ORDER, classifyHandover, classifyJourney } from "@/lib/team-rules";
import { returnOwnership, revokeCoverage } from "../actions";

// Comercial C8b · one coverage: the delegated authority and its window, the handover snapshot, what is due now,
// and the Return Brief for the owner when they come back.

export default async function CoverageDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.coverageAssignment.findUnique({ where: { id }, include: { originalUser: { select: { id: true, name: true } }, actingUser: { select: { id: true, name: true } } } });
  if (!c) notFound();
  const involved = canManageAll(user) || user.id === c.originalUserId || user.id === c.actingUserId;
  if (!involved) notFound();
  const now = new Date();
  const active = isActive(c, now);
  const ended = !!c.revokedAt || c.endsAt <= now;
  const started = c.startsAt <= now;
  const h = c.handover as unknown as Partial<Handover>;
  const live = !ended ? await coverageScan(c.originalUserId, addDays(today(), 2)) : null;
  const back = started ? await returnBrief(c.originalUserId, c.startsAt, c.revokedAt ?? (c.endsAt < now ? c.endsAt : now)) : null;
  // Módulo 16 §8: the handover by class. A snapshot taken before classes existed is classified on reading.
  const hItems = (h.items ?? []).map((x) => ({ ...x, cls: x.cls ?? classifyHandover(x, c.endsAt) }));
  const hJourneys = (h.openJourneys ?? []).map((j) => ({ ...j, cls: (j as { cls?: (typeof HANDOVER_ORDER)[number] }).cls ?? classifyJourney(j.nextMoveDate, c.endsAt) })).filter((j) => !hItems.some((x) => x.href === `/deals/${j.id}`));
  const toReturn = ended ? await handBack(c) : [];
  const mayReturn = canManageAll(user) || user.id === c.originalUserId;
  const okMsg: Record<string, string> = { devuelto: t("Listo. Los pendientes abiertos a nombre de quien cubría volvieron a su dueño.", "Done. The to-dos opened in the name of whoever covered are back with their owner."), creada: t("Cobertura creada. Quien cubre ya ve la entrega de turno.", "Coverage created. The person covering can already see the handover."), terminada: t("Cobertura terminada. El permiso ya no aplica.", "Coverage ended. The permission no longer applies.") };
  const errMsg: Record<string, string> = { "regreso-permiso": t("El regreso lo confirma quien estuvo ausente, o la dirección.", "The return is confirmed by whoever was away, or by management."), "regreso-activa": t("La cobertura sigue activa: termínala primero.", "The coverage is still active: end it first."), permiso: t("Solo la dirección, quien se ausenta o quien cubre la terminan.", "Only management, the absent person or the person covering end it.") };

  const Items = ({ rows }: { rows: ScanItem[] }) => rows.length === 0 ? <p className="small muted"><span className="sig ok">{t("Nada pendiente.", "Nothing pending.")}</span></p> : (
    <div className="tscroll"><table>
      <thead><tr><th>{t("Cuándo", "When")}</th><th>{t("Qué", "What")}</th><th>{t("Cliente", "Customer")}</th><th>{t("Detalle", "Detail")}</th></tr></thead>
      <tbody>{rows.map((s, k) => { const at = s.at ? new Date(s.at) : null; return <tr key={k}><td className={`mono small${at && at < today() ? " risk-t" : ""}`}>{at ? i.day(at) : "—"}</td><td className="small">{t(SCAN_KINDS[s.kind]?.es ?? s.kind, SCAN_KINDS[s.kind]?.en ?? s.kind)}</td><td className="small">{s.account ?? "—"}</td><td className="small"><Link href={s.href}>{s.label}</Link>{s.amount != null && <span className="mono"> · {i.money2(s.amount)}</span>}</td></tr>; })}</tbody>
    </table></div>
  );

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/comercial/cobertura">{t("Cobertura por ausencia", "Absence coverage")}</Link></p>
          <span className="grow" />
          <span className={`sig ${active ? "attn" : ended ? "wait" : "info"}`}>{c.revokedAt ? t("Terminada antes", "Ended early") : active ? t("Activa", "Active") : ended ? t("Vencida", "Expired") : t("Programada", "Scheduled")}</span>
          {c.kind === "EMERGENCY" && <span className="sig risk">{t("Emergencia", "Emergency")}</span>}
        </div>
        <div className="jh-title"><h1>{t(`${c.actingUser.name} cubre a ${c.originalUser.name}`, `${c.actingUser.name} covers ${c.originalUser.name}`)}</h1></div>
        <p className="jh-sub">{i.date(c.startsAt)} – {i.date(addDays(c.endsAt, -1))} · {c.reason} · {t(`creada por ${c.createdByName}`, `created by ${c.createdByName}`)}{c.revokedAt ? ` · ${t(`terminada por ${c.revokedByName} el ${i.day(c.revokedAt)}`, `ended by ${c.revokedByName} on ${i.day(c.revokedAt)}`)}` : ""}</p>
      </header>

      <section className="jblock">
        <div className="jbh"><b>{t("AUTORIDAD TEMPORAL", "TEMPORARY AUTHORITY")}</b><span className="grow" />{!ended && <form action={revokeCoverage.bind(null, c.id)}><button type="submit" className="secondary">{t("Terminar ahora", "End now")}</button></form>}</div>
        <ul className="mk-ul small">
          <li>{t(`Mientras esté activa, ${c.actingUser.name} puede actuar en los Journeys de ${c.originalUser.name}: hechos, próximos pasos, cotizaciones, POs, despacho y cobro.`, `While active, ${c.actingUser.name} can act on ${c.originalUser.name}'s Journeys: facts, next steps, quotes, POs, dispatch and collection.`)}</li>
          <li>{t("No se delegan aprobaciones por rol: excepciones de Eságara, crédito y pagos siguen con quien las tiene.", "Role approvals aren't delegated: Eságara exceptions, credit and payments stay with whoever holds them.")}</li>
          <li>{t(`Vence sola al terminar el ${i.date(addDays(c.endsAt, -1))}. ${c.originalUser.name} sigue siendo responsable.`, `Expires by itself at the end of ${i.date(addDays(c.endsAt, -1))}. ${c.originalUser.name} stays accountable.`)}</li>
        </ul>
        {c.scopeNote && <p className="small"><b>{t("Qué cubre", "What it covers")}:</b> {c.scopeNote}</p>}
        {c.instructions && <p className="pre small"><b>{t("Instrucciones", "Instructions")}:</b> {c.instructions}</p>}
      </section>

      {live && (
        <section className="jblock">
          <div className="jbh"><b>{t("LO QUE NO PUEDE ESPERAR (HOY Y 2 DÍAS)", "WHAT CAN'T WAIT (TODAY AND 2 DAYS)")}</b></div>
          <Items rows={live} />
        </section>
      )}

      <details className="jblock" open={!started}>
        <summary className="jbh"><b>{t("ENTREGA DE TURNO", "HANDOVER")}</b><span className="grow" /><span className="src">{h.takenAt ? t(`Foto del ${i.day(new Date(h.takenAt))}`, `Snapshot of ${i.day(new Date(h.takenAt))}`) : ""}</span></summary>
        {hItems.length + hJourneys.length === 0 ? <p className="small muted"><span className="sig ok">{t("Nada pendiente.", "Nothing pending.")}</span></p> : HANDOVER_ORDER.map((cls) => { const rows = hItems.filter((x) => x.cls === cls), js = hJourneys.filter((j) => j.cls === cls); if (!rows.length && !js.length) return null; const k = HANDOVER_CLASSES[cls]; return (
          <div key={cls} id={`h-${cls}`} style={{ marginTop: 10 }}>
            <p className="small"><span className={`sig ${k.tone}`}>{t(k.es, k.en)}</span> <b>{rows.length + js.length}</b> <span className="muted">· {t(k.hint.es, k.hint.en)}</span></p>
            {rows.length > 0 && <Items rows={rows} />}
            {js.length > 0 && <ul className="mk-ul small">{js.map((j) => <li key={j.id}><Link href={`/deals/${j.id}`}>{j.label}</Link> · {j.account}{j.nextMove ? ` → ${j.nextMove}` : ""}{j.nextMoveDate ? ` · ${i.day(new Date(j.nextMoveDate))}` : ""}</li>)}</ul>}
          </div>
        ); })}
      </details>

      {back && (
        <section className="jblock" id="regreso">
          <div className="jbh"><b>{t("AL REGRESAR: QUÉ PASÓ MIENTRAS NO ESTABAS", "ON RETURN: WHAT HAPPENED WHILE YOU WERE AWAY")}</b></div>
          {back.activities.length + back.decided.length + back.pos.length + back.newDeals.length === 0 ? <p className="small muted">{t("Nadie registró movimientos en tus Journeys durante la cobertura.", "Nobody logged movements on your Journeys during the coverage.")}</p> : (
            <ul className="mk-ul small">
              {back.decided.map((q) => <li key={q.id}>{q.status === "ACCEPTED" ? t("Aceptada", "Accepted") : t("Rechazada", "Declined")}: <Link href={`/cotizaciones/${q.id}`}>Quote Nº {q.number}{q.rev ? `-R${q.rev}` : ""}</Link> · {q.deal.title}</li>)}
              {back.pos.map((p) => <li key={p.id}>{t("PO recibida", "PO received")}: <Link href={`/po/${p.id}`}>{p.number}</Link> · {p.deal.title}</li>)}
              {back.newDeals.map((d) => <li key={d.id}>{t("Journey nuevo", "New Journey")}: <Link href={`/deals/${d.id}`}>{d.code ?? d.title}</Link> · {d.title}</li>)}
              {back.activities.map((a) => <li key={a.id}>{i.day(a.occurredAt)} · {a.user.name}: {a.subject}{a.dealId && <> · <Link href={`/deals/${a.dealId}`}>{a.deal?.code ?? a.deal?.title}</Link></>}</li>)}
            </ul>
          )}
          {ended && (
            <div style={{ marginTop: 10 }}>
              <p className="small"><b>{t("Trabajo que vuelve a su dueño", "Work that goes back to its owner")}</b> <span className="muted">· {t(`${c.originalUser.name} nunca dejó de ser responsable de sus Journeys y clientes; lo único que cambió de manos son los pendientes abiertos a nombre de ${c.actingUser.name}.`, `${c.originalUser.name} never stopped being accountable for their Journeys and customers; the only thing that changed hands are the to-dos opened in ${c.actingUser.name}'s name.`)}</span></p>
              {c.returnedAt ? <p className="small"><span className="sig ok">{t("Regreso confirmado", "Return confirmed")}</span> {i.date(c.returnedAt)} · {c.returnedByName}{c.returnNote ? ` · ${c.returnNote}` : ""}</p> : (
                <>
                  {toReturn.length === 0 ? <p className="small muted">{t("No quedó ningún pendiente abierto a nombre de quien cubría.", "No to-do was left open in the name of whoever covered.")}</p> : <ul className="mk-ul small">{toReturn.map((x) => <li key={x.id}>{x.title}{x.dueDate ? ` · ${i.day(x.dueDate)}` : ""}{x.dealId ? <> · <Link href={`/deals/${x.dealId}`}>{x.deal?.code ?? x.deal?.title}</Link></> : null}</li>)}</ul>}
                  {mayReturn && (
                    <form action={returnOwnership.bind(null, c.id)} className="qa-form" style={{ marginTop: 6 }}>
                      {toReturn.length > 0 && <label className="chk"><input type="checkbox" name="keep" value="1" /> {t(`Dejar esos pendientes con ${c.actingUser.name}`, `Leave those to-dos with ${c.actingUser.name}`)}</label>}
                      <label>{t("Nota (opcional)", "Note (optional)")}<input name="note" maxLength={300} /></label>
                      <div><button type="submit">{toReturn.length ? t("Ya lo leí: recibir mi trabajo de vuelta", "I have read it: take my work back") : t("Ya lo leí: confirmar el regreso", "I have read it: confirm the return")}</button></div>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
