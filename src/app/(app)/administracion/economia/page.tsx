import Link from "next/link";
import { GapBar } from "@/components/Viz";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { CATS, COST_CATS, ECON_STATES, type View } from "@/lib/economics-rules";
import { dealEconomics, getEsagaraPolicy } from "@/lib/economics";
import { isGerencia } from "@/lib/permissions";
import { saveEsagaraPolicy } from "./actions";

// Operaciones O9c · every accepted Journey with its protected Eságara next to what is expected today, so the ones
// that moved the most are seen first. One row per Journey; the detail and the explanation are on its own page.

export default async function EconomicsListPage({ searchParams }: { searchParams: Promise<{ ver?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const all = sp.ver === "todo";
  const pol = await getEsagaraPolicy();
  const edit = isGerencia(user);
  const deals = await db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" }, ...(all ? {} : { economicsState: { not: "FINAL" } }), quotes: { some: { status: "ACCEPTED", protSale: { gt: 0 } } } }, orderBy: { poAcceptedAt: "desc" }, take: 60, select: { id: true } });
  const rows = (await Promise.all(deals.map((d) => dealEconomics(d.id, pol)))).filter((e): e is NonNullable<typeof e> => !!e?.econ).map((e) => ({ e, gap: e.econ!.gap })).sort((a, b) => a.gap - b.gap);
  const v = (x: View) => <><span className="mono">{i.n2(x.esagara)}</span>{x.pct != null && <span className="src block mono">{i.pct(x.pct)}</span>}</>;
  const tot = (f: (e: (typeof rows)[number]["e"]) => number) => rows.reduce((s, r) => s + f(r.e), 0);
  const gapMax = Math.max(0, ...rows.map((r) => Math.abs(r.gap)));
  const gapTot = tot((e) => e.econ!.gap);
  const down = rows.filter((r) => r.gap < -0.005), ready = rows.filter((r) => r.e.d.economicsState !== "FINAL" && r.e.readiness.ready);

  return (
    <>
      <div className="ph"><div><h1>{t("Eságara real", "Real Eságara")}</h1><p>{t("Cada Journey aceptado: lo que se protegió al cotizar frente a lo que se espera hoy con los costos reales. Primero los que más bajaron. USD antes de IVA.", "Every accepted Journey: what was protected when quoting against what is expected today with real costs. Those that dropped most come first. USD before VAT.")}</p></div></div>
      {rows.length > 0 && (
        <section className="sum">
          <div><span className="k">{t("Eságara protegida", "Protected Eságara")}</span><span className="v">{i.n(tot((e) => e.econ!.prot.esagara))}</span><span className="s">USD · {rows.length} Journeys</span></div>
          <div><span className="k">{t("Esperada hoy", "Expected today")}</span><span className="v">{i.n(tot((e) => e.econ!.expected.esagara))}</span><span className="s">{t("con los costos reales", "with real costs")}</span></div>
          <div data-tone={gapTot < -0.005 ? "risk" : "ok"}><span className="k">{t("Cambio", "Change")}</span><span className="v">{gapTot > 0.005 ? "+" : gapTot < -0.005 ? "−" : ""}{i.n(Math.abs(gapTot))}</span><span className="s">{down.length > 0 ? t(`${down.length} Journey(s) bajaron`, `${down.length} Journey(s) dropped`) : t("ninguno bajó", "none dropped")}</span>{down[0] && <Link className="go" href={`/deals/${down[0].e.d.id}/economia`}>{t("Abrir el que más bajó", "Open the biggest drop")} →</Link>}</div>
          <div data-tone={ready.length > 0 ? "info" : undefined}><span className="k">{t("Listos para cerrar", "Ready to close")}</span><span className="v">{ready.length}</span><span className="s">{t("tienen todo para fijar su Eságara final", "have everything to fix their final Eságara")}</span>{ready[0] && <Link className="go" href="/administracion/cierre">{t("Ir a cerrar", "Go to close")} →</Link>}</div>
        </section>
      )}
      <section className="card">
        <p className="small">{all ? <Link href="/administracion/economia">{t("Ver solo los que siguen abiertos", "Show only those still open")}</Link> : <Link href="/administracion/economia?ver=todo">{t("Incluir los cerrados como final", "Include those closed as final")}</Link>}</p>
        {rows.length === 0 ? <p className="small muted">{t("Aún no hay Journeys aceptados con Eságara protegida.", "No accepted Journeys with protected Eságara yet.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Journey", "Journey")}</th><th className="n">{t("Protegida", "Protected")}</th><th className="n">{t("Esperada hoy", "Expected today")}</th><th className="n">{t("Cambio", "Change")}</th><th>{t("Causa principal", "Main cause")}</th><th>{t("Estado", "State")}</th><th>{t("¿Lista para cerrar?", "Ready to close?")}</th></tr></thead>
            <tbody>
              {rows.map(({ e, gap }) => { const S = ECON_STATES[e.d.economicsState] ?? ECON_STATES.OPEN; const main = [...e.econ!.lines].sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))[0]; return (
                <tr key={e.d.id}>
                  <td><Link href={`/deals/${e.d.id}/economia`}><b>{e.d.code ?? e.d.title}</b></Link><span className="src block">{e.d.account.name}</span></td>
                  <td className="n">{v(e.econ!.prot)}</td><td className="n">{v(e.econ!.expected)}</td>
                  <td className={`n mono ${gap < -0.005 ? "risk-t" : gap > 0.005 ? "ok-t" : ""}`}>{gap > 0 ? "+" : gap < 0 ? "−" : ""}{i.n2(Math.abs(gap))}<GapBar value={gap} max={gapMax} tip={`${e.d.code ?? e.d.title} · ${t("cambio", "change")} ${i.n2(gap)}`} /></td>
                  <td className="small">{main ? t(main.text.es, main.text.en) : <span className="muted">{t("Sin cambios", "No changes")}</span>}{e.otherCurrency.length > 0 && <span className="src block">{t("hay costos en otra moneda sin convertir", "there are costs in another currency, not converted")}</span>}</td>
                  <td><span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span></td>
                  <td className="small">{e.d.economicsState === "FINAL" ? "—" : e.readiness.ready ? <span className="sig ok">{t("Sí", "Yes")}</span> : <span className="muted">{t(`faltan ${e.readiness.criteria.filter((c) => !c.ok).length}`, `${e.readiness.criteria.filter((c) => !c.ok).length} missing`)}</span>}</td>
                </tr>
              ); })}
              <tr><td><b>{t(`Total de ${rows.length} Journeys`, `Total of ${rows.length} Journeys`)}</b></td><td className="n mono"><b>{i.n2(tot((e) => e.econ!.prot.esagara))}</b></td><td className="n mono"><b>{i.n2(tot((e) => e.econ!.expected.esagara))}</b></td><td className="n mono"><b>{i.n2(tot((e) => e.econ!.gap))}</b></td><td /><td /><td /></tr>
            </tbody>
          </table></div>
        )}
        <p className="src">{t("Se muestran hasta 60 Journeys, los más recientes. No incluye el costo de financiar el plazo de pago.", "Up to 60 Journeys, the most recent. The cost of financing the payment term is not included.")}</p>
      </section>

      <section className="card" id="politica">
        <b>{t("QUÉ CUENTA EN LA ESÁGARA", "WHAT COUNTS IN ESÁGARA")}</b> <span className="small muted">{pol.version ? t(`versión ${pol.version} · ${pol.by} · ${pol.at ? i.day(pol.at) : ""}`, `version ${pol.version} · ${pol.by} · ${pol.at ? i.day(pol.at) : ""}`) : t("valores iniciales, aún sin confirmar por Gerencia", "starting values, not yet confirmed by Management")}</span>
        {sp.ok === "politica" && <div className="note okn">{t("Política guardada como una versión nueva. Los cierres ya marcados como final no cambian.", "Policy saved as a new version. Closes already marked final don't change.")}</div>}
        {sp.err === "politica" && <div className="note risk">{t("Revisa los valores. El costo del proveedor siempre cuenta.", "Check the values. The supplier cost always counts.")}</div>}
        {sp.err === "permiso" && <div className="note risk">{t("Solo Gerencia cambia esta política.", "Only Management changes this policy.")}</div>}
        <p className="small">{t("Eságara = venta neta − costos directos que cuentan. No entran el IVA recuperable, la nómina general, el arriendo ni el mercadeo general.", "Eságara = net sale − direct costs that count. Recoverable VAT, general payroll, rent and general marketing never enter.")}</p>
        <form action={saveEsagaraPolicy} className="qa-form" style={{ maxWidth: 680 }}>
          <div className="qa-row" style={{ flexWrap: "wrap" }}>{CATS.map((c) => <label key={c} className="chk" style={{ flex: "0 0 auto" }}><input type="checkbox" name={`c_${c}`} value="1" defaultChecked={pol.value.counts[c]} disabled={!edit || c === "SUPPLIER"} /> {t(COST_CATS[c].es, COST_CATS[c].en)}</label>)}</div>
          <input type="hidden" name="c_SUPPLIER" value="1" />
          <label>{t("Diferencia que no justifica dejar un Journey abierto (USD)", "Difference that doesn't justify keeping a Journey open (USD)")}<input name="materialityUsd" inputMode="decimal" defaultValue={pol.value.materialityUsd} disabled={!edit} style={{ maxWidth: 160 }} /><span className="src">{t("Por debajo de este valor, una diferencia pendiente no impide cerrar. En 0, toda diferencia cuenta.", "Below this value, a pending difference doesn't prevent closing. At 0, every difference counts.")}</span></label>
          {edit ? <button type="submit">{t("Guardar política", "Save policy")}</button> : <span className="src">{t("Solo Gerencia la cambia.", "Only Management changes it.")}</span>}
        </form>
      </section>
    </>
  );
}
