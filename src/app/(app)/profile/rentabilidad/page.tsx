import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { currentNumbers } from "@/lib/rentabilidad";
import { NUMBER_LABELS, diffNumbers, type Numbers } from "@/lib/rentabilidad-config";
import { decideChange, proposeChange } from "./actions";

// Módulo 12 · Perfil → Configuración → Modificar números de Rentabilidad. The numbers behind commissions and the
// cost of money. Anyone can read them; Finanzas, Administración or Gerencia propose a change; Gerencia approves.

export default async function ProfitabilityNumbersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const canPropose = canFinance(user);
  const canApprove = isGerencia(user);
  const [cur, requests] = await Promise.all([currentNumbers(), db.policyChangeRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 12 })]);
  const N = cur.numbers;
  const pending = requests.find((r) => r.status === "PENDING") ?? null;
  const val = (k: keyof Numbers, v: Numbers[keyof Numbers]) => (k === "proportional" ? (v ? t("Sí", "Yes") : t("No", "No")) : v == null ? t("Sin definir", "Not set") : `${i.n2(Number(v))}${k === "newClientBonus" ? " pts" : " %"}`);
  const okMsg: Record<string, string> = { propuesta: t("Propuesta enviada. No cambia nada hasta que Gerencia la apruebe.", "Proposal sent. Nothing changes until Management approves it."), aprobada: t("Cambio aprobado. Los números nuevos rigen desde la fecha indicada; lo ya calculado no cambia.", "Change approved. The new numbers apply from the date given; what was already calculated doesn't change."), rechazada: t("Propuesta rechazada. Los números siguen igual.", "Proposal rejected. The numbers stay the same.") };
  const errMsg: Record<string, string> = {
    permiso: t("Proponer un cambio corresponde a Finanzas, Administración o Gerencia.", "Proposing a change is for Finance, Administration or Management."), gerencia: t("Solo Gerencia aprueba o rechaza.", "Only Management approves or rejects."),
    datos: t("Revisa los valores: todos deben estar dentro de su rango, con fecha y motivo. No se guardó nada.", "Check the values: all must be within range, with a date and a reason. Nothing was saved."), fecha: t("La fecha de inicio no puede ser anterior a hoy: un cambio nunca aplica hacia atrás.", "The start date can't be before today: a change never applies backwards."),
    pendiente: t("Ya hay una propuesta esperando decisión. Primero se decide esa.", "A proposal is already awaiting a decision. That one is decided first."), igual: t("Los valores son iguales a los vigentes.", "The values are the same as those in force."), cerrada: t("Esa propuesta ya se decidió.", "That proposal was already decided."), nota: t("Para rechazar, escribe por qué.", "To reject, write why."),
  };
  const keys = Object.keys(NUMBER_LABELS) as (keyof Numbers)[];

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/profile">{t("Mi perfil", "My profile")}</Link> · {t("Configuración", "Settings")}</div>
        <h1>{t("Modificar números de Rentabilidad", "Change profitability numbers")}</h1>
        <p>{t("Los números con los que SOLU calcula comisiones y el costo del dinero. Un cambio se propone aquí y solo rige cuando Gerencia lo aprueba, desde la fecha que se indique. Nada de lo ya calculado se recalcula.", "The numbers SOLU uses to calculate commissions and the cost of money. A change is proposed here and only applies once Management approves it, from the date given. Nothing already calculated is recalculated.")}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="vigentes">
        <b>{t("NÚMEROS VIGENTES", "NUMBERS IN FORCE")}</b>
        <dl className="qv-dl">{keys.map((k) => <div key={k} style={{ display: "contents" }}><dt>{t(NUMBER_LABELS[k].es, NUMBER_LABELS[k].en)}</dt><dd><b className="mono">{k === "ratePct" && cur.tiered ? t("Por niveles", "Tiered") : val(k, N[k])}</b>{k === "commercialPct" && <span className="muted small"> · {t(`Operativo ${100 - N.commercialPct} %`, `Operational ${100 - N.commercialPct} %`)}</span>}</dd></div>)}</dl>
        <p className="src">{cur.policyVersion ? t(`Política de comisión versión ${cur.policyVersion}, vigente desde ${cur.policyFrom ? i.day(cur.policyFrom) : "—"}. Cada Necesidad usa la versión vigente en la fecha de su OC.`, `Commission policy version ${cur.policyVersion}, in force from ${cur.policyFrom ? i.day(cur.policyFrom) : "—"}. Each Necessity uses the version in force on its PO date.`) : t("Aún no hay política de comisión: SOLU no calcula comisiones hasta que exista.", "No commission policy yet: SOLU calculates no commissions until one exists.")} {cur.tiered && t("La política vigente usa varios niveles; se editan en Gerencia → Comisiones. Si propones un cambio aquí, pasa a una tasa única.", "The policy in force uses several tiers; they are edited in Management → Commissions. Proposing a change here switches to a single rate.")}</p>
        <p className="small">{t("Otros números de rentabilidad:", "Other profitability numbers:")} <Link href="/administracion/economia#politica">{t("qué costos cuentan en la Eságara", "which costs count in Eságara")}</Link> · <Link href="/comercial/esagara">{t("umbral de Eságara baja", "low-Eságara threshold")}</Link> · <Link href="/gerencia/comisiones">{t("comisiones", "commissions")}</Link></p>
      </section>

      {pending && (() => { const ch = diffNumbers(pending.current as unknown as Numbers, pending.proposed as unknown as Numbers); return (
        <section className="card" id="pendiente">
          <b>{t("PROPUESTA ESPERANDO A GERENCIA", "PROPOSAL AWAITING MANAGEMENT")}</b>
          <p className="small">{pending.requestedByName} · {i.day(pending.requestedAt)} · {t("regiría desde", "would apply from")} <b className="mono">{i.day(pending.effectiveFrom)}</b></p>
          <p className="small">{t("Motivo", "Reason")}: {pending.reason}</p>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Número", "Number")}</th><th className="n">{t("Hoy", "Today")}</th><th className="n">{t("Propuesto", "Proposed")}</th></tr></thead>
            <tbody>{ch.map((c) => <tr key={c.key}><td>{t(NUMBER_LABELS[c.key].es, NUMBER_LABELS[c.key].en)}</td><td className="n mono">{val(c.key, (pending.current as unknown as Numbers)[c.key])}</td><td className="n mono"><b>{val(c.key, (pending.proposed as unknown as Numbers)[c.key])}</b></td></tr>)}</tbody>
          </table></div>
          {canApprove ? (
            <form action={decideChange.bind(null, pending.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
              <label>{t("Nota (obligatoria para rechazar)", "Note (required to reject)")}<input name="note" maxLength={300} /></label>
              <button type="submit" name="decision" value="APPROVE" style={{ flex: "0 0 auto" }}>{t("Aprobar cambio", "Approve change")}</button>
              <button type="submit" name="decision" value="REJECT" className="secondary" style={{ flex: "0 0 auto" }}>{t("Rechazar", "Reject")}</button>
            </form>
          ) : <p className="src">{t("Solo Gerencia puede aprobarla o rechazarla.", "Only Management can approve or reject it.")}</p>}
        </section>
      ); })()}

      {canPropose && !pending && (
        <section className="card" id="proponer">
          <b>{t("PROPONER UN CAMBIO", "PROPOSE A CHANGE")}</b>
          <form action={proposeChange} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
            <div className="qa-row">
              <label>{t(NUMBER_LABELS.ratePct.es, NUMBER_LABELS.ratePct.en)}<input name="ratePct" inputMode="decimal" required defaultValue={N.ratePct} /></label>
              <label>{t(NUMBER_LABELS.newClientBonus.es, NUMBER_LABELS.newClientBonus.en)}<input name="newClientBonus" inputMode="decimal" required defaultValue={N.newClientBonus} /></label>
            </div>
            <div className="qa-row">
              <label>{t(NUMBER_LABELS.salePercent.es, NUMBER_LABELS.salePercent.en)}<input name="salePercent" type="number" min={0} max={100} step={1} required defaultValue={N.salePercent} /></label>
              <label>{t(NUMBER_LABELS.commercialPct.es, NUMBER_LABELS.commercialPct.en)}<input name="commercialPct" type="number" min={0} max={100} step={1} required defaultValue={N.commercialPct} /></label>
            </div>
            <label className="chk"><input type="checkbox" name="proportional" value="1" defaultChecked={N.proportional} /> {t(NUMBER_LABELS.proportional.es, NUMBER_LABELS.proportional.en)}</label>
            <div className="qa-row">
              <label>{t(NUMBER_LABELS.financeAnnualPct.es, NUMBER_LABELS.financeAnnualPct.en)}<input name="financeAnnualPct" inputMode="decimal" required defaultValue={N.financeAnnualPct ?? 0} /></label>
              <label style={{ flex: "0 0 180px" }}>{t("Rige desde", "Applies from")}<input name="effectiveFrom" type="date" required min={dayInput(today())} defaultValue={dayInput(today())} /></label>
            </div>
            <label>{t("Motivo del cambio", "Reason for the change")}<input name="reason" required maxLength={400} /></label>
            <button type="submit">{t("Enviar propuesta a Gerencia", "Send proposal to Management")}</button>
            <span className="src">{t("El resto de la comisión se paga con el recaudo. El fondo de Operativo es lo que no va a Comercial.", "The rest of the commission is paid with collection. The Operational fund is what doesn't go to Commercial.")}</span>
          </form>
        </section>
      )}

      {requests.filter((r) => r.status !== "PENDING").length > 0 && (
        <section className="card" id="historia">
          <b>{t("HISTORIA DE CAMBIOS", "CHANGE HISTORY")}</b>
          <ul className="plain small">{requests.filter((r) => r.status !== "PENDING").map((r) => { const ch = diffNumbers(r.current as unknown as Numbers, r.proposed as unknown as Numbers); return (
            <li key={r.id}><span className={`sig ${r.status === "APPROVED" ? "ok" : "wait"}`}>{r.status === "APPROVED" ? t("Aprobado", "Approved") : t("Rechazado", "Rejected")}</span> {ch.map((c) => `${t(NUMBER_LABELS[c.key].es, NUMBER_LABELS[c.key].en)}: ${c.from} → ${c.to}`).join(" · ")}<span className="muted"> · {t("propuso", "proposed by")} {r.requestedByName} · {t("decidió", "decided by")} {r.decidedByName} · {r.decidedAt ? i.day(r.decidedAt) : ""}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span></li>
          ); })}</ul>
        </section>
      )}
    </>
  );
}
