import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia, isMoneyRole } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { computeCommissions } from "@/lib/commission";
import { settlementPreview, validPeriod, type RunLine } from "@/lib/settlement";
import { approveRun, payRun } from "./actions";

// Módulo 12 R4 · monthly commission settlement: preview of everything payable now, approval as one run, payment
// with its reference. Each line says how it was calculated.

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ mes?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const T = today();
  const period = sp.mes && validPeriod(sp.mes) ? sp.mes : `${T.getUTCFullYear()}-${String(T.getUTCMonth() + 1).padStart(2, "0")}`;
  const manager = canManageAll(user);
  const canPay = isGerencia(user) || isMoneyRole(user.role);
  // People below management see only their own lines; nobody sees someone else's commission without that role.
  const [{ rows }, runs] = await Promise.all([computeCommissions(manager || canPay ? {} : { userId: user.id }), db.commissionSettlementRun.findMany({ orderBy: [{ period: "desc" }, { version: "desc" }], take: 12 })]);
  const p = settlementPreview(rows, manager ? user.id : "");
  const half = (h: string) => (h === "SALE" ? t("al facturar", "at invoicing") : t("al recaudo", "at collection"));
  const okMsg: Record<string, string> = { aprobada: t("Liquidación aprobada. Quedó guardada con cada línea y su cálculo.", "Settlement approved. It was saved with each line and its calculation."), pagada: t("Pago registrado. Esas líneas ya no cambian.", "Payment recorded. Those lines no longer change.") };
  const errMsg: Record<string, string> = { permiso: t("Aprobar la liquidación corresponde a Gerencia o Dirección Comercial.", "Approving the settlement is for Management or Sales Direction."), "permiso-pago": t("Registrar el pago corresponde a Gerencia, Finanzas o Administración.", "Recording the payment is for Management, Finance or Administration."), periodo: t("Elige el mes.", "Choose the month."), nada: t("No hay nada por aprobar en este momento.", "There is nothing to approve right now."), corrida: t("Esa liquidación ya está pagada o no existe.", "That settlement is already paid or doesn't exist."), referencia: t("Escribe la referencia del pago (nómina, transferencia).", "Write the payment reference (payroll, transfer).") };
  const Lines = ({ ls }: { ls: RunLine[] }) => (
    <div className="tscroll"><table>
      <thead><tr><th>{t("Journey · cliente", "Journey · customer")}</th><th>{t("Factura", "Invoice")}</th><th>{t("Parte", "Part")}</th><th className="n">USD</th><th>{t("Cómo se calculó", "How it was calculated")}</th></tr></thead>
      <tbody>{ls.map((l, k) => <tr key={k}><td className="small"><Link href={`/deals/${l.dealId}/economia`}>{l.deal}</Link><span className="src block">{l.account}</span></td><td className="mono small">{l.invoice}</td><td className="small">{half(l.half)}{l.half === "COLLECTION" && l.seq > 0 ? ` · ${t(`parte ${l.seq + 1}`, `part ${l.seq + 1}`)}` : ""}</td><td className="n mono">{i.n2(l.amount)}</td><td className="small mono">{l.calc}<span className="src block">{t("política", "policy")} v{l.policyVersion ?? "?"}</span></td></tr>)}</tbody>
    </table></div>
  );

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/gerencia/comisiones">{t("Comisiones", "Commissions")}</Link> · {t("Liquidación", "Settlement")}</div>
        <h1>{t("Liquidación de comisiones", "Commission settlement")}</h1>
        <p>{t("Todo lo que hoy se puede pagar, persona por persona, con su cálculo. Al aprobar queda guardado tal como está; un cambio posterior no edita lo aprobado, aparece en una liquidación siguiente.", "Everything payable today, person by person, with its calculation. Approving saves it as it is; a later change never edits what was approved, it shows up in a later settlement.")}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="previa">
        <b>{t("POR APROBAR HOY", "TO APPROVE TODAY")} · <span className="mono">USD {i.n2(p.total)}</span></b>
        {p.byPerson.length === 0 ? <p className="small muted">{t("No hay comisiones por aprobar en este momento.", "No commissions to approve right now.")}</p> : p.byPerson.map((g) => (
          <div key={g.userId} style={{ marginTop: 10 }}><span className="k">{g.userName} · <span className="mono">USD {i.n2(g.total)}</span></span><span style={{ display: "block", maxWidth: 420 }}><span className="vz-cell left"><i className="attn" style={{ width: `${Math.max(2, (g.total / Math.max(1, ...p.byPerson.map((x) => x.total))) * 100)}%` }} title={`${g.userName}: USD ${i.n2(g.total)}`} /></span></span><Lines ls={g.lines} /></div>
        ))}
        {p.own > 0 && <p className="note attn">{t(`${p.own} línea(s) tuyas por USD ${i.n2(p.ownAmount)} no entran: nadie aprueba sus propias comisiones. Las aprueba otra persona de Gerencia o Dirección Comercial.`, `${p.own} line(s) of your own for USD ${i.n2(p.ownAmount)} are left out: nobody approves their own commissions. Another person in Management or Sales Direction approves them.`)}</p>}
        {p.excess.length > 0 && <div className="note attn"><b>{t("Aprobado de más frente a las cifras de hoy", "Approved in excess of today's figures")}</b><ul className="plain small">{p.excess.map((x, k) => <li key={k}>{x.userName} · {x.deal} · {x.invoice} · <span className="mono">USD {i.n2(x.over)}</span></li>)}</ul><span className="src">{t("SOLU no descuenta nada por su cuenta: falta definir la regla para devoluciones y ajustes.", "SOLU deducts nothing by itself: the rule for returns and adjustments is still to be defined.")}</span></div>}
        {manager && p.lines.length > 0 && (
          <form action={approveRun} className="qa-row" style={{ alignItems: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
            <label style={{ flex: "0 0 180px" }}>{t("Mes de la liquidación", "Settlement month")}<input name="period" type="month" required defaultValue={period} /></label>
            <button type="submit" style={{ flex: "0 0 auto" }}>{t(`Aprobar liquidación por USD ${i.n2(p.total)}`, `Approve settlement for USD ${i.n2(p.total)}`)}</button>
          </form>
        )}
      </section>

      <section className="card" id="corridas">
        <b>{t("LIQUIDACIONES", "SETTLEMENTS")}</b>
        {runs.length === 0 ? <p className="small muted">{t("Aún no se ha aprobado ninguna.", "None approved yet.")}</p> : runs.map((r) => { const ls = (r.lines as unknown as RunLine[]).filter((l) => manager || canPay || l.userId === user.id); return (
          <details key={r.id} className="qa" style={{ marginTop: 8 }} open={r.status === "APPROVED"}>
            <summary className="qa-btn"><span className="mono">{r.period}</span>{r.version > 1 ? ` · ${t(`corrida ${r.version}`, `run ${r.version}`)}` : ""} · <span className="mono">USD {i.n2(Number(r.total))}</span> · {r.status === "PAID" ? <span className="sig ok">{t("Pagada", "Paid")}</span> : <span className="sig attn">{t("Aprobada, sin pagar", "Approved, not paid")}</span>}</summary>
            <p className="small">{t("Aprobó", "Approved by")} {r.approvedByName} · {i.day(r.approvedAt)}{r.paidAt ? ` · ${t("pagó", "paid by")} ${r.paidByName} · ${i.day(r.paidAt)} · ${r.payrollRef}` : ""}</p>
            {ls.length > 0 && <Lines ls={ls} />}
            {canPay && r.status === "APPROVED" && (
              <form action={payRun.bind(null, r.id)} className="qa-row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                <label>{t("Referencia del pago (nómina, transferencia)", "Payment reference (payroll, transfer)")}<input name="payrollRef" required maxLength={120} /></label>
                <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Registrar pago", "Record payment")}</button>
              </form>
            )}
          </details>
        ); })}
      </section>
    </>
  );
}
