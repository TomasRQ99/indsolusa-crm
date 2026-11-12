import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { FREQUENCIES, OBLIGATION_KINDS, OBLIGATION_STATE, RENEWALS, obligationView } from "@/lib/admin-rules";
import { getAdminPolicy } from "@/lib/admin-store";
import { advanceDue, createObligation, decideObligation, endObligation } from "./actions";

// Módulo 14 §2I · Contratos y obligaciones: the register, and on top only what needs a decision while the decision
// can still change the outcome (AC12).

export default async function ObligationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; ver?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const all = canFinance(user);
  const [raw, pol, people] = await Promise.all([
    db.obligation.findMany({ where: { ...(all ? {} : { ownerId: user.id }), ...(sp.ver === "terminadas" ? {} : { status: "ACTIVE" }) }, orderBy: [{ endsOn: { sort: "asc", nulls: "last" } }, { party: "asc" }], include: { owner: { select: { name: true } } } }),
    getAdminPolicy(),
    all ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const T = today();
  const rows = raw.map((o) => ({ o, v: obligationView({ ...o, amount: o.amount == null ? null : Number(o.amount) }, T, pol.value) }));
  const need = rows.filter((r) => r.v.needsAction);
  const okMsg: Record<string, string> = { creada: t("Obligación registrada.", "Obligation recorded."), renovada: t("Renovada: empezó un periodo nuevo.", "Renewed: a new term started."), decidida: t("Decisión de terminar registrada. SOLU deja de avisar.", "Decision to end recorded. SOLU stops alerting."), avanzada: t("Pasó a la siguiente fecha de pago.", "Moved to the next payment date."), terminada: t("Obligación terminada. Queda en el registro.", "Obligation ended. It stays in the register.") };
  const errMsg: Record<string, string> = { permiso: t("Solo quien responde por la obligación, Administración, Finanzas o Gerencia.", "Only the obligation's owner, Administration, Finance or Management."), datos: t("Faltan datos: tipo, con quién, para qué y quién responde. No se guardó nada.", "Missing data: kind, with whom, what for and who is responsible. Nothing was saved."), decision: t("Falta la decisión o su motivo.", "The decision or its reason is missing."), fecha: t("Para renovar escribe la nueva fecha final, posterior a la actual.", "To renew, type the new end date, after the current one."), terminada: t("Esa obligación ya terminó.", "That obligation already ended."), "no-existe": t("No existe.", "It doesn't exist.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Contratos y obligaciones", "Contracts and obligations")}</h1><p>{t("Con quién, para qué, hasta cuándo, cuándo hay que avisar y qué se paga o se cobra. SOLU avisa solo mientras decidir todavía cambia lo que pasa.", "With whom, what for, until when, when notice is due and what is paid or collected. SOLU alerts only while deciding still changes what happens.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="decidir"><b>{t("NECESITAN UNA DECISIÓN", "A DECISION IS NEEDED")} · {need.length}</b>
        {need.length === 0 ? <p className="small"><span className="sig ok">{t("Nada que decidir por ahora", "Nothing to decide for now")}</span></p> : <ul className="plain small">{need.map(({ o, v }) => <li key={o.id}><span className={`sig ${OBLIGATION_STATE[v.state].tone}`}>{t(OBLIGATION_STATE[v.state].es, OBLIGATION_STATE[v.state].en)}</span> <a href={`#o-${o.id}`}><b>{o.party}</b> · {o.purpose}</a> · {v.state === "DECIDE" && v.noticeBy ? t(`avisar antes del ${i.date(v.noticeBy)} (${v.daysToNotice} días)`, `notice before ${i.date(v.noticeBy)} (${v.daysToNotice} days)`) : o.endsOn ? t(`termina el ${i.date(o.endsOn)}`, `ends ${i.date(o.endsOn)}`) : ""} · {o.owner.name}{!v.material ? <span className="muted"> · {t("no material: no interrumpe a nadie", "not material: it interrupts nobody")}</span> : null}</li>)}</ul>}
      </section>

      {rows.length === 0 ? <div className="card"><p className="small muted">{t("Aún no hay obligaciones registradas.", "No obligations recorded yet.")} <a href="#nueva">{t("Registrar la primera", "Record the first one")} →</a></p></div> : rows.map(({ o, v }) => (
        <section key={o.id} id={`o-${o.id}`} className="card">
          <div><b>{o.party}</b> · {o.purpose} <span className="small muted">· {OBLIGATION_KINDS[o.kind] ? t(OBLIGATION_KINDS[o.kind].es, OBLIGATION_KINDS[o.kind].en) : o.kind}</span> <span className={`sig ${OBLIGATION_STATE[v.state].tone}`}>{t(OBLIGATION_STATE[v.state].es, OBLIGATION_STATE[v.state].en)}</span>{o.material ? <span className="sig wait"> {t("material", "material")}</span> : null}</div>
          <dl className="qv-dl">
            <dt>{t("Vigencia", "Term")}</dt><dd>{o.startsOn ? i.date(o.startsOn) : "—"} → {o.endsOn ? i.date(o.endsOn) : t("sin fecha de fin", "no end date")} · {RENEWALS[o.renewal] ? t(RENEWALS[o.renewal].es, RENEWALS[o.renewal].en) : o.renewal}</dd>
            {v.noticeBy && o.noticeDays ? <><dt>{t("Aviso", "Notice")}</dt><dd>{t(`${o.noticeDays} días antes: a más tardar el ${i.date(v.noticeBy)}`, `${o.noticeDays} days before: no later than ${i.date(v.noticeBy)}`)}</dd></> : null}
            {o.amount != null && o.moneyDirection !== "NONE" && <><dt>{o.moneyDirection === "COLLECT" ? t("Se cobra", "Collected") : t("Se paga", "Paid")}</dt><dd><span className="mono">{o.currency} {i.n2(o.amount)}</span> · {FREQUENCIES[o.frequency ?? "ONCE"] ? t(FREQUENCIES[o.frequency ?? "ONCE"].es, FREQUENCIES[o.frequency ?? "ONCE"].en) : ""}{o.nextDueOn ? <> · {t("próxima fecha", "next date")} <b>{i.date(o.nextDueOn)}</b></> : <span className="muted"> · {t("sin próxima fecha", "no next date")}</span>}{v.yearly != null && o.frequency !== "ONCE" ? <span className="src block">{t("al año", "per year")}: {o.currency} {i.n2(v.yearly)}</span> : null}</dd></>}
            <dt>{t("Responde", "Owner")}</dt><dd>{o.owner.name}</dd>
            {o.evidence && <><dt>{t("Soporte", "Evidence")}</dt><dd className="small">{o.evidence}</dd></>}
            {o.notes && <><dt>{t("Notas", "Notes")}</dt><dd className="small" style={{ whiteSpace: "pre-wrap" }}>{o.notes}</dd></>}
            {o.decidedAt && <><dt>{t("Última decisión", "Last decision")}</dt><dd className="small">{o.decision === "END" ? t("Terminar", "End") : ""} {o.decisionNote} · {o.decidedByName} · {i.day(o.decidedAt)}</dd></>}
            {o.endedAt && <><dt>{t("Terminada", "Ended")}</dt><dd className="small">{i.date(o.endedAt)} · {o.endedNote}</dd></>}
          </dl>
          {o.status === "ACTIVE" && (all || o.ownerId === user.id) && (
            <div className="qa-form">
              {o.nextDueOn && o.amount != null && <form action={advanceDue.bind(null, o.id)}><button type="submit" className="secondary sm">{o.moneyDirection === "COLLECT" ? t("Ya se cobró: pasar a la siguiente fecha", "Collected: move to the next date") : t("Ya se pagó: pasar a la siguiente fecha", "Paid: move to the next date")}</button></form>}
              {o.endsOn && <details open={v.needsAction}><summary className="small">{t("Decidir: renovar o terminar", "Decide: renew or end")}</summary>
                <form action={decideObligation.bind(null, o.id)} className="qa-form">
                  <div className="qa-row">
                    <label>{t("Decisión", "Decision")}<select name="decision"><option value="RENEW">{t("Renovar", "Renew")}</option><option value="END">{t("Terminar al vencimiento", "End at expiry")}</option></select></label>
                    <label>{t("Nueva fecha final (si se renueva)", "New end date (if renewed)")}<input type="date" name="newEndsOn" /></label>
                    <label style={{ flex: 2 }}>{t("Motivo", "Reason")}<input name="note" required maxLength={500} /></label>
                  </div>
                  <div><button type="submit" className="secondary">{t("Guardar decisión", "Save decision")}</button></div>
                </form>
              </details>}
              <details><summary className="small">{t("Ya terminó: sacarla de las vigentes", "It has ended: remove from the active ones")}</summary>
                <form action={endObligation.bind(null, o.id)} className="qa-row" style={{ alignItems: "center" }}><input name="note" required placeholder={t("Cómo terminó", "How it ended")} aria-label={t("Cómo terminó", "How it ended")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Terminar", "End")}</button></form>
              </details>
            </div>
          )}
        </section>
      ))}
      <p className="small">{sp.ver === "terminadas" ? <Link href="/administracion/obligaciones">{t("Ver solo las vigentes", "Show active only")}</Link> : <Link href="/administracion/obligaciones?ver=terminadas">{t("Ver también las terminadas", "Also show ended")}</Link>}</p>
      <p className="src">{t(`SOLU empieza a pedir la decisión ${pol.value.obligationLeadDays} días antes de la fecha de aviso.`, `SOLU starts asking for the decision ${pol.value.obligationLeadDays} days before the notice date.`)} {pol.value.materialityUsd > 0 ? t(`Interrumpen las de USD ${i.n2(pol.value.materialityUsd)} al año o más, y las marcadas como materiales.`, `Those of USD ${i.n2(pol.value.materialityUsd)} a year or more interrupt, and those marked material.`) : t("Todas interrumpen: Gerencia no ha definido un valor de materialidad.", "All of them interrupt: Management hasn't set a materiality amount.")} <Link href="/administracion/politicas#admin">{t("Políticas", "Policies")}</Link></p>

      {all && <section className="card" id="nueva">
        <b>{t("REGISTRAR UN CONTRATO U OBLIGACIÓN", "RECORD A CONTRACT OR OBLIGATION")}</b>
        <form action={createObligation} className="qa-form">
          <div className="qa-row">
            <label>{t("Tipo", "Kind")}<select name="kind">{Object.entries(OBLIGATION_KINDS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label style={{ flex: 2 }}>{t("Con quién", "With whom")}<input name="party" required maxLength={160} /></label>
            <label>{t("Quién responde", "Owner")}<select name="ownerId" required defaultValue={user.id}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <label>{t("Para qué es", "What it is for")}<input name="purpose" required maxLength={300} /></label>
          <div className="qa-row">
            <label>{t("Empieza", "Starts")}<input type="date" name="startsOn" /></label>
            <label>{t("Termina", "Ends")}<input type="date" name="endsOn" /></label>
            <label>{t("Renovación", "Renewal")}<select name="renewal">{Object.entries(RENEWALS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label>{t("Días de aviso antes del fin", "Notice days before the end")}<input name="noticeDays" inputMode="numeric" /></label>
          </div>
          <div className="qa-row">
            <label>{t("Dinero", "Money")}<select name="moneyDirection"><option value="NONE">{t("No aplica", "None")}</option><option value="PAY">{t("Se paga", "We pay")}</option><option value="COLLECT">{t("Se cobra", "We collect")}</option></select></label>
            <label>{t("Valor", "Amount")}<input name="amount" inputMode="decimal" /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" maxLength={3} style={{ width: 70 }} /></label>
            <label>{t("Cada cuánto", "How often")}<select name="frequency">{Object.entries(FREQUENCIES).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label>{t("Próxima fecha", "Next date")}<input type="date" name="nextDueOn" /></label>
          </div>
          <label>{t("Soporte (dónde está el contrato o la póliza)", "Evidence (where the contract or policy is)")}<input name="evidence" maxLength={300} /></label>
          <label>{t("Notas (garantías, seguros, permisos que exige)", "Notes (guarantees, insurance, permits it requires)")}<textarea name="notes" rows={2} maxLength={800} /></label>
          <label className="check"><input type="checkbox" name="material" value="1" /> {t("Es material aunque el valor sea bajo (por ejemplo, un permiso sin el que no se puede operar)", "It is material even if the amount is low (for example, a permit without which we can't operate)")}</label>
          <div><button type="submit">{t("Registrar", "Record")}</button></div>
        </form>
      </section>}
    </>
  );
}
