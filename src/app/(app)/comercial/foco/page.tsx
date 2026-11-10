import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { focusViews, getFocusPolicy, type FocusItem } from "@/lib/focus";
import { saveFocusPolicy } from "./actions";

// Comercial C8c · High-Value Focus (v1.3 §60). Where the value is and what could move it. Each person sees their own
// Journeys; management can look at one person or the whole company. Never a list of people by result.

export default async function FocusPage({ searchParams }: { searchParams: Promise<{ u?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const people = manage ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const scope = manage ? (sp.u === "all" ? null : sp.u && people.some((p) => p.id === sp.u) ? sp.u : user.id) : user.id;
  const pol = await getFocusPolicy();
  const v = await focusViews(scope, pol.value);
  const okMsg: Record<string, string> = { guardada: t("Política guardada como nueva versión.", "Policy saved as a new version."), igual: t("Sin cambios.", "No changes.") };
  const errMsg: Record<string, string> = { permiso: t("Solo la dirección cambia la política.", "Only management changes the policy."), valor: t("Revisa los valores (hora en formato 17:00).", "Check the values (time as 17:00).") };
  const showOwner = scope !== user.id;

  const Row = ({ x }: { x: FocusItem }) => (
    <tr>
      <td><b>{x.account}</b><span className="block small"><Link href={`/deals/${x.dealId}`}>{x.code ?? ""} {x.solution}</Link></span>{showOwner && <span className="src block">{x.owner}</span>}</td>
      <td className="n mono">{x.sale != null ? i.money(x.sale) : "—"}</td>
      <td className="n mono"><b>{x.esagara != null ? i.money(x.esagara) : "—"}</b><span className="block small">{i.pct(x.pct)}</span></td>
      <td className="small">{t(x.position.es, x.position.en)}{x.nextDecision && <span className={`block${x.nextDecision < new Date() ? " risk-t" : ""}`}>{t("Decide", "Decides")} {i.day(x.nextDecision)}</span>}</td>
      <td className="small">{x.nextMove ?? "—"}{x.nextMoveDate && <span className="muted"> · {i.day(x.nextMoveDate)}</span>}</td>
      <td className="small">{x.risks.length === 0 ? <span className="muted">—</span> : x.risks.slice(0, 2).map((r, k) => <span key={k} className="block risk-t">{t(r.es, r.en)}</span>)}</td>
    </tr>
  );
  const Table = ({ rows, empty }: { rows: FocusItem[]; empty: string }) => rows.length === 0 ? <p className="small muted">{empty}</p> : (
    <div className="tscroll"><table>
      <thead><tr><th>{t("Cliente · solución", "Customer · solution")}</th><th className="n">{t("Venta", "Sale")}</th><th className="n">Eságara</th><th>{t("Posición · decisión", "Position · decision")}</th><th>{t("Próximo movimiento", "Next movement")}</th><th>{t("Riesgo", "Risk")}</th></tr></thead>
      <tbody>{rows.map((x) => <Row key={x.dealId} x={x} />)}</tbody>
    </table></div>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Foco de alto valor", "High-value focus")}</h1>
          <p>{t("Dónde está el valor y qué lo puede mover. Eságara en $ y %, la próxima decisión, el próximo movimiento y el riesgo que importa.", "Where the value is and what can move it. Eságara in $ and %, the next decision, the next movement and the risk that matters.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {manage && (
        <form method="get" className="goal-pick" style={{ marginBottom: 10 }}>
          <label>{t("Ver", "View")}<select name="u" defaultValue={scope ?? "all"}><option value="all">{t("Toda la empresa", "Whole company")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button type="submit" className="secondary">{t("Ver", "View")}</button>
        </form>
      )}

      {v.attention.length > 0 && (
        <section className="card" id="atencion">
          <b>{t(`Alto valor sin movimiento (≥ ${i.money(pol.value.materialEsagaraUsd)} de Eságara, ${pol.value.staleDays}+ días)`, `High value without movement (≥ ${i.money(pol.value.materialEsagaraUsd)} Eságara, ${pol.value.staleDays}+ days)`)}</b>
          <Table rows={v.attention} empty="" />
        </section>
      )}
      <section className="card" id="top5"><b>{t("Top 5 por Eságara", "Top 5 by Eságara")}</b><Table rows={v.top5} empty={t("Aún no hay Journeys con cotización.", "No Journeys with a quote yet.")} /></section>
      <section className="card" id="mes"><b>{t("Lo que se mueve este mes", "Month movers")}</b><p className="src">{t("Decisiones del cliente esperadas antes de que termine el mes.", "Customer decisions expected before the month ends.")}</p><Table rows={v.monthMovers} empty={t("Ninguna decisión esperada este mes.", "No decisions expected this month.")} /></section>
      <section className="card" id="decisiones"><b>{t(`Decisiones que vienen (${pol.value.decisionsDays} días)`, `Decisions coming (${pol.value.decisionsDays} days)`)}</b><Table rows={v.decisionsComing} empty={t("Nada en este horizonte.", "Nothing in this horizon.")} /></section>
      <section className="card" id="proteger"><b>{t("Negocios para proteger", "Deals to protect")}</b><p className="src">{t("Aceptados y en ejecución, con algún riesgo abierto.", "Accepted and in execution, with an open risk.")}</p><Table rows={v.toProtect} empty={t("Ningún negocio aceptado con riesgo abierto.", "No accepted deal with an open risk.")} /></section>

      <section className="card" id="dinero">
        <b>{t("Dinero por mover", "Money to move")}</b> · <Link href="/comercial/dinero" className="small">{t("Ver todo", "See all")} →</Link>
        {v.moneyToMove.length === 0 ? <p className="small muted">{t("Sin caja bloqueada.", "No blocked cash.")}</p> : (
          <ul className="mk-ul">{v.moneyToMove.map((b) => <li key={b.id}><b className="mono">{i.money(b.blockedValue)}</b> · {b.deal.account.name} · <Link href={`/deals/${b.deal.id}`}>{b.deal.code ?? b.deal.title}</Link> — {b.narrative}<span className="muted"> → {b.nextMovement}{showOwner ? ` · ${b.deal.owner.name}` : ""}</span></li>)}</ul>
        )}
      </section>

      <section className="card" id="futuro">
        <b>{t("Constructores de futuro", "Future builders")}</b>
        <p className="src">{t("Necesidades nuevas (90 días) aún sin cotización, y futuro visible en los próximos 12 meses.", "New needs (90 days) not yet quoted, and visible future in the next 12 months.")}</p>
        {v.futureBuilders.length === 0 && v.futures.length === 0 ? <p className="small muted">{t("Nada por ahora.", "Nothing for now.")}</p> : (
          <ul className="mk-ul">
            {v.futureBuilders.map((x) => <li key={x.dealId}><Link href={`/deals/${x.dealId}`}>{x.code ?? x.solution}</Link> · {x.account} — {x.desiredResult}{x.nextMove ? <span className="muted"> → {x.nextMove}</span> : <span className="risk-t"> · {t("sin próximo paso", "no next step")}</span>}</li>)}
            {v.futures.map((f) => <li key={f.id}>{f.account ? <Link href={`/accounts/${f.account.id}`}>{f.account.name}</Link> : "—"} · {f.description}{f.expectedAt && <span className="muted"> · {i.day(f.expectedAt)}</span>}</li>)}
          </ul>
        )}
      </section>

      <section className="card" id="politica">
        <b>{t("Política de foco", "Focus policy")} · v{pol.version}</b>
        {manage ? (
          <form action={saveFocusPolicy} className="qa-form" style={{ maxWidth: 520 }}>
            <label>{t("Valor material: Eságara mínima (USD)", "Material value: minimum Eságara (USD)")}<input name="materialEsagaraUsd" type="number" min={0} step="1" defaultValue={pol.value.materialEsagaraUsd} /></label>
            <label>{t("Días sin movimiento para llamar la atención", "Days without movement to flag")}<input name="staleDays" type="number" min={1} max={90} defaultValue={pol.value.staleDays} /></label>
            <label>{t("Horizonte de decisiones (días)", "Decisions horizon (days)")}<input name="decisionsDays" type="number" min={1} max={90} defaultValue={pol.value.decisionsDays} /></label>
            <label>{t("Hora del cierre diario de gestión (Bogotá)", "Daily management close time (Bogotá)")}<input name="closeTime" defaultValue={pol.value.closeTime} pattern="[0-2][0-9]:[0-5][0-9]" /></label>
            <button type="submit">{t("Guardar como nueva versión", "Save as new version")}</button>
          </form>
        ) : <p className="small">{t(`Alto valor desde ${i.money(pol.value.materialEsagaraUsd)} de Eságara; atención tras ${pol.value.staleDays} días sin movimiento. La cambia la dirección.`, `High value from ${i.money(pol.value.materialEsagaraUsd)} Eságara; flagged after ${pol.value.staleDays} days without movement. Management changes it.`)}</p>}
      </section>
    </>
  );
}
