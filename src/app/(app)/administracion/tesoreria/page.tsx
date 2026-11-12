import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput } from "@/lib/domain";
import { treasuryView } from "@/lib/treasury";
import { BUCKETS, CONFIDENCE, PLAN_CATS, dirOf, type FItem } from "@/lib/treasury-rules";
import { FlowCols } from "@/components/Viz";
import { addPlanItem, addReserve, confirmBalance, endPlanItem, releaseReserve } from "./actions";

// Módulo 14 §2A, §8, §17 · Tesorería. From what the bank shows to what is really free, line by line (AC1), and
// what is coming at 7 / 30 / 60 / 90 days, each movement with how sure it is, its source and when it was observed.

export default async function TreasuryPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canFinance(user)) return <div className="note risk">{t("Tesorería es para Administración, Finanzas, Dirección y Gerencia.", "Treasury is for Administration, Finance, Direction and Management.")}</div>;
  const sp = await searchParams;
  const v = await treasuryView();
  const L = v.liq;
  const usd = (n: number) => `USD ${n < 0 ? "−" : ""}${i.n2(Math.abs(n))}`;
  const committed = v.items.filter((x) => x.committed && dirOf(x.bucket) === "OUT");
  const okMsg: Record<string, string> = { saldo: t("Saldo confirmado.", "Balance confirmed."), reserva: t("Reserva guardada.", "Reserve saved."), liberada: t("Reserva liberada: ese dinero vuelve a estar disponible.", "Reserve released: that money is available again."), plan: t("Movimiento agregado al plan.", "Movement added to the plan."), "plan-fin": t("Movimiento retirado del plan.", "Movement removed from the plan.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso para esto.", "You don't have permission for this."), saldo: t("Revisa el saldo: cuenta, valor, fecha (no futura) y de dónde sale el dato. No se guardó nada.", "Check the balance: account, amount, date (not in the future) and where the figure comes from. Nothing was saved."), reserva: t("Una reserva necesita tipo, valor, para qué es y quién lo decidió. No se guardó nada.", "A reserve needs kind, amount, what it is for and who decided it. Nothing was saved."), liberar: t("Escribe por qué se libera la reserva.", "Write why the reserve is released."), plan: t("Faltan datos: tipo, nombre, valor, fecha, qué tan seguro es y de dónde sale la cifra. No se guardó nada.", "Missing data: kind, name, amount, date, how sure it is and where the figure comes from. Nothing was saved.") };
  const itemRow = (x: FItem) => (
    <tr key={x.key}>
      <td>{x.href ? <Link href={x.href}>{x.label}</Link> : x.label}<span className="src block">{x.source}{x.observedAt ? ` · ${t("visto el", "observed")} ${i.day(x.observedAt)}` : ""}</span></td>
      <td className="n mono">{i.n2(x.amount)}</td>
      <td className="small">{x.on ? i.day(x.on) : <span className="muted">{t("sin fecha", "no date")}</span>}{x.due && x.on && +x.due !== +x.on ? <span className="src block">{t("vence por contrato", "contract due")} {i.day(x.due)}</span> : null}</td>
      <td><span className={`sig ${CONFIDENCE[x.confidence].tone}`}>{t(CONFIDENCE[x.confidence].es, CONFIDENCE[x.confidence].en)}</span></td>
    </tr>
  );

  return (
    <>
      <div className="ph"><div><h1>{t("Tesorería", "Treasury")}</h1><p>{t("De lo que hay en el banco a lo que está libre para usar, y lo que viene en los próximos 90 días. Lo que muestra el banco no es lo que se puede gastar.", "From what is in the bank to what is free to use, and what is coming in the next 90 days. What the bank shows is not what can be spent.")}</p>
        <p className="small">{t("calculado", "as of")} {i.date(v.asOf)}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {v.bank.length === 0 && <div className="note attn">{t("Todavía no hay cuentas bancarias. Créalas en Banco y confirma aquí su saldo.", "There are no bank accounts yet. Create them in Bank and confirm their balance here.")} <Link href="/administracion/banco">{t("Abrir Banco", "Open Bank")}</Link></div>}
      {v.missingBalance > 0 && v.bank.length > 0 && <div className="note attn">{t(`${v.missingBalance} cuenta(s) sin saldo confirmado: no entran en la cuenta de abajo.`, `${v.missingBalance} account(s) without a confirmed balance: they are not in the figures below.`)} <a href="#cuentas">{t("Confirmar saldos", "Confirm balances")}</a></div>}
      {v.staleBalance > 0 && <div className="note attn">{t(`${v.staleBalance} saldo(s) tienen más de 7 días. La proyección parte de un dato viejo.`, `${v.staleBalance} balance(s) are over 7 days old. The projection starts from an old figure.`)}</div>}

      <section className="card" id="liquidez">
        <b>{t("LIQUIDEZ DISPONIBLE", "AVAILABLE LIQUIDITY")}</b>
        <div className="tscroll"><table>
          <tbody>
            <tr><td>{t("En bancos, saldos confirmados", "In banks, confirmed balances")}<span className="src block">{v.bank.filter((a) => a.balance && a.currency === "USD").map((a) => `${a.label}: ${i.n2(a.balance!.amount)} (${i.day(a.balance!.observedAt)})`).join(" · ") || t("ningún saldo confirmado", "no confirmed balance")}</span></td><td className="n mono">{i.n2(L.bank)}</td></tr>
            <tr><td>− {t("Restringido (no se puede usar)", "Restricted (cannot be used)")}</td><td className="n mono">{i.n2(L.restricted)}</td></tr>
            <tr><td>− {t("Reservado para un propósito", "Reserved for a purpose")}</td><td className="n mono">{i.n2(L.reserved)}</td></tr>
            <tr><td>− {t("Comprometido: aprobado y aún sin pagar", "Committed: approved and not yet paid")}
              {committed.length > 0 && <details><summary className="small">{t(`Ver los ${committed.length} compromisos`, `See the ${committed.length} commitments`)}</summary><ul className="plain small">{committed.map((x) => <li key={x.key}>{x.href ? <Link href={x.href}>{x.label}</Link> : x.label} · <span className="mono">{i.n2(x.amount)}</span> · <span className="muted">{t(BUCKETS[x.bucket].es, BUCKETS[x.bucket].en)}</span></li>)}</ul></details>}
            </td><td className="n mono">{i.n2(L.committed)}</td></tr>
            <tr><td><b>= {t("Disponible", "Available")}</b></td><td className={`n mono ${L.available < 0 ? "risk-t" : ""}`}><b>{usd(L.available)}</b></td></tr>
          </tbody>
        </table></div>
        {L.otherCurrency.length > 0 && <p className="src">{t("En otra moneda, sin sumar ni convertir:", "In another currency, not added or converted:")} {L.otherCurrency.map((o, k) => <span key={k} className="mono" style={{ marginRight: 10 }}>{o.currency} {i.n2(o.amount)}{o.what === "RESERVE" ? ` (${t("reserva", "reserve")})` : ""}</span>)}</p>}
        {v.noUsd > 0 && <p className="src">{t(`${v.noUsd} movimiento(s) futuros están en otra moneda sin su valor en USD y no se cuentan aquí.`, `${v.noUsd} future movement(s) are in another currency without a USD value and are not counted here.`)}</p>}
      </section>

      <section className="card" id="proyeccion">
        <b>{t("CAJA PROYECTADA", "PROJECTED CASH")}</b>
        {v.proj.rows.some((r) => r.inflow > 0 || r.outflow > 0) && <FlowCols label={t("Lo que entra y lo que sale, acumulado a 7, 30, 60 y 90 días, y la caja que resulta", "What comes in and goes out, accumulated at 7, 30, 60 and 90 days, and the resulting cash")} inLabel={t("Entra (acumulado)", "In (accumulated)")} outLabel={t("Sale (acumulado)", "Out (accumulated)")} netLabel={t("Debajo de cada par: caja proyectada, en rojo si queda bajo cero", "Under each pair: projected cash, in red when below zero")} fmt={(n) => `${n < 0 ? "−" : ""}${i.n(Math.abs(n))}`} cols={v.proj.rows.map((r) => ({ label: t(`A ${r.days} días`, `At ${r.days} days`), inflow: r.inflow, outflow: r.outflow, net: r.projected }))} />}
        <div className="tscroll"><table>
          <thead><tr><th>{t("Horizonte", "Horizon")}</th><th className="n">{t("Entra", "In")}</th><th className="n">{t("Sale", "Out")}</th><th className="n">{t("Caja proyectada", "Projected cash")}</th></tr></thead>
          <tbody>
            <tr><td>{t("Hoy: bancos menos lo restringido y reservado", "Today: banks less restricted and reserved")}</td><td /><td /><td className="n mono">{i.n2(v.proj.start)}</td></tr>
            {v.proj.rows.map((r) => <tr key={r.days}><td>{t(`A ${r.days} días`, `At ${r.days} days`)}</td><td className="n mono">{i.n2(r.inflow)}</td><td className="n mono">{i.n2(r.outflow)}</td><td className={`n mono ${r.projected < 0 ? "risk-t" : ""}`}>{usd(r.projected)}</td></tr>)}
          </tbody>
        </table></div>
        <p className="src">{t("Lo vencido se cuenta desde hoy. Cada entrada usa la promesa del cliente si existe; si no, cómo paga de verdad; si no, el contrato. Nada es una probabilidad: abre el detalle para ver qué tan seguro es cada movimiento.", "Overdue items count from today. Each inflow uses the customer's promise when there is one; otherwise how they really pay; otherwise the contract. Nothing is a probability: open the detail to see how sure each movement is.")}
          {v.proj.undatedN > 0 ? ` ${t(`${v.proj.undatedN} movimiento(s) sin fecha quedan fuera: entran ${i.n2(v.proj.undatedIn)}, salen ${i.n2(v.proj.undatedOut)}.`, `${v.proj.undatedN} undated movement(s) are left out: in ${i.n2(v.proj.undatedIn)}, out ${i.n2(v.proj.undatedOut)}.`)}` : ""}</p>
        {v.low.gap > 0 ? (
          <div className="note risk">
            <b>{t(`Faltante de caja: USD ${i.n2(v.low.gap)}`, `Cash gap: USD ${i.n2(v.low.gap)}`)}</b> {v.low.lowOn ? t(`hacia el ${i.date(v.low.lowOn)}`, `around ${i.date(v.low.lowOn)}`) : ""}. {t("Lo que hoy existe y podría moverse:", "What exists today and could move:")}
            <ul className="plain small">
              <li>{t("Cartera vencida por cobrar", "Overdue receivables to collect")}: <span className="mono">{usd(v.levers.collectOverdue.usd)}</span> ({v.levers.collectOverdue.n}) · <Link href="/administracion/cobrar">{t("Cuentas por cobrar", "Receivables")}</Link></li>
              <li>{t("Entregado sin facturar", "Delivered, not invoiced")}: <span className="mono">{usd(v.levers.invoiceReady.usd)}</span> ({v.levers.invoiceReady.n}) · <Link href="/operaciones/por-facturar">{t("Facturar", "Invoice")}</Link></li>
              <li>{t("Salidas aún sin aprobar antes de esa fecha", "Outflows not yet approved before that date")}: <span className="mono">{usd(v.levers.deferrable.usd)}</span> ({v.levers.deferrable.n})</li>
              <li>{t("Reservado (liberarlo necesita quien lo decidió)", "Reserved (releasing it needs whoever decided it)")}: <span className="mono">{usd(v.levers.reserved)}</span></li>
            </ul>
            <span className="src">{t("Financiar el faltante es una decisión de Gerencia; SOLU no la propone.", "Funding the gap is a Management decision; SOLU doesn't propose it.")}</span>
          </div>
        ) : <p className="small"><span className="sig ok">{t("Sin faltante de caja en 90 días con lo que SOLU conoce", "No cash gap in 90 days with what SOLU knows")}</span>{v.low.lowOn ? <span className="muted"> · {t(`punto más bajo USD ${i.n2(v.low.low)} el ${i.day(v.low.lowOn)}`, `lowest point USD ${i.n2(v.low.low)} on ${i.day(v.low.lowOn)}`)}</span> : null}</p>}
      </section>

      <section className="card" id="futuro">
        <b>{t("LO QUE VIENE, POR TIPO", "WHAT IS COMING, BY KIND")}</b>
        <p className="src">{t("Lo contratado y lo entregado sin facturar no son cartera todavía: van aparte.", "What is contracted and what is delivered but not invoiced are not receivables yet: they are kept apart.")}</p>
        {v.groups.length === 0 ? <p className="small muted">{t("Nada por ahora.", "Nothing for now.")}</p> : v.groups.map((g) => (
          <details key={g.bucket}>
            <summary><span className={`sig ${BUCKETS[g.bucket].dir === "IN" ? "ok" : "wait"}`}>{BUCKETS[g.bucket].dir === "IN" ? t("entra", "in") : t("sale", "out")}</span> {t(BUCKETS[g.bucket].es, BUCKETS[g.bucket].en)} · <span className="mono">{usd(g.usd)}</span> <span className="muted small">({g.n})</span></summary>
            <div className="tscroll"><table>
              <thead><tr><th>{t("Qué", "What")}</th><th className="n">USD</th><th>{t("Cuándo", "When")}</th><th>{t("Certeza", "Certainty")}</th></tr></thead>
              <tbody>{g.items.slice(0, 60).map(itemRow)}</tbody>
            </table></div>
          </details>
        ))}
      </section>

      <section className="card" id="cuentas">
        <b>{t("CUENTAS Y SALDOS CONFIRMADOS", "ACCOUNTS AND CONFIRMED BALANCES")}</b>
        {v.bank.length === 0 ? <p className="small muted">{t("Sin cuentas.", "No accounts.")} <Link href="/administracion/banco">{t("Crear la cuenta en Banco", "Create the account in Bank")} →</Link></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cuenta", "Account")}</th><th className="n">{t("Saldo", "Balance")}</th><th>{t("Dato", "Figure")}</th><th>{t("Confirmar saldo", "Confirm balance")}</th></tr></thead>
            <tbody>{v.bank.map((a) => (
              <tr key={a.id}>
                <td><b>{a.label}</b><span className="src block">{a.bank}{a.last4 ? ` ···· ${a.last4}` : ""} · {a.currency}</span></td>
                <td className="n mono">{a.balance ? i.n2(a.balance.amount) : "—"}</td>
                <td className="small">{a.balance ? <>{i.day(a.balance.observedAt)} · {a.balance.source === "STATEMENT" ? t("extracto", "statement") : a.balance.source === "BANK_PORTAL" ? t("portal del banco", "bank portal") : t("escrito a mano", "typed")} · {a.balance.by}{a.age.stale ? <span className="sig attn"> {t(`hace ${a.age.days} días`, `${a.age.days} days ago`)}</span> : null}</> : <span className="sig attn">{t("sin confirmar", "not confirmed")}</span>}
                  {a.suggestion && <span className="src block">{t(`El extracto muestra ${i.n2(a.suggestion.amount)} al ${i.day(a.suggestion.date)}. Confírmalo si es correcto.`, `The statement shows ${i.n2(a.suggestion.amount)} as of ${i.day(a.suggestion.date)}. Confirm it if it is right.`)}</span>}</td>
                <td>
                  <form action={confirmBalance} className="qa-row" style={{ alignItems: "center" }}>
                    <input type="hidden" name="bankAccountId" value={a.id} />
                    <input name="amount" inputMode="decimal" required defaultValue={a.suggestion ? String(a.suggestion.amount) : ""} placeholder={t("Saldo", "Balance")} aria-label={t("Saldo", "Balance")} style={{ width: 120 }} />
                    <input type="date" name="observedAt" required defaultValue={dayInput(a.suggestion?.date ?? v.today)} max={dayInput(v.today)} aria-label={t("Fecha del saldo", "Balance date")} />
                    <select name="source" defaultValue={a.suggestion ? "STATEMENT" : "BANK_PORTAL"} aria-label={t("De dónde sale", "Source")}><option value="BANK_PORTAL">{t("Portal del banco", "Bank portal")}</option><option value="STATEMENT">{t("Extracto", "Statement")}</option><option value="TYPED">{t("Otro", "Other")}</option></select>
                    <button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Confirmar", "Confirm")}</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="src">{t("Un saldo confirmado nunca se edita: uno nuevo queda como el vigente y el anterior como historia.", "A confirmed balance is never edited: a new one becomes current and the earlier one stays as history.")} <Link href="/administracion/banco">{t("Cuentas y extractos en Banco", "Accounts and statements in Bank")}</Link></p>
      </section>

      <section className="card" id="reservas">
        <b>{t("DINERO RESTRINGIDO O RESERVADO", "RESTRICTED OR RESERVED MONEY")}</b>
        {v.reserves.length === 0 ? <p className="small muted">{t("Nada apartado.", "Nothing set aside.")} {t("Usa «Apartar dinero», aquí abajo.", "Use “Apartar dinero”, just below.")}</p> : (
          <ul className="plain small">{v.reserves.map((r) => (
            <li key={r.id}><span className={`sig ${r.kind === "RESTRICTED" ? "risk" : "wait"}`}>{r.kind === "RESTRICTED" ? t("Restringido", "Restricted") : t("Reservado", "Reserved")}</span> <b>{r.purpose}</b> · <span className="mono">{r.currency} {i.n2(r.amount)}</span> · {t("decidió", "decided by")} {r.authorityName}{r.until ? ` · ${t("hasta", "until")} ${i.day(r.until)}` : ""}
              <form action={releaseReserve.bind(null, r.id)} className="qa-row" style={{ alignItems: "center", marginTop: 4 }}><input name="note" required placeholder={t("Por qué se libera", "Why it is released")} aria-label={t("Por qué se libera", "Why it is released")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Liberar", "Release")}</button></form>
            </li>
          ))}</ul>
        )}
        <details><summary className="small">{t("Apartar dinero", "Set money aside")}</summary>
          <form action={addReserve} className="qa-form">
            <div className="qa-row">
              <label>{t("Tipo", "Kind")}<select name="kind"><option value="RESERVED">{t("Reservado para un propósito", "Reserved for a purpose")}</option><option value="RESTRICTED">{t("Restringido: no se puede usar", "Restricted: cannot be used")}</option></select></label>
              <label>{t("Valor (USD)", "Amount (USD)")}<input name="amount" inputMode="decimal" required /></label>
              <label>{t("Hasta (opcional)", "Until (optional)")}<input type="date" name="until" /></label>
            </div>
            <label>{t("Para qué es", "What it is for")}<input name="purpose" required maxLength={200} /></label>
            <label>{t("Quién lo decidió", "Who decided it")}<input name="authorityName" required maxLength={120} defaultValue={user.name} /></label>
            <div><button type="submit">{t("Guardar", "Save")}</button></div>
          </form>
        </details>
      </section>

      <section className="card" id="plan">
        <b>{t("LO QUE SOLU NO PUEDE SABER SOLO: NÓMINA, IMPUESTOS, FINANCIACIÓN", "WHAT SOLU CANNOT KNOW BY ITSELF: PAYROLL, TAXES, FINANCING")}</b>
        {v.plan.length === 0 ? <p className="small muted">{t("Nada escrito todavía. Sin esto la proyección no incluye la nómina ni los impuestos.", "Nothing typed yet. Without this the projection includes no payroll or taxes.")} {t("Usa «Agregar un movimiento», aquí abajo.", "Use “Agregar un movimiento”, just below.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("Valor", "Amount")}</th><th>{t("Cuándo", "When")}</th><th>{t("Certeza y fuente", "Certainty and source")}</th><th /></tr></thead>
            <tbody>{v.plan.map((p) => (
              <tr key={p.id}><td><span className={`sig ${p.direction === "IN" ? "ok" : "wait"}`}>{p.direction === "IN" ? t("entra", "in") : t("sale", "out")}</span> {p.label}<span className="src block">{PLAN_CATS[p.category] ? t(PLAN_CATS[p.category].es, PLAN_CATS[p.category].en) : p.category}</span></td>
                <td className="n mono">{p.currency} {i.n2(p.amount)}</td>
                <td className="small">{i.day(p.dueOn)}{p.repeat === "MONTHLY" ? ` · ${t("cada mes", "monthly")}${p.repeatUntil ? ` ${t("hasta", "until")} ${i.day(p.repeatUntil)}` : ""}` : ""}</td>
                <td className="small">{CONFIDENCE[p.confidence as keyof typeof CONFIDENCE] ? t(CONFIDENCE[p.confidence as keyof typeof CONFIDENCE].es, CONFIDENCE[p.confidence as keyof typeof CONFIDENCE].en) : p.confidence} · {p.source}<span className="src block">{t("visto el", "observed")} {i.day(p.observedAt)} · {p.createdByName}</span></td>
                <td><form action={endPlanItem.bind(null, p.id)}><button type="submit" className="secondary sm" data-confirm={t("¿Retirar este movimiento del plan?", "Remove this movement from the plan?")}>{t("Retirar", "Remove")}</button></form></td></tr>
            ))}</tbody>
          </table></div>
        )}
        <details><summary className="small">{t("Agregar un movimiento", "Add a movement")}</summary>
          <form action={addPlanItem} className="qa-form">
            <div className="qa-row">
              <label>{t("Entra o sale", "In or out")}<select name="direction"><option value="OUT">{t("Sale", "Out")}</option><option value="IN">{t("Entra", "In")}</option></select></label>
              <label>{t("Tipo", "Kind")}<select name="category">{Object.entries(PLAN_CATS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
              <label>{t("Valor (USD)", "Amount (USD)")}<input name="amount" inputMode="decimal" required /></label>
            </div>
            <label>{t("Nombre", "Name")}<input name="label" required maxLength={160} placeholder={t("Ej.: Nómina de noviembre", "E.g. November payroll")} /></label>
            <div className="qa-row">
              <label>{t("Fecha", "Date")}<input type="date" name="dueOn" required /></label>
              <label>{t("Se repite", "Repeats")}<select name="repeat"><option value="NONE">{t("No", "No")}</option><option value="MONTHLY">{t("Cada mes", "Every month")}</option></select></label>
              <label>{t("Hasta (si se repite)", "Until (if it repeats)")}<input type="date" name="repeatUntil" /></label>
            </div>
            <div className="qa-row">
              <label>{t("Qué tan seguro es", "How sure it is")}<select name="confidence" defaultValue="EXPECTED">{Object.entries(CONFIDENCE).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
              <label style={{ flex: 2 }}>{t("De dónde sale la cifra", "Where the figure comes from")}<input name="source" required maxLength={200} placeholder={t("Ej.: liquidación de nómina de octubre", "E.g. October payroll run")} /></label>
            </div>
            <div><button type="submit">{t("Agregar", "Add")}</button></div>
          </form>
        </details>
      </section>
    </>
  );
}
