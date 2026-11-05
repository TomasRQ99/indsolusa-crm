import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { computeCommissions, tiersOf, type CommissionRow, type Half } from "@/lib/commission";
import { halfLabel } from "@/lib/labels";
import { dayInput, today } from "@/lib/domain";
import { approveEarned, createPolicyVersion, markCommissionsPaid, requestCommissionReview } from "../actions";

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ u?: string; r?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const manager = canManageAll(user);
  const sp = await searchParams;
  // Each person sees only their own commissions; management can choose.
  // Management lands on the first person who has commissions (usually not themselves).
  const [people, firstDeal] = await Promise.all([
    manager ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    manager && !sp.u ? db.deal.findFirst({ where: { stage: "WON", ownerId: { not: user.id } }, orderBy: { updatedAt: "desc" }, select: { ownerId: true } }) : Promise.resolve(null),
  ]);
  const firstWithDeals = firstDeal?.ownerId;
  const personId = manager ? sp.u ?? firstWithDeals ?? user.id : user.id;
  const person = manager ? people.find((p) => p.id === personId) ?? { id: user.id, name: user.name } : { id: user.id, name: user.name };

  const [{ rows, policy, totals }, unpaidApproved] = await Promise.all([
    computeCommissions({ userId: person.id }),
    db.commissionEntry.aggregate({ where: { userId: person.id, paidAt: null }, _sum: { amount: true }, _count: true }),
  ]);
  const sel = rows.find((r) => r.key === sp.r) ?? rows.find((r) => !r.projected) ?? rows[0];
  const earned = rows.flatMap((r) => [r.saleHalf, r.collectionHalf]).filter((h) => h.state === "EARNED");
  const tiers = tiersOf(policy);
  const salePct = policy?.salePercent ?? 50;

  const HalfCell = ({ h }: { h: Half }) => {
    const l = halfLabel(i, h.state);
    return (
      <td style={{ borderLeft: "1px solid var(--line)" }}>
        <span className="val" style={{ marginRight: 6 }}>{h.state === "AT_RISK" ? `0 – ${i.n2(h.amount)}` : h.state === "LOST" ? "0" : `${h.state === "ESTIMATED" ? "≈ " : ""}${i.n2(h.amount)}`}</span>
        <span className={`sig ${l.cls}`}>{l.text}</span>
        {h.calc && <span className="src mono">{h.calc}</span>}
      </td>
    );
  };
  const Trace = ({ r }: { r: CommissionRow }) => (
    <span className="trc">
      <i className={r.trace.delivered ? "y" : ""}>{t("Ent", "Del")}</i>
      <i className={r.trace.invoiced ? "y" : ""}>{t("Fac", "Inv")}</i>
      <i className={r.trace.problem ? "x" : r.trace.collected ? "y" : ""}>{t("Cob", "Col")}</i>
      <i className={r.trace.reconciled ? "y" : ""}>{t("Con", "Rec")}</i>
    </span>
  );
  const fmtRange = (s: { lo: number; hi: number }) => (Math.abs(s.hi - s.lo) < 0.01 ? i.n2(s.hi) : `${i.n2(s.lo)} – ${i.n2(s.hi)}`);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Gerencia", "Management")} · {t("Comisiones", "Commissions")}</div>
          <h1>{t("Comisiones", "Commissions")} · {person.name}</h1>
          <p>{t(`Cada comisión se gana en dos mitades: ${salePct} % al emitir la factura y ${100 - salePct} % al conciliar el recaudo. Cada una con su cálculo.`, `Each commission is earned in two halves: ${salePct} % when the invoice is issued and ${100 - salePct} % when collection is reconciled. Each with its calculation.`)}</p>
        </div>
        <div className="grow" />
        {manager && (
          <form className="inline">
            <select name="u" defaultValue={person.id} aria-label={t("Persona", "Person")}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button className="secondary sm" type="submit">{t("Ver", "View")}</button>
          </form>
        )}
      </div>

      <div className="card" style={{ fontSize: 12 }}>
        {policy ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span><b>{t("Política", "Policy")} v{policy.version}</b> · {t("vigente desde", "in force since")} {i.date(policy.effectiveFrom)} · {t("aprobada por", "approved by")} {policy.approvedBy}</span>
            <span className="mono small">{t("venta", "sale")}: {t("esagra al facturar", "esagra at invoicing")} × {t("tramo", "tier")} × {salePct} % · {t("recaudo", "collection")}: ({t("esagra final", "final esagra")} × {t("tramo", "tier")}) − {t("lo ganado a la venta", "sale half")}</span>
            <span>{t("Tramos", "Tiers")}: {tiers.map((tr, k) => `${tr.min}${tiers[k + 1] ? `–${tiers[k + 1].min}` : "+"} % → ${tr.rate} %`).join(" · ")} · {t("cliente nuevo", "new customer")} +{i.n2(policy.newClientBonus)} pts · {t(`${policy.lossDays} días vencida: no se gana el recaudo`, `${policy.lossDays} days overdue: collection half not earned`)}</span>
          </div>
        ) : (
          <span className="attn-t">{t("Aún no hay política de comisiones. Administración la crea abajo.", "No commission policy yet. Admin creates it below.")}</span>
        )}
      </div>

      <section className="sum">
        <div><span className="k">{t("Estimada", "Estimated")}</span><span className="v">{totals.estimated.count ? `≈ ${fmtRange(totals.estimated)}` : "0"}</span><span className="s">{totals.estimated.count} {t("mitades por ganar", "halves to earn")}</span></div>
        <div><span className="k">{t("Ganada · por aprobar", "Earned · to approve")}</span><span className="v">{i.n2(totals.earned.hi)}</span><span className="s">{totals.earned.count} {t("mitades", "halves")}</span></div>
        <div><span className="k">{t("Aprobada", "Approved")}</span><span className="v">{i.n2(totals.approved.hi)}</span><span className="s">{totals.approved.count} {t("mitades · nómina", "halves · payroll")}</span></div>
        <div><span className="k">{t("Pagada", "Paid")}</span><span className="v">{i.n2(totals.paid.hi)}</span><span className="s">{totals.paid.count} {t("mitades", "halves")}</span></div>
      </section>

      <div className="two">
        <div className="card flush">
          <table>
            <thead><tr><th>{t("Journey · cliente", "Journey · customer")}</th><th className="n">{t("Venta", "Sale")}</th><th className="n">{t("Esagra facturar → final", "Esagra invoice → final")}</th><th>{t("Ent → Con", "Del → Rec")}</th><th style={{ borderLeft: "1px solid var(--line)" }}>{salePct} % {t("a la venta", "at sale")}</th><th style={{ borderLeft: "1px solid var(--line)" }}>{100 - salePct} % {t("al recaudo", "at collection")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={sel?.key === r.key ? "sel" : undefined}>
                  <td><Link href={`/gerencia/comisiones?u=${person.id}&r=${r.key}`}><b className="mono">{r.dealCode}</b></Link><b style={{ display: "block" }}>{r.account}</b><span className="src">{r.invoiceNumber ? `${t("Factura", "Invoice")} ${r.invoiceNumber}` : t("Sin facturar", "Not invoiced")}{r.newClient ? ` · ${t("cliente nuevo", "new customer")}` : ""}</span></td>
                  <td className="n val">{i.n(r.sale)}</td>
                  <td className="n"><span className="val">{r.esagraAtIssue != null ? `${i.n(r.esagraAtIssue)} → ` : "≈ "}{i.n(r.esagraFinal)}</span><span className="src">{r.pctAtIssue != null ? `${i.pct(r.pctAtIssue)} → ` : ""}{i.pct(r.pctFinal)}</span></td>
                  <td><Trace r={r} />{r.dueAt && <span className="src">{t("vence", "due")} {i.day(r.dueAt)}</span>}</td>
                  <HalfCell h={r.saleHalf} />
                  <HalfCell h={r.collectionHalf} />
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("Aún no hay comisiones", "No commissions yet")}</b>{t("Aparecen cuando un Journey tiene OC aceptada.", "They appear once a Journey has an accepted PO.")}</td></tr>}
            </tbody>
          </table>
          <p className="src" style={{ padding: "8px 12px" }}>USD. {t("Estados derivados por mitad: Estimada → Ganada (factura emitida o recaudo conciliado) → Aprobada (Gerencia) → Pagada (nómina). Nadie los cambia a mano.", "Derived states per half: Estimated → Earned (invoice issued or collection reconciled) → Approved (management) → Paid (payroll). Nobody changes them by hand.")}</p>
        </div>

        <aside className="rail">
          <div className="card">
            <span className="k">{t("Liquidación", "Settlement")}</span>
            <p className="small" style={{ margin: "6px 0 10px" }}>{earned.length ? t(`${earned.length} mitades ganadas, listas para aprobar.`, `${earned.length} earned halves ready to approve.`) : t("No hay mitades ganadas pendientes de aprobar.", "No earned halves pending approval.")}</p>
            {manager && person.id !== user.id && earned.length > 0 && (
              <form action={approveEarned.bind(null, person.id)}><button className="wide" type="submit">{t(`Aprobar las ${earned.length} mitades · USD ${i.n2(totals.earned.hi)}`, `Approve the ${earned.length} halves · USD ${i.n2(totals.earned.hi)}`)}</button></form>
            )}
            {user.role === "ADMIN" && unpaidApproved._count > 0 && (
              <form action={markCommissionsPaid.bind(null, person.id)} className="inline" style={{ marginTop: 10 }}>
                <input name="payrollRef" required placeholder={t("Comprobante de nómina", "Payroll reference")} style={{ flex: 1 }} />
                <button className="secondary sm" type="submit">{t(`Marcar pagadas (${i.n2(unpaidApproved._sum.amount)})`, `Mark paid (${i.n2(unpaidApproved._sum.amount)})`)}</button>
              </form>
            )}
            <details style={{ marginTop: 10 }}>
              <summary>{t("Pedir revisión de un cálculo", "Ask for a calculation review")}</summary>
              <form action={requestCommissionReview} className="stack">
                <textarea name="note" required placeholder={t("Qué Journey y qué te parece distinto", "Which Journey and what looks different")} />
                <button className="secondary" type="submit">{t("Enviar a Gerencia", "Send to management")}</button>
              </form>
            </details>
            <p className="src" style={{ marginTop: 8 }}>{t("Aprueba Gerencia. Cada persona ve solo sus comisiones y puede pedir revisión; nadie aprueba las propias.", "Management approves. Each person sees only their own and can ask for review; nobody approves their own.")}</p>
          </div>

          {sel && (
            <div className="card">
              <span className="k">{sel.dealCode} · {sel.account}</span>
              <h2 style={{ marginTop: 6 }}>{sel.dealTitle}</h2>
              <div className="mono small" style={{ background: "var(--surface-sunken)", borderRadius: 4, padding: "8px 10px", lineHeight: "20px" }}>
                {sel.esagraAtIssue != null ? (
                  <>
                    <span className="src">{t("A la venta", "At sale")} · {t("factura", "invoice")} {sel.invoiceNumber}</span>
                    <div>{i.n2(sel.esagraAtIssue)} <span className="src" style={{ display: "inline" }}>{t("esagra al facturar", "esagra at invoicing")} · {i.pct(sel.pctAtIssue)}</span></div>
                    <div>× {sel.rateAtIssue} % × {salePct} % = <b>{i.n2(sel.saleHalf.amount)}</b></div>
                    <hr style={{ border: 0, borderTop: "1px solid var(--line-strong)" }} />
                    <span className="src">{t("Al recaudo", "At collection")}</span>
                    <div>{i.n2(sel.esagraFinal)} <span className="src" style={{ display: "inline" }}>{t("esagra final", "final esagra")} · {i.pct(sel.pctFinal)}</span></div>
                    <div>× {sel.rateFinal} % = {i.n2((sel.esagraFinal * sel.rateFinal) / 100)} <span className="src" style={{ display: "inline" }}>total</span></div>
                    <div>− {i.n2(sel.saleHalf.amount)} = <b>{i.n2(sel.collectionHalf.amount)}</b></div>
                  </>
                ) : (
                  <span>{t("Proyectado: aún sin factura.", "Projected: not invoiced yet.")} ≈ {i.n2(sel.esagraFinal)} × {sel.rateFinal} %</span>
                )}
              </div>
              <ul className="timeline" style={{ marginTop: 8 }}>
                <li className="small">✓ {t("Política", "Policy")} v{sel.policyVersion ?? "—"} {t("vigente en la fecha de la OC", "in force on the PO date")}</li>
                <li className="small">✓ {t("Tramo", "Tier")}: {i.pct(sel.pctFinal)} → {sel.rateFinal} %{sel.newClient ? t(" (incluye cliente nuevo)", " (includes new customer)") : ""}</li>
                <li className="small">{sel.trace.reconciled ? "✓" : "…"} {t("Recaudo", "Collection")}: {sel.trace.reconciled ? t("conciliado", "reconciled") : sel.trace.collected ? t("recibido, por conciliar", "received, to reconcile") : t("pendiente", "pending")}</li>
              </ul>
              <p className="note ai" style={{ marginTop: 8 }}>{t("SOLU calcula con la política vigente y muestra cada paso. Nunca aprueba ni paga una comisión, ni cambia la política.", "SOLU calculates with the policy in force and shows each step. It never approves or pays a commission, or changes the policy.")}</p>
            </div>
          )}
        </aside>
      </div>

      {user.role === "ADMIN" && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary>{t("Nueva versión de la política", "New policy version")}</summary>
          <form action={createPolicyVersion} className="stack" style={{ maxWidth: 560 }}>
            <label>{t("Vigente desde", "In force from")}<input name="effectiveFrom" type="date" required defaultValue={dayInput(today())} /></label>
            <label>{t("Tramos (esagra % : comisión %), uno por línea", "Tiers (esagra % : commission %), one per line")}<textarea name="tiers" required defaultValue={tiers.length ? tiers.map((x) => `${x.min}:${x.rate}`).join("\n") : "0:0\n12:8\n18:10"} /></label>
            <div className="row">
              <label>{t("Bono cliente nuevo (pts)", "New customer bonus (pts)")}<input name="newClientBonus" type="number" step="0.5" defaultValue={policy ? Number(policy.newClientBonus) : 2} /></label>
              <label>{t("% a la venta", "% at sale")}<input name="salePercent" type="number" min="0" max="100" defaultValue={policy?.salePercent ?? 50} /></label>
              <label>{t("Días vencida para perder el recaudo", "Days overdue to lose collection half")}<input name="lossDays" type="number" defaultValue={policy?.lossDays ?? 90} /></label>
            </div>
            <label>{t("Aprobada por", "Approved by")}<input name="approvedBy" required /></label>
            <label>{t("Notas", "Notes")}<input name="notes" /></label>
            <button type="submit">{t("Crear versión", "Create version")}</button>
            <span className="src">{t("Las versiones anteriores no cambian: cada Journey usa la versión vigente en la fecha de su OC.", "Earlier versions don't change: each Journey uses the version in force on its PO date.")}</span>
          </form>
        </details>
      )}
    </>
  );
}
