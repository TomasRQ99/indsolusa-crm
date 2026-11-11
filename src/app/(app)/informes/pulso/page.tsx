import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canExportReports, canFinance, canManageAll, isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { periodOf, shiftPeriod, validPeriod } from "@/lib/goal-rules";
import { computePulse, pulseGroups, type PulseData, type PulseMetric } from "@/lib/pulse";
import { HowCalc } from "@/components/HowCalc";
import { closePulse, reopenPulse } from "./actions";

// Módulo 13 §5 · Business Pulse: the month by function. What happened in the period is compared with the previous
// month; what is a snapshot of today is labelled as such. A closed month shows the figures saved at its close.

export default async function BusinessPulsePage({ searchParams }: { searchParams: Promise<{ mes?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canManageAll(user) && !canFinance(user)) return <div className="note risk">{t("El pulso del negocio es para Gerencia, Dirección, Finanzas y Administración.", "The business pulse is for Management, Direction, Finance and Administration.")}</div>;
  const sp = await searchParams;
  const now = new Date();
  const cur = periodOf(now);
  // By default the last finished month: a month in progress says little.
  const period = sp.mes && validPeriod(sp.mes) && sp.mes <= cur ? sp.mes : shiftPeriod(cur, -1);
  const snaps = await db.pulseSnapshot.findMany({ where: { period }, orderBy: { version: "desc" } });
  const closed = snaps.find((s) => !s.reopenedAt) ?? null;
  const data = closed ? (closed.data as unknown as PulseData) : await computePulse(period, now);
  const { groups, prevOf } = pulseGroups(data);
  const ended = period < cur;
  const fmt = (m: PulseMetric, v: number) => (m.unit === "usd" ? `USD ${i.n2(v)}` : m.unit === "pct" ? i.pct(v) : String(Math.round(v)));
  const okMsg: Record<string, string> = { cerrado: t("Informe emitido y mes cerrado. Estas cifras quedan guardadas y no se recalculan solas.", "Report issued and month closed. These figures are saved and are not recalculated by themselves."), reabierto: t("Mes reabierto. Se muestra otra vez el cálculo en vivo; el cierre anterior queda en la historia.", "Month reopened. The live calculation shows again; the earlier close stays in the history.") };
  const errMsg: Record<string, string> = { permiso: t("Solo Gerencia cierra o reabre un mes.", "Only Management closes or reopens a month."), abierto: t("Solo se cierra un mes que ya terminó.", "Only a month that has ended can be closed."), ya: t("Ese mes ya está cerrado.", "That month is already closed."), motivo: t("Para reabrir, escribe el motivo.", "To reopen, write the reason."), "sin-cierre": t("Ese mes no tiene un cierre vigente.", "That month has no close in force.") };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Pulso del negocio", "Business pulse")}</h1>
        <p>{t("El mes, por función: qué descubrimos, qué transamos, qué cumplimos y qué recursos cuidamos. Cada cifra lleva a su detalle.", "The month, by function: what we discovered, what we closed, what we delivered and what resources we looked after. Each figure leads to its detail.")}</p>
        <p className="small"><span className="mono">{period}</span> · {closed ? <span className="sig ok">{t(`Cerrado por ${closed.closedByName} el ${i.day(closed.closedAt)}`, `Closed by ${closed.closedByName} on ${i.day(closed.closedAt)}`)}</span> : ended ? <span className="sig attn">{t("Mes terminado, sin cerrar: cálculo en vivo", "Month ended, not closed: live calculation")}</span> : <span className="sig wait">{t("Provisional: el mes sigue abierto", "Provisional: the month is still open")}</span>} · {t("calculado", "as of")} {i.day(new Date(data.asOf))} · <Link href={`/informes/pulso?mes=${shiftPeriod(period, -1)}`}>← {shiftPeriod(period, -1)}</Link>{period < cur && <> · <Link href={`/informes/pulso?mes=${shiftPeriod(period, 1)}`}>{shiftPeriod(period, 1)} →</Link></>}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {groups.map((g) => (
        <section className="card" key={g.key} id={g.key}>
          <b>{t(g.title.es, g.title.en).toUpperCase()}</b> <span className="small muted">{t(g.question.es, g.question.en)}</span>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("En el mes", "In the month")}</th><th className="n">{t("Mes anterior", "Previous month")}</th><th className="n">{t("Cambio", "Change")}</th></tr></thead>
            <tbody>{g.metrics.map((m) => { const pv = m.kind === "PERIOD" ? prevOf(m.key) : null; const d = pv != null ? Math.round((m.value - pv) * 100) / 100 : null; return (
              <tr key={m.key}>
                <td>{m.href ? <Link href={m.href}>{t(m.label.es, m.label.en)}</Link> : t(m.label.es, m.label.en)}{m.kind === "STATE" && <span className="sig wait" style={{ marginLeft: 6 }}>{closed ? t("foto al cierre", "snapshot at close") : t("foto de hoy", "today's snapshot")}</span>}{m.note && <span className="src block">{t(m.note.es, m.note.en)}</span>}{m.metric && <span className="block"><HowCalc id={m.metric} es={i.es} /></span>}</td>
                <td className="n mono"><b>{fmt(m, m.value)}</b></td>
                <td className="n mono">{pv != null ? fmt(m, pv) : "—"}</td>
                <td className="n mono">{d == null ? "—" : d === 0 ? t("igual", "same") : `${d > 0 ? "+" : "−"}${fmt(m, Math.abs(d)).replace("USD ", "")}`}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        </section>
      ))}
      <p className="src">{t("«En el mes» cuenta lo que ocurrió entre el primer y el último día. «Foto» es cómo estaban las cosas al calcular: SOLU no guarda la historia de saldos, por eso una foto solo queda fija al cerrar el mes. El bloque de Equipo (capacidad, desarrollo) llega con el módulo de Equipo.", "\"In the month\" counts what happened between the first and last day. \"Snapshot\" is how things stood when calculated: SOLU keeps no history of balances, so a snapshot is only fixed when the month is closed. The Team block (capacity, development) arrives with the Team module.")}</p>

      {canExportReports(user) && <p className="small"><a href={`/informes/pulso/csv?mes=${period}`}>{t("Descargar este informe (archivo para Excel)", "Download this report (file for Excel)")}</a> <span className="muted">· {t("solo Gerencia y Finanzas", "Management and Finance only")}</span></p>}

      {isGerencia(user) && (
        <section className="card" id="cierre">
          <b>{t("EMITIR EL INFORME DEL MES", "ISSUE THE MONTH'S REPORT")}</b>
          {ended && !closed && <p className="small"><span className="sig attn">{t("Listo para emitir", "Ready to issue")}</span> {t("Revisa las cifras de arriba. Al emitir, quedan guardadas como el informe oficial del mes.", "Review the figures above. On issuing, they are saved as the month's official report.")}</p>}
          {closed ? (
            <form action={reopenPulse} className="qa-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <input type="hidden" name="period" value={period} />
              <label>{t("Motivo para reabrir", "Reason to reopen")}<input name="reason" required maxLength={300} /></label>
              <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Reabrir el mes", "Reopen the month")}</button>
            </form>
          ) : ended ? (
            <form action={closePulse}><input type="hidden" name="period" value={period} /><button type="submit">{t(`Emitir el informe de ${period} con estas cifras`, `Issue the ${period} report with these figures`)}</button></form>
          ) : <p className="small muted">{t("El informe de un mes se emite cuando el mes ya terminó.", "A month's report is issued once the month has ended.")}</p>}
          {snaps.filter((s) => s.reopenedAt).map((s) => <p key={s.id} className="src">{t(`Cierre ${s.version} de ${s.closedByName} (${i.day(s.closedAt)}), reabierto por ${s.reopenedByName} el ${i.day(s.reopenedAt!)}: ${s.reopenReason}`, `Close ${s.version} by ${s.closedByName} (${i.day(s.closedAt)}), reopened by ${s.reopenedByName} on ${i.day(s.reopenedAt!)}: ${s.reopenReason}`)}</p>)}
        </section>
      )}
    </>
  );
}
