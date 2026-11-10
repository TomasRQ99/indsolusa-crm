import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/domain";
import { SCAN_KINDS, coverageScan, isActive, returnBrief, type Handover, type ScanItem } from "@/lib/coverage";
import { revokeCoverage } from "../actions";

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
  const okMsg: Record<string, string> = { creada: t("Cobertura creada. Quien cubre ya ve la entrega de turno.", "Coverage created. The person covering can already see the handover."), terminada: t("Cobertura terminada. El permiso ya no aplica.", "Coverage ended. The permission no longer applies.") };
  const errMsg: Record<string, string> = { permiso: t("Solo la dirección, quien se ausenta o quien cubre la terminan.", "Only management, the absent person or the person covering end it.") };

  const Items = ({ rows }: { rows: ScanItem[] }) => rows.length === 0 ? <p className="small muted">{t("Nada pendiente.", "Nothing pending.")}</p> : (
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
        <p className="small"><b>{t("Pendiente durante la ausencia", "Due during the absence")}</b></p>
        <Items rows={h.items ?? []} />
        <p className="small" style={{ marginTop: 10 }}><b>{t("Journeys abiertos", "Open Journeys")}</b></p>
        {(h.openJourneys ?? []).length === 0 ? <p className="small muted">—</p> : <ul className="mk-ul small">{(h.openJourneys ?? []).map((j) => <li key={j.id}><Link href={`/deals/${j.id}`}>{j.label}</Link> · {j.account}{j.nextMove ? ` → ${j.nextMove}` : ""}{j.nextMoveDate ? ` · ${i.day(new Date(j.nextMoveDate))}` : ""}</li>)}</ul>}
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
        </section>
      )}
    </div>
  );
}
