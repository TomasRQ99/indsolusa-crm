import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canAdminPeople, canManageAll, canSeePay, canSetPay, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { isWorkingDay } from "@/lib/holidays";
import { ABSENCE_KINDS, ABSENCE_STATUS, DOMAINS, GAP_KINDS, absenceDays, delegationActive } from "@/lib/admin-rules";
import { addRoleAssignment, cancelAbsence, decideAbsence, raiseSupportGap, requestAbsence, savePersonAdmin, setCompensation, updateSupportGap } from "../actions";

// Módulo 14 §2K, §23–25 · one person's administrative record: bond, formal assignment with its history, pay (only
// Gerencia and the person), absences, assets in their care, lent authority and the support the company owes them.

export default async function PersonAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const self = user.id === id, admin = canAdminPeople(user);
  const seePay = canSeePay(user, id);
  // Finanzas reaches this record for pay only; the labour facts stay with Administración, Gerencia and the person.
  const payOnly = !self && !admin && seePay;
  if (!self && !admin && !seePay) return <div className="note risk">{t("Los datos administrativos de una persona los ven ella misma, Administración y Gerencia.", "A person's administrative facts are seen by that person, Administration and Management.")}</div>;
  const p = await db.user.findUnique({ where: { id }, select: {
    id: true, name: true, email: true, role: true, active: true, personAdmin: true,
    roleAssignments: { orderBy: { effectiveFrom: "desc" }, include: { leader: { select: { name: true } } } },
    absences: { orderBy: { startsOn: "desc" }, take: 40 },
    assetsHeld: { where: { status: { not: "DISPOSED" } }, select: { id: true, code: true, name: true } },
    supportGaps: { orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], take: 30, include: { owner: { select: { name: true } } } },
    authorityReceived: { orderBy: { endsAt: "desc" }, take: 10, include: { fromUser: { select: { name: true } } } },
    authorityGiven: { orderBy: { endsAt: "desc" }, take: 10, include: { toUser: { select: { name: true } } } },
  } });
  if (!p) notFound();
  const [pay, people] = await Promise.all([
    // Pay is read only when this viewer may see it: it never travels to the page otherwise.
    seePay ? db.personCompensation.findMany({ where: { userId: id }, orderBy: { effectiveFrom: "desc" }, take: 12 }) : [],
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const T = today();
  const pa = p.personAdmin;
  const cur = p.roleAssignments.find((r) => !r.effectiveTo) ?? null;
  const y0 = new Date(Date.UTC(T.getUTCFullYear(), 0, 1)), y1 = new Date(Date.UTC(T.getUTCFullYear(), 11, 31));
  const vacUsed = absenceDays(p.absences.filter((a) => a.kind === "VACATION"), y0, y1, isWorkingDay);
  const now = new Date();
  const lent = [...p.authorityReceived.map((d) => ({ d, dir: "IN" as const, other: d.fromUser.name })), ...p.authorityGiven.map((d) => ({ d, dir: "OUT" as const, other: d.toUser.name }))].filter((x) => delegationActive(x.d, now));
  const bondTxt = (b: string | null | undefined) => (b === "EMPLOYEE" ? t("Empleado", "Employee") : b === "CONTRACTOR" ? t("Contratista", "Contractor") : b === "PARTNER" ? t("Socio", "Partner") : b === "OTHER" ? t("Otro", "Other") : "—");
  const okMsg: Record<string, string> = { vinculo: t("Datos del vínculo guardados.", "Bond data saved."), cargo: t("Asignación guardada. La anterior quedó cerrada ese mismo día.", "Assignment saved. The earlier one was closed on that same day."), pago: t("Remuneración guardada como un registro nuevo.", "Pay saved as a new record."), "ausencia-pedida": t("Ausencia pedida. La decide otra persona.", "Absence requested. Someone else decides it."), ausencia: t("Ausencia registrada.", "Absence recorded."), "ausencia-decidida": t("Decisión guardada.", "Decision saved."), "ausencia-cancelada": t("Ausencia cancelada.", "Absence cancelled."), soporte: t("Guardado.", "Saved.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso para esto.", "You don't have permission for this."), fechas: t("La fecha final del contrato no puede ser anterior a la inicial.", "The contract end can't be before its start."), cargo: t("Faltan datos: cargo, desde cuándo y motivo del cambio.", "Missing data: title, from when and the reason for the change."), "cargo-fecha": t("La nueva asignación debe empezar después de la actual.", "The new assignment must start after the current one."), pago: t("Faltan datos: valor, moneda, periodo y desde cuándo.", "Missing data: amount, currency, period and from when."), ausencia: t("Revisa las fechas de la ausencia (máximo 180 días).", "Check the absence dates (180 days at most)."), cruza: t("Esas fechas se cruzan con otra ausencia ya pedida o aprobada.", "Those dates overlap another absence already requested or approved."), "ausencia-autoridad": t("Una ausencia la decide Administración o Gerencia, nunca la propia persona.", "An absence is decided by Administration or Management, never by the person."), "ausencia-decision": t("No se puede: revisa el estado, o escribe el motivo si no se aprueba.", "Not possible: check its status, or write the reason if it isn't approved."), soporte: t("Faltan datos: qué falta, quién responde y el próximo paso.", "Missing data: what is missing, who is responsible and the next step."), "soporte-nota": t("Escribe la nota.", "Write the note.") };

  // Finanzas looking at someone else: pay and nothing more.
  if (payOnly) return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/administracion/personas">{t("Personas", "People")}</Link></div>
        <h1>{p.name}</h1>
        <p>{cur?.contractualTitle ?? t("Cargo sin registrar", "Title not recorded")}</p>
      </div></div>
      <section className="card" id="pago"><b>{t("REMUNERACIÓN", "PAY")}</b> <span className="small muted">· {t("la ven solo Gerencia, Finanzas y la propia persona", "seen only by Management, Finance and the person")}</span>
        {pay.length === 0 ? <p className="small muted">{t("Sin registrar.", "Not recorded.")}</p> : <ul className="plain small">{pay.map((c, k) => <li key={c.id}>{k === 0 ? <span className="sig ok">{t("vigente", "current")}</span> : null} <span className="mono">{c.currency} {i.n2(c.amount)}</span> · {c.period === "MONTHLY" ? t("al mes", "per month") : c.period === "YEARLY" ? t("al año", "per year") : t("por hora", "per hour")} · {t("desde", "from")} {i.date(c.effectiveFrom)}{c.benefitsNote ? ` · ${c.benefitsNote}` : ""} <span className="muted">· {c.setByName}</span></li>)}</ul>}
        <p className="src">{t("La registra Gerencia. Los demás datos de la persona los ven ella, Administración y Gerencia.", "Management records it. The person's other facts are seen by the person, Administration and Management.")}</p>
      </section>
    </>
  );

  return (
    <>
      <div className="ph"><div>
        {(admin || canManageAll(user)) && <div className="crumb"><Link href="/administracion/personas">{t("Personas", "People")}</Link></div>}
        <h1>{p.name}</h1>
        <p>{cur?.contractualTitle ?? t("Cargo sin registrar", "Title not recorded")} · {t("rol en SOLU", "role in SOLU")}: {ROLE_LABEL[p.role]?.[i.es ? "es" : "en"] ?? p.role}{!p.active ? <span className="sig wait"> {t("inactiva", "inactive")}</span> : null}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="vinculo"><b>{t("VÍNCULO CON LA EMPRESA", "BOND WITH THE COMPANY")}</b>
        {admin ? (
          <form action={savePersonAdmin.bind(null, id)} className="qa-form">
            <div className="qa-row">
              <label style={{ flex: 2 }}>{t("Nombre legal", "Legal name")}<input name="legalName" maxLength={160} defaultValue={pa?.legalName ?? ""} /></label>
              <label>{t("Vínculo", "Bond")}<select name="bond" defaultValue={pa?.bond ?? ""}><option value="">—</option><option value="EMPLOYEE">{t("Empleado", "Employee")}</option><option value="CONTRACTOR">{t("Contratista", "Contractor")}</option><option value="PARTNER">{t("Socio", "Partner")}</option><option value="OTHER">{t("Otro", "Other")}</option></select></label>
              <label>{t("Empresa que contrata", "Contracting company")}<input name="employer" maxLength={160} defaultValue={pa?.employer ?? ""} /></label>
            </div>
            <div className="qa-row">
              <label>{t("Contrato desde", "Contract from")}<input type="date" name="contractStart" defaultValue={dayInput(pa?.contractStart)} /></label>
              <label>{t("Contrato hasta", "Contract until")}<input type="date" name="contractEnd" defaultValue={dayInput(pa?.contractEnd)} /></label>
              <label>{t("Ubicación", "Location")}<input name="location" maxLength={120} defaultValue={pa?.location ?? ""} /></label>
              <label>{t("Días de vacaciones al año", "Vacation days per year")}<input name="vacationDaysPerYear" inputMode="decimal" defaultValue={pa?.vacationDaysPerYear != null ? String(pa.vacationDaysPerYear) : ""} /></label>
            </div>
            <label>{t("Documentos laborales (cuáles hay y dónde están)", "Labour documents (which exist and where they are)")}<textarea name="documentsNote" rows={2} maxLength={600} defaultValue={pa?.documentsNote ?? ""} /></label>
            <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button>{pa ? <span className="src"> {t("última edición", "last edited by")} {pa.updatedByName} · {i.day(pa.updatedAt)}</span> : null}</div>
          </form>
        ) : (
          <dl className="qv-dl">
            <dt>{t("Vínculo", "Bond")}</dt><dd>{bondTxt(pa?.bond)}{pa?.employer ? ` · ${pa.employer}` : ""}</dd>
            <dt>{t("Contrato", "Contract")}</dt><dd>{pa?.contractStart ? i.date(pa.contractStart) : "—"} → {pa?.contractEnd ? i.date(pa.contractEnd) : t("sin fecha final", "no end date")}</dd>
            <dt>{t("Ubicación", "Location")}</dt><dd>{pa?.location ?? "—"}</dd>
          </dl>
        )}
        <p className="src">{t("SOLU no calcula nómina, prestaciones ni días de ley: guarda lo que Administración escribe.", "SOLU doesn't compute payroll, benefits or statutory days: it keeps what Administration types.")}</p>
      </section>

      <section className="card" id="cargo"><b>{t("CARGO FORMAL Y ROL", "FORMAL POSITION AND ROLE")}</b>
        {p.roleAssignments.length === 0 ? <p className="small muted">{t("Sin asignación formal registrada.", "No formal assignment recorded.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Vigencia", "In force")}</th><th>{t("Cargo en el contrato", "Contract title")}</th><th>{t("Rol en SOLU ese día", "Role in SOLU that day")}</th><th>{t("Unidad · líder formal", "Unit · formal leader")}</th><th>{t("Motivo", "Reason")}</th></tr></thead>
            <tbody>{p.roleAssignments.map((r) => <tr key={r.id}><td className="small">{i.day(r.effectiveFrom)} → {r.effectiveTo ? i.day(r.effectiveTo) : <span className="sig ok">{t("vigente", "current")}</span>}</td><td><b>{r.contractualTitle}</b></td><td className="small">{ROLE_LABEL[r.operatingRole as keyof typeof ROLE_LABEL]?.[i.es ? "es" : "en"] ?? r.operatingRole}</td><td className="small">{r.unit ?? "—"} · {r.leader?.name ?? "—"}{r.location ? ` · ${r.location}` : ""}</td><td className="small">{r.reason}<span className="src block">{r.setByName}</span></td></tr>)}</tbody>
          </table></div>
        )}
        {admin && <details><summary className="small">{t("Registrar un cambio de cargo, unidad o líder", "Record a change of title, unit or leader")}</summary>
          <form action={addRoleAssignment.bind(null, id)} className="qa-form">
            <div className="qa-row">
              <label style={{ flex: 2 }}>{t("Cargo en el contrato", "Contract title")}<input name="contractualTitle" required maxLength={160} defaultValue={cur?.contractualTitle ?? ""} /></label>
              <label>{t("Unidad o función", "Unit or function")}<input name="unit" maxLength={120} defaultValue={cur?.unit ?? ""} /></label>
              <label>{t("Líder formal", "Formal leader")}<select name="leaderId" defaultValue={cur?.leaderId ?? ""}><option value="">—</option>{people.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            </div>
            <div className="qa-row">
              <label>{t("Ubicación", "Location")}<input name="location" maxLength={120} defaultValue={cur?.location ?? ""} /></label>
              <label>{t("Desde", "From")}<input type="date" name="effectiveFrom" required defaultValue={dayInput(T)} /></label>
              <label style={{ flex: 2 }}>{t("Motivo", "Reason")}<input name="reason" required maxLength={300} /></label>
            </div>
            <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
          </form>
        </details>}
        <p className="src">{t("El título no da autoridad por sí solo. Lo que la persona puede aprobar en SOLU sale de su rol, de las políticas vigentes y de la autoridad que alguien le preste por un tiempo. El rol en SOLU lo cambia Gerencia en Equipo → Personas y datos.", "The title grants no authority by itself. What the person can approve in SOLU comes from their role, the policies in force and any authority someone lends them for a time. The role in SOLU is changed by Management in Team → People & data.")}</p>
        {lent.length > 0 && <ul className="plain small">{lent.map(({ d, dir, other }) => <li key={d.id}><span className="sig wait">{dir === "IN" ? t("Autoridad recibida", "Authority received") : t("Autoridad prestada", "Authority lent")}</span> {DOMAINS[d.domain] ? t(DOMAINS[d.domain].es, DOMAINS[d.domain].en) : d.domain} · {dir === "IN" ? t("de", "from") : t("a", "to")} {other}{d.limitUsd != null ? ` · ${t("hasta", "up to")} USD ${i.n2(d.limitUsd)}` : ""} · {t("termina el", "ends")} {i.date(d.endsAt)} · <Link href="/administracion/autoridad">{t("ver", "see")}</Link></li>)}</ul>}
      </section>

      {seePay && <section className="card" id="pago"><b>{t("REMUNERACIÓN", "PAY")}</b> <span className="small muted">· {t("la ven solo Gerencia, Finanzas y la propia persona", "seen only by Management, Finance and the person")}</span>
        {pay.length === 0 ? <p className="small muted">{t("Sin registrar.", "Not recorded.")}</p> : <ul className="plain small">{pay.map((c, k) => <li key={c.id}>{k === 0 ? <span className="sig ok">{t("vigente", "current")}</span> : null} <span className="mono">{c.currency} {i.n2(c.amount)}</span> · {c.period === "MONTHLY" ? t("al mes", "per month") : c.period === "YEARLY" ? t("al año", "per year") : t("por hora", "per hour")} · {t("desde", "from")} {i.date(c.effectiveFrom)}{c.benefitsNote ? ` · ${c.benefitsNote}` : ""} <span className="muted">· {c.setByName}</span></li>)}</ul>}
        {canSetPay(user) && <details><summary className="small">{t("Registrar un valor nuevo", "Record a new amount")}</summary>
          <form action={setCompensation.bind(null, id)} className="qa-form">
            <div className="qa-row">
              <label>{t("Valor", "Amount")}<input name="amount" inputMode="decimal" required /></label>
              <label>{t("Moneda", "Currency")}<input name="currency" required maxLength={3} defaultValue={pay[0]?.currency ?? "USD"} style={{ width: 70 }} /></label>
              <label>{t("Periodo", "Period")}<select name="period" defaultValue={pay[0]?.period ?? "MONTHLY"}><option value="MONTHLY">{t("Al mes", "Per month")}</option><option value="YEARLY">{t("Al año", "Per year")}</option><option value="HOURLY">{t("Por hora", "Per hour")}</option></select></label>
              <label>{t("Desde", "From")}<input type="date" name="effectiveFrom" required defaultValue={dayInput(T)} /></label>
            </div>
            <label>{t("Beneficios (nota)", "Benefits (note)")}<input name="benefitsNote" maxLength={500} /></label>
            <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
          </form>
        </details>}
        <p className="src">{t("El valor no se copia al historial de cambios ni aparece en listas o informes.", "The amount is not copied to the change history and appears in no list or report.")}</p>
      </section>}

      <section className="card" id="ausencias"><b>{t("AUSENCIAS", "ABSENCES")}</b>
        <p className="small">{t(`Vacaciones aprobadas en ${T.getUTCFullYear()}: ${vacUsed} día(s) hábiles`, `Vacation approved in ${T.getUTCFullYear()}: ${vacUsed} working day(s)`)}{pa?.vacationDaysPerYear != null ? t(` de ${String(pa.vacationDaysPerYear)} al año`, ` of ${String(pa.vacationDaysPerYear)} per year`) : ""}</p>
        {p.absences.length === 0 ? <p className="small muted">{t("Ninguna registrada.", "None recorded.")}</p> : <ul className="plain small">{p.absences.map((a) => (
          <li key={a.id}><span className={`sig ${ABSENCE_STATUS[a.status]?.tone ?? "wait"}`}>{ABSENCE_STATUS[a.status] ? t(ABSENCE_STATUS[a.status].es, ABSENCE_STATUS[a.status].en) : a.status}</span> {ABSENCE_KINDS[a.kind] ? t(ABSENCE_KINDS[a.kind].es, ABSENCE_KINDS[a.kind].en) : a.kind} · {i.day(a.startsOn)} – {i.date(a.endsOn)}{a.note ? ` · ${a.note}` : ""}{a.decidedByName ? <span className="muted"> · {a.decidedByName}{a.decisionNote ? `: ${a.decisionNote}` : ""}</span> : null}
            {a.status === "REQUESTED" && admin && !self && <form action={decideAbsence.bind(null, a.id)} className="qa-row" style={{ alignItems: "center", marginTop: 4 }}><input name="note" placeholder={t("Nota (obligatoria si no se aprueba)", "Note (required if not approved)")} aria-label={t("Nota", "Note")} /><input name="evidence" placeholder={t("Soporte (opcional)", "Evidence (optional)")} aria-label={t("Soporte", "Evidence")} /><button type="submit" name="action" value="APPROVE" className="sm" style={{ flex: "0 0 auto" }}>{t("Aprobar", "Approve")}</button><button type="submit" name="action" value="REJECT" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("No aprobar", "Don't approve")}</button></form>}
            {(a.status === "REQUESTED" || a.status === "APPROVED") && a.endsOn >= T && (self || admin) && <form action={cancelAbsence.bind(null, a.id)} style={{ display: "inline", marginLeft: 8 }}><button type="submit" className="secondary sm" data-confirm={t("¿Cancelar esta ausencia?", "Cancel this absence?")}>{t("Cancelar", "Cancel")}</button></form>}
          </li>
        ))}</ul>}
        <details><summary className="small">{self ? t("Pedir una ausencia", "Request an absence") : t("Registrar una ausencia de esta persona", "Record an absence for this person")}</summary>
          <form action={requestAbsence.bind(null, id)} className="qa-form">
            <div className="qa-row">
              <label>{t("Tipo", "Kind")}<select name="kind">{Object.entries(ABSENCE_KINDS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
              <label>{t("Desde", "From")}<input type="date" name="startsOn" required /></label>
              <label>{t("Hasta (incluido)", "To (inclusive)")}<input type="date" name="endsOn" required /></label>
            </div>
            <label>{t("Nota", "Note")}<input name="note" maxLength={400} /></label>
            {!self && <label>{t("Soporte (dónde está el documento)", "Evidence (where the document is)")}<input name="evidence" maxLength={200} /></label>}
            <div><button type="submit" className="secondary">{self ? t("Pedir", "Request") : t("Registrar", "Record")}</button></div>
          </form>
        </details>
        <p className="src">{t("Una ausencia aprobada deja esos días sin capacidad en Mi Plan y aparece en Cobertura para asignar quién cubre. El tipo de ausencia solo lo ven la persona, Administración y Gerencia.", "An approved absence leaves those days without capacity in My Plan and shows in Coverage so someone can be assigned to cover. The kind of absence is seen only by the person, Administration and Management.")}</p>
      </section>

      <section className="card" id="activos"><b>{t("ACTIVOS A SU CARGO", "ASSETS IN THEIR CARE")} · {p.assetsHeld.length}</b>
        {p.assetsHeld.length === 0 ? <p className="small muted">{t("Ninguno.", "None.")}</p> : <ul className="plain small">{p.assetsHeld.map((a) => <li key={a.id}><Link href={`/administracion/activos/${a.id}`}><b>{a.code}</b> · {a.name}</Link></li>)}</ul>}
      </section>

      <section className="card" id="soporte"><b>{t("SOPORTE QUE LA EMPRESA LE DEBE PARA HACER BIEN SU ROL", "SUPPORT THE COMPANY OWES THEM TO DO THE ROLE WELL")}</b>
        {p.supportGaps.length === 0 ? <p className="small muted">{t("Nada registrado.", "Nothing recorded.")}</p> : <ul className="plain small">{p.supportGaps.map((g) => (
          <li key={g.id}><span className={`sig ${g.status === "RESOLVED" ? "ok" : g.status === "ESCALATED" ? "risk" : "attn"}`}>{g.status === "RESOLVED" ? t("Resuelto", "Resolved") : g.status === "ESCALATED" ? t("Escalado", "Escalated") : t("Abierto", "Open")}</span> <b>{GAP_KINDS[g.kind] ? t(GAP_KINDS[g.kind].es, GAP_KINDS[g.kind].en) : g.kind}</b>: {g.what}{g.impact ? <span className="muted"> · {t("impacto", "impact")}: {g.impact}</span> : null} · {t("responde", "owner")} {g.owner.name}
            {g.status !== "RESOLVED" ? <> · {t("próximo paso", "next step")}: {g.nextMovement}{g.dueOn ? ` (${i.day(g.dueOn)})` : ""}
              <form action={updateSupportGap.bind(null, g.id)} className="qa-row" style={{ alignItems: "center", marginTop: 4 }}><input name="note" required placeholder={t("Nota o nuevo próximo paso", "Note or new next step")} aria-label={t("Nota", "Note")} /><input type="date" name="dueOn" aria-label={t("Fecha", "Date")} /><button type="submit" name="action" value="MOVE" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Cambiar el paso", "Change the step")}</button><button type="submit" name="action" value="RESOLVE" className="sm" style={{ flex: "0 0 auto" }}>{t("Resuelto", "Resolved")}</button>{g.status !== "ESCALATED" && <button type="submit" name="action" value="ESCALATE" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Escalar", "Escalate")}</button>}</form></> : <span className="muted"> · {g.resolvedNote}</span>}
            {g.escalatedNote && g.status === "ESCALATED" ? <span className="src block">{g.escalatedNote}</span> : null}
          </li>
        ))}</ul>}
        <details><summary className="small">{t("Registrar algo que falta", "Record something that is missing")}</summary>
          <form action={raiseSupportGap.bind(null, id)} className="qa-form">
            <div className="qa-row">
              <label>{t("Qué tipo", "Kind")}<select name="kind">{Object.entries(GAP_KINDS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
              <label style={{ flex: 2 }}>{t("Qué falta", "What is missing")}<input name="what" required maxLength={300} /></label>
            </div>
            <label>{t("Qué impide o retrasa", "What it prevents or delays")}<input name="impact" maxLength={300} /></label>
            <div className="qa-row">
              <label>{t("Quién lo resuelve", "Who resolves it")}<select name="ownerId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)]}</select></label>
              <label style={{ flex: 2 }}>{t("Próximo paso", "Next step")}<input name="nextMovement" required maxLength={300} /></label>
              <label>{t("Para cuándo", "By when")}<input type="date" name="dueOn" /></label>
            </div>
            <div><button type="submit" className="secondary">{t("Registrar", "Record")}</button></div>
          </form>
        </details>
        <p className="src">{t("Esto es una deuda de la empresa con el rol, no una marca sobre la persona. Cuando Equipo defina los perfiles de rol, lo que cada rol necesita vendrá de ahí.", "This is a debt of the company to the role, not a mark on the person. When Team defines the role profiles, what each role needs will come from there.")}</p>
      </section>
    </>
  );
}
