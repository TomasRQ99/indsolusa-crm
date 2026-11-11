import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today, addDays } from "@/lib/domain";
import { COVERAGE_MAX_DAYS, SCAN_KINDS, coverageScan, isActive, scanHorizon } from "@/lib/coverage";
import { createCoverage, setBackup } from "./actions";

// Comercial C8b · Absence Coverage (v1.3 §59): arrange cover, see who covers whom, run the emergency scan,
// and name a relationship backup per customer. The original owner stays accountable.

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; scan?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const now = new Date();
  const people = await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const list = await db.coverageAssignment.findMany({
    where: { endsAt: { gte: addDays(today(), -30) }, ...(manage ? {} : { OR: [{ originalUserId: user.id }, { actingUserId: user.id }] }) },
    orderBy: { startsAt: "desc" }, include: { originalUser: { select: { name: true } }, actingUser: { select: { name: true } } },
  });
  // Módulo 14 §15: approved absences (kept by Administración) that nobody covers yet. The kind of absence is not shown here.
  const absences = await db.absenceRecord.findMany({ where: { status: "APPROVED", endsOn: { gte: today() }, startsOn: { lte: addDays(today(), 45) }, ...(manage ? {} : { userId: user.id }) }, orderBy: { startsOn: "asc" }, select: { id: true, userId: true, startsOn: true, endsOn: true, user: { select: { name: true } } } });
  const uncovered = absences.filter((a) => !list.some((c) => !c.revokedAt && c.originalUserId === a.userId && c.startsAt <= a.endsOn && a.startsOn < c.endsAt));
  const scanFor = manage && sp.scan && people.some((p) => p.id === sp.scan) ? sp.scan : null;
  const scan = scanFor ? await coverageScan(scanFor, scanHorizon()) : null;
  const accounts = await db.account.findMany({ where: { ownerId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, backup: { select: { backupUserId: true, note: true } } } });
  const okMsg: Record<string, string> = { respaldo: t("Respaldo de relación guardado.", "Relationship backup saved.") };
  const errMsg: Record<string, string> = {
    persona: t("Elige a otra persona activa para cubrir.", "Pick another active person to cover."),
    permiso: t("Solo la dirección asigna coberturas de emergencia o de otras personas.", "Only management assigns emergency coverage or coverage for others."),
    fechas: t("Revisa las fechas: el fin no puede ser antes del inicio.", "Check the dates: the end can't be before the start."),
    pasado: t("La cobertura ya habría terminado.", "The coverage would already be over."),
    largo: t(`Una cobertura dura como máximo ${COVERAGE_MAX_DAYS} días; para más, cambia el dueño del cliente.`, `A coverage lasts at most ${COVERAGE_MAX_DAYS} days; for longer, change the customer's owner.`),
    motivo: t("Escribe el motivo de la ausencia.", "Write the reason for the absence."),
    mismo: t("El respaldo debe ser otra persona.", "The backup must be someone else."),
    cobertura: t("Esa cobertura no existe.", "That coverage doesn't exist."), cliente: t("Ese cliente no existe.", "That customer doesn't exist."),
  };
  const backupCount = new Map<string, number>();
  for (const a of accounts) if (a.backup) backupCount.set(a.backup.backupUserId, (backupCount.get(a.backup.backupUserId) ?? 0) + 1);
  const suggested = [...backupCount.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${people.find((p) => p.id === id)?.name ?? "—"} (${n})`);
  const state = (c: (typeof list)[number]) => c.revokedAt ? ["Terminada antes", "Ended early", "wait"] : isActive(c, now) ? ["Activa", "Active", "attn"] : c.startsAt > now ? ["Programada", "Scheduled", "info"] : ["Vencida", "Expired", "wait"];

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Cobertura por ausencia", "Absence coverage")}</h1>
          <p>{t("Cuando alguien no está, otra persona actúa sobre sus Journeys por un tiempo definido. El dueño sigue siendo responsable; el permiso vence solo. Las aprobaciones por rol (Eságara, crédito, pagos) nunca se delegan.", "When someone is away, another person acts on their Journeys for a set time. The owner stays accountable; the permission expires by itself. Role approvals (Eságara, credit, payments) are never delegated.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {uncovered.length > 0 && <div className="note attn">{t("Ausencias aprobadas sin nadie que cubra:", "Approved absences with nobody covering:")} {uncovered.map((a) => <span key={a.id} style={{ marginRight: 12 }}><b>{a.user.name}</b> {i.day(a.startsOn)} – {i.day(a.endsOn)}</span>)}</div>}
      {user.covering.length > 0 && <div className="note attn">{t(`Hoy estás cubriendo a ${people.filter((p) => user.covering.includes(p.id)).map((p) => p.name).join(", ")}: puedes actuar en sus Journeys hasta que termine la cobertura.`, `Today you're covering ${people.filter((p) => user.covering.includes(p.id)).map((p) => p.name).join(", ")}: you can act on their Journeys until the coverage ends.`)}</div>}

      <section className="card" id="coberturas">
        <div className="jbh"><b>{t("Coberturas", "Coverages")}</b><span className="grow" />
          <details className="qa" open={!!sp.err && ["persona", "fechas", "pasado", "largo", "motivo"].includes(sp.err)}><summary className="qa-btn">{t("+ Pedir cobertura", "+ Arrange coverage")}</summary>
            <div className="qa-pop wide right">
              <form action={createCoverage} className="qa-form">
                {manage ? <label>{t("Quién estará ausente", "Who will be away")}<select name="originalUserId" defaultValue={scanFor ?? user.id}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : <p className="small">{t("Para tu ausencia.", "For your absence.")}</p>}
                <label>{t("Quién cubre", "Who covers")}<select name="actingUserId" required defaultValue=""><option value="" disabled>{t("Elige…", "Choose…")}</option>{people.filter((p) => p.id !== user.id || manage).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                {suggested.length > 0 && <span className="src block">{t(`Respaldo de tus clientes: ${suggested.join(", ")}`, `Backup for your customers: ${suggested.join(", ")}`)}</span>}
                <div className="qa-row">
                  <label>{t("Desde", "From")}<input name="from" type="date" defaultValue={dayInput(today())} /></label>
                  <label>{t("Hasta (incluido)", "Until (included)")}<input name="to" type="date" required /></label>
                </div>
                {manage && <label className="chk"><input type="checkbox" name="kind" value="EMERGENCY" defaultChecked={!!scanFor} /> {t("Emergencia (empieza hoy, sin aviso previo)", "Emergency (starts today, no prior notice)")}</label>}
                <label>{t("Motivo", "Reason")}<input name="reason" required maxLength={300} placeholder={t("Ej.: vacaciones, incapacidad, viaje", "E.g.: vacation, sick leave, travel")} /></label>
                <label>{t("Instrucciones para quien cubre (opcional)", "Instructions for the person covering (optional)")}<textarea name="instructions" rows={3} maxLength={1500} /></label>
                <span className="src block">{t("Al crearla, SOLU guarda una foto de lo pendiente (entrega de turno) para quien cubre.", "When created, SOLU keeps a snapshot of what's pending (handover) for the person covering.")}</span>
                <button type="submit">{t("Crear cobertura", "Create coverage")}</button>
              </form>
            </div>
          </details>
        </div>
        {list.length === 0 ? <p className="small muted">{t("No hay coberturas recientes.", "No recent coverages.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Ausente", "Away")}</th><th>{t("Cubre", "Covers")}</th><th>{t("Ventana", "Window")}</th><th>{t("Estado", "Status")}</th><th>{t("Motivo", "Reason")}</th></tr></thead>
            <tbody>{list.map((c) => { const [es, en, tone] = state(c); return (
              <tr key={c.id}><td><Link href={`/comercial/cobertura/${c.id}`}>{c.originalUser.name}</Link></td><td>{c.actingUser.name}</td><td className="mono small">{i.day(c.startsAt)} – {i.day(addDays(c.endsAt, -1))}</td><td><span className={`sig ${tone}`}>{t(es, en)}</span>{c.kind === "EMERGENCY" && <span className="sig risk" style={{ marginLeft: 4 }}>{t("emergencia", "emergency")}</span>}</td><td className="small">{c.reason}</td></tr>
            ); })}</tbody>
          </table></div>
        )}
      </section>

      {manage && (
        <section className="card" id="escaneo">
          <b>{t("Escaneo de emergencia", "Emergency scan")}</b>
          <p className="src">{t("Lo que no puede esperar de una persona que faltó sin aviso: promesas, visitas, tareas, entregas, cobros, decisiones y próximos pasos vencidos o de los próximos 2 días.", "What can't wait for someone absent without notice: promises, visits, tasks, deliveries, collections, decisions and next steps overdue or due in the next 2 days.")}</p>
          <form method="get" className="goal-pick" action="/comercial/cobertura#escaneo">
            <label>{t("Persona", "Person")}<select name="scan" defaultValue={scanFor ?? ""}><option value="" disabled>{t("Elige…", "Choose…")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button type="submit" className="secondary">{t("Escanear", "Scan")}</button>
          </form>
          {scan && (scan.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>{t("Nada urgente en los próximos 2 días.", "Nothing urgent in the next 2 days.")}</p> : (
            <div className="tscroll" style={{ marginTop: 8 }}><table>
              <thead><tr><th>{t("Cuándo", "When")}</th><th>{t("Qué", "What")}</th><th>{t("Cliente", "Customer")}</th><th>{t("Detalle", "Detail")}</th></tr></thead>
              <tbody>{scan.map((s, k) => { const at = s.at ? new Date(s.at) : null; return <tr key={k}><td className={`mono small${at && at < today() ? " risk-t" : ""}`}>{at ? i.day(at) : "—"}</td><td className="small">{t(SCAN_KINDS[s.kind].es, SCAN_KINDS[s.kind].en)}</td><td className="small">{s.account ?? "—"}</td><td className="small"><Link href={s.href}>{s.label}</Link>{s.amount != null && <span className="mono"> · {i.money2(s.amount)}</span>}</td></tr>; })}</tbody>
            </table></div>
          ))}
        </section>
      )}

      <section className="card" id="respaldos">
        <b>{t("Respaldo de relación de mis clientes", "Relationship backup for my customers")}</b>
        <p className="src">{t("Quién conoce a cada cliente lo suficiente para entrar si no estás. Se sugiere al pedir cobertura.", "Who knows each customer well enough to step in if you're away. Suggested when arranging coverage.")}</p>
        {accounts.length === 0 ? <p className="small muted">{t("No eres dueño de clientes.", "You don't own customers.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cliente", "Customer")}</th><th>{t("Respaldo", "Backup")}</th></tr></thead>
            <tbody>{accounts.map((a) => (
              <tr key={a.id} id={`r-${a.id}`}><td>{a.name}</td><td>
                <form action={setBackup.bind(null, a.id)} className="qa-row">
                  <select name="backupUserId" defaultValue={a.backup?.backupUserId ?? ""} aria-label={t("Respaldo", "Backup")}><option value="">{t("Sin respaldo", "No backup")}</option>{people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input name="note" maxLength={300} defaultValue={a.backup?.note ?? ""} placeholder={t("Nota (opcional)", "Note (optional)")} aria-label={t("Nota", "Note")} />
                  <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
                </form>
              </td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
