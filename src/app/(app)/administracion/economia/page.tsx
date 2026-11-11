import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { ECON_STATES, type View } from "@/lib/economics-rules";
import { dealEconomics } from "@/lib/economics";

// Operaciones O9c · every accepted Journey with its protected Eságara next to what is expected today, so the ones
// that moved the most are seen first. One row per Journey; the detail and the explanation are on its own page.

export default async function EconomicsListPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const all = (await searchParams).ver === "todo";
  const deals = await db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" }, ...(all ? {} : { economicsState: { not: "FINAL" } }), quotes: { some: { status: "ACCEPTED", protSale: { gt: 0 } } } }, orderBy: { poAcceptedAt: "desc" }, take: 60, select: { id: true } });
  const rows = (await Promise.all(deals.map((d) => dealEconomics(d.id)))).filter((e): e is NonNullable<typeof e> => !!e?.econ).map((e) => ({ e, gap: e.econ!.gap })).sort((a, b) => a.gap - b.gap);
  const v = (x: View) => <><span className="mono">{i.n2(x.esagara)}</span>{x.pct != null && <span className="src block mono">{i.pct(x.pct)}</span>}</>;
  const tot = (f: (e: (typeof rows)[number]["e"]) => number) => rows.reduce((s, r) => s + f(r.e), 0);

  return (
    <>
      <div className="ph"><div><h1>{t("Eságara real", "Real Eságara")}</h1><p>{t("Cada Journey aceptado: lo que se protegió al cotizar frente a lo que se espera hoy con los costos reales. Primero los que más bajaron. USD antes de IVA.", "Every accepted Journey: what was protected when quoting against what is expected today with real costs. Those that dropped most come first. USD before VAT.")}</p></div></div>
      <section className="card">
        <p className="small">{all ? <Link href="/administracion/economia">{t("Ver solo los que siguen abiertos", "Show only those still open")}</Link> : <Link href="/administracion/economia?ver=todo">{t("Incluir los cerrados como final", "Include those closed as final")}</Link>}</p>
        {rows.length === 0 ? <p className="small muted">{t("Aún no hay Journeys aceptados con Eságara protegida.", "No accepted Journeys with protected Eságara yet.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Journey", "Journey")}</th><th className="n">{t("Protegida", "Protected")}</th><th className="n">{t("Esperada hoy", "Expected today")}</th><th className="n">{t("Cambio", "Change")}</th><th>{t("Causa principal", "Main cause")}</th><th>{t("Estado", "State")}</th></tr></thead>
            <tbody>
              {rows.map(({ e, gap }) => { const S = ECON_STATES[e.d.economicsState] ?? ECON_STATES.OPEN; const main = [...e.econ!.lines].sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))[0]; return (
                <tr key={e.d.id}>
                  <td><Link href={`/deals/${e.d.id}/economia`}><b>{e.d.code ?? e.d.title}</b></Link><span className="src block">{e.d.account.name}</span></td>
                  <td className="n">{v(e.econ!.prot)}</td><td className="n">{v(e.econ!.expected)}</td>
                  <td className={`n mono ${gap < -0.005 ? "risk-t" : gap > 0.005 ? "ok-t" : ""}`}>{gap > 0 ? "+" : gap < 0 ? "−" : ""}{i.n2(Math.abs(gap))}</td>
                  <td className="small">{main ? t(main.text.es, main.text.en) : <span className="muted">{t("Sin cambios", "No changes")}</span>}{e.otherCurrency.length > 0 && <span className="src block">{t("hay costos en otra moneda sin convertir", "there are costs in another currency, not converted")}</span>}</td>
                  <td><span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span></td>
                </tr>
              ); })}
              <tr><td><b>{t(`Total de ${rows.length} Journeys`, `Total of ${rows.length} Journeys`)}</b></td><td className="n mono"><b>{i.n2(tot((e) => e.econ!.prot.esagara))}</b></td><td className="n mono"><b>{i.n2(tot((e) => e.econ!.expected.esagara))}</b></td><td className="n mono"><b>{i.n2(tot((e) => e.econ!.gap))}</b></td><td /><td /></tr>
            </tbody>
          </table></div>
        )}
        <p className="src">{t("Se muestran hasta 60 Journeys, los más recientes. No incluye el costo de financiar el plazo de pago.", "Up to 60 Journeys, the most recent. The cost of financing the payment term is not included.")}</p>
      </section>
    </>
  );
}
