import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAssignBudgets, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { SCOPE_KINDS } from "@/lib/admin-rules";
import { loadBudgets } from "@/lib/admin-store";
import { addBudgetEntry, adjustBudget, closeBudget, closeBudgetEntry, createBudget, setForecast } from "./actions";

// Módulo 14 §2F · Presupuesto: assigned, committed, spent and the owner's forecast. A commitment uses up the budget
// from the day it is approved, even if nothing has been paid (AC10).

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; ver?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const all = canFinance(user), ger = canAssignBudgets(user);
  const [rows, people] = await Promise.all([
    loadBudgets({ ...(all ? {} : { ownerId: user.id }), ...(sp.ver === "cerrados" ? {} : { closedAt: null }) }),
    ger ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const T = today();
  const okMsg: Record<string, string> = { creado: t("Presupuesto creado.", "Budget created."), ajustado: t("Valor del presupuesto cambiado. El cambio queda en el historial.", "Budget amount changed. The change is in the history."), pronostico: t("Pronóstico guardado.", "Forecast saved."), movimiento: t("Guardado.", "Saved."), cerrado: t("Presupuesto cerrado.", "Budget closed.") };
  const errMsg: Record<string, string> = { gerencia: t("Solo Gerencia o Finanzas asignan, cambian o cierran presupuestos.", "Only Management or Finance assign, change or close budgets."), datos: t("Faltan datos: nombre, tipo, responsable, fechas (la final después de la inicial) y valor. No se guardó nada.", "Missing data: name, kind, owner, dates (end after start) and amount. Nothing was saved."), valor: t("Escribe el valor nuevo.", "Type the new amount."), permiso: t("Solo el responsable del presupuesto, Administración, Finanzas o Gerencia.", "Only the budget owner, Administration, Finance or Management."), cerrado: t("Ese presupuesto está cerrado.", "That budget is closed."), pronostico: t("El pronóstico necesita un valor y en qué se basa.", "The forecast needs an amount and what it is based on."), movimiento: t("Falta el valor o la descripción.", "The amount or the description is missing."), cerrar: t("Escribe por qué se cierra el compromiso.", "Write why the commitment is closed."), "no-existe": t("No existe.", "It doesn't exist.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Presupuesto y gasto", "Budget and spend")}</h1><p>{t("Lo asignado, lo comprometido, lo gastado y lo que el responsable espera al final. Lo comprometido ya ocupa el presupuesto aunque todavía no se haya pagado.", "What is assigned, committed, spent and what the owner expects at the end. What is committed already uses the budget even if nothing has been paid yet.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {!all && <p className="small muted">{t("Ves los presupuestos de los que eres responsable.", "You see the budgets you own.")}</p>}

      {rows.length === 0 ? <div className="card"><p className="small muted">{t("No hay presupuestos todavía.", "There are no budgets yet.")} {ger ? t("Crea el primero abajo.", "Create the first one below.") : t("Los asignan Gerencia o Finanzas.", "Management or Finance assign them.")}</p></div> : rows.map((b) => {
        const v = b.view;
        const editable = !b.closedAt && (all || b.ownerId === user.id);
        return (
          <section key={b.id} id={`b-${b.id}`} className="card">
            <div><b>{b.name}</b> <span className="small muted">· {SCOPE_KINDS[b.scopeKind] ? t(SCOPE_KINDS[b.scopeKind].es, SCOPE_KINDS[b.scopeKind].en) : b.scopeKind} · {t("responsable", "owner")} {b.owner.name} · {i.day(b.periodFrom)} – {i.date(b.periodTo)}</span> {b.closedAt ? <span className="sig wait">{t("Cerrado", "Closed")}</span> : v.over ? <span className="sig risk">{t("Superado", "Exceeded")}</span> : b.periodTo < T ? <span className="sig attn">{t("Periodo terminado", "Period ended")}</span> : null}</div>
            <div className="tscroll"><table>
              <thead><tr><th className="n">{t("Presupuesto", "Budget")}</th><th className="n">{t("Comprometido", "Committed")}</th><th className="n">{t("Gastado", "Spent")}</th><th className="n">{t("Queda", "Left")}</th><th className="n">{t("Pronóstico del responsable", "Owner's forecast")}</th></tr></thead>
              <tbody><tr>
                <td className="n mono">{b.currency} {i.n2(v.amount)}</td><td className="n mono">{i.n2(v.committed)}</td><td className="n mono">{i.n2(v.spent)}</td>
                <td className={`n mono ${v.over ? "risk-t" : ""}`}>{v.available < 0 ? "−" : ""}{i.n2(Math.abs(v.available))}{v.usedPct != null ? <span className="src block">{t(`usado ${i.pct(v.usedPct)}`, `${i.pct(v.usedPct)} used`)}</span> : null}</td>
                <td className="n mono">{v.forecast == null ? <span className="muted">—</span> : <>{i.n2(v.forecast)}{v.forecastGap != null && v.forecastGap < 0 ? <span className="src block risk-t">{t(`${i.n2(-v.forecastGap)} sobre el presupuesto`, `${i.n2(-v.forecastGap)} over budget`)}</span> : null}</>}</td>
              </tr></tbody>
            </table></div>
            {v.asked > 0 && <p className="small">{t("Pedido y aún sin aprobar (no ocupa presupuesto todavía):", "Requested and not yet approved (doesn't use the budget yet):")} <span className="mono">{i.n2(v.asked)}</span></p>}
            {b.forecastNote && <p className="src">{t("Pronóstico", "Forecast")}: {b.forecastNote} · {b.forecastByName} · {b.forecastAt ? i.day(b.forecastAt) : ""}</p>}
            <details><summary className="small">{t(`De dónde salen las cifras (${b.lines.length})`, `Where the figures come from (${b.lines.length})`)}</summary>
              {b.lines.length === 0 ? <p className="small muted">{t("Nada todavía.", "Nothing yet.")}</p> : <ul className="plain small">{b.lines.map((l, k) => <li key={k}><span className={`sig ${l.kind === "SPENT" ? "ok" : l.kind === "COMMITTED" ? "wait" : "attn"}`}>{l.kind === "SPENT" ? t("gastado", "spent") : l.kind === "COMMITTED" ? t("comprometido", "committed") : t("pedido", "requested")}</span> {l.href ? <Link href={l.href}>{l.label}</Link> : l.label} · <span className="mono">{i.n2(l.amount)}</span>{l.on ? ` · ${i.day(l.on)}` : ""}</li>)}</ul>}
              {b.entries.filter((e) => e.kind === "COMMITTED" && !e.closedAt).length > 0 && editable && <div className="qa-form">{b.entries.filter((e) => e.kind === "COMMITTED" && !e.closedAt).map((e) => (
                <form key={e.id} action={closeBudgetEntry.bind(null, e.id)} className="qa-row" style={{ alignItems: "center" }}><span className="small" style={{ flex: 2 }}>{e.description} · <span className="mono">{i.n2(e.amount)}</span></span><input name="note" required placeholder={t("Por qué se cierra (se gastó, se canceló…)", "Why it is closed (spent, cancelled…)")} aria-label={t("Motivo", "Reason")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Cerrar compromiso", "Close commitment")}</button></form>
              ))}</div>}
            </details>
            {editable && <details><summary className="small">{t("Registrar un compromiso o un gasto que no está en otra parte de SOLU", "Record a commitment or a spend that isn't elsewhere in SOLU")}</summary>
              <form action={addBudgetEntry.bind(null, b.id)} className="qa-form">
                <div className="qa-row">
                  <label>{t("Qué es", "What it is")}<select name="kind"><option value="COMMITTED">{t("Compromiso (aún no pagado)", "Commitment (not paid yet)")}</option><option value="SPENT">{t("Gasto ya hecho", "Spend already made")}</option></select></label>
                  <label>{t("Valor", "Amount")}<input name="amount" inputMode="decimal" required /></label>
                  <label>{t("Fecha", "Date")}<input type="date" name="on" defaultValue={dayInput(T)} /></label>
                </div>
                <label>{t("Descripción", "Description")}<input name="description" required maxLength={200} /></label>
                <label>{t("Soporte (contrato, factura, correo)", "Evidence (contract, invoice, email)")}<input name="evidence" maxLength={200} /></label>
                <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
              </form>
              <p className="src">{t("Las compras internas y los viajes aprobados aparecen solos: no los escribas aquí.", "Approved internal purchases and trips appear by themselves: don't type them here.")}</p>
            </details>}
            {editable && <details><summary className="small">{t("Actualizar el pronóstico", "Update the forecast")}</summary>
              <form action={setForecast.bind(null, b.id)} className="qa-row" style={{ alignItems: "flex-end" }}>
                <label>{t("Total esperado al final", "Total expected at the end")}<input name="forecast" inputMode="decimal" required defaultValue={v.forecast ?? ""} /></label>
                <label style={{ flex: 2 }}>{t("En qué se basa", "What it is based on")}<input name="forecastNote" required maxLength={300} /></label>
                <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar", "Save")}</button>
              </form>
            </details>}
            {ger && !b.closedAt && <details><summary className="small">{t("Cambiar el valor o cerrar (Gerencia o Finanzas)", "Change the amount or close (Management or Finance)")}</summary>
              <div className="qa-row" style={{ alignItems: "flex-end" }}>
                <form action={adjustBudget.bind(null, b.id)} className="qa-row" style={{ alignItems: "flex-end" }}><label>{t("Valor nuevo", "New amount")}<input name="amount" inputMode="decimal" required defaultValue={v.amount} /></label><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Cambiar", "Change")}</button></form>
                <form action={closeBudget.bind(null, b.id)}><button type="submit" className="secondary" data-confirm={t("¿Cerrar este presupuesto? Ya no se podrá cargar nada a él.", "Close this budget? Nothing more can be charged to it.")}>{t("Cerrar presupuesto", "Close budget")}</button></form>
              </div>
            </details>}
            <p className="src">{t("asignó", "assigned by")} {b.approvedByName}</p>
          </section>
        );
      })}
      <p className="small">{sp.ver === "cerrados" ? <Link href="/administracion/presupuesto">{t("Ver solo los abiertos", "Show open only")}</Link> : <Link href="/administracion/presupuesto?ver=cerrados">{t("Ver también los cerrados", "Also show closed")}</Link>} · <Link href="/administracion/compras-internas">{t("Compras internas", "Internal purchases")}</Link></p>

      {ger && <section className="card" id="nuevo">
        <b>{t("ASIGNAR UN PRESUPUESTO", "ASSIGN A BUDGET")}</b>
        <form action={createBudget} className="qa-form">
          <div className="qa-row">
            <label style={{ flex: 2 }}>{t("Nombre", "Name")}<input name="name" required maxLength={120} placeholder={t("Ej.: Viajes comerciales 2027", "E.g. Commercial travel 2027")} /></label>
            <label>{t("Tipo", "Kind")}<select name="scopeKind">{Object.entries(SCOPE_KINDS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label>{t("Responsable", "Owner")}<select name="ownerId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</select></label>
          </div>
          <div className="qa-row">
            <label>{t("Desde", "From")}<input type="date" name="periodFrom" required /></label>
            <label>{t("Hasta", "To")}<input type="date" name="periodTo" required /></label>
            <label>{t("Valor (USD)", "Amount (USD)")}<input name="amount" inputMode="decimal" required /></label>
          </div>
          <div><button type="submit">{t("Asignar", "Assign")}</button></div>
        </form>
        <p className="src">{t("Los presupuestos se llevan en USD.", "Budgets are kept in USD.")}</p>
      </section>}
    </>
  );
}
