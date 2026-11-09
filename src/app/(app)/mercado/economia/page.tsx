import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canImportData } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { explore, PAGE } from "@/lib/econ";
import { bigMoney } from "@/lib/fin-rules";

// Mercado M3 · Economic Explorer (§9.7): which companies look solid enough to be worth getting to know?
// Facts and trends only. No scores, no credit decisions.

type SP = { q?: string; sector?: string; place?: string; min?: string; cur?: string; g?: string; e?: string; p?: string; nc?: string; pl?: string; y?: string; page?: string };

export default async function EconomicExplorer({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = {
    q: sp.q?.trim().slice(0, 80) || undefined, sector: sp.sector?.trim().slice(0, 60) || undefined, place: sp.place?.trim().slice(0, 60) || undefined,
    minRev: Number(sp.min) > 0 ? Number(sp.min) : undefined, currency: sp.cur === "USD" ? "USD" : "COP",
    growing: sp.g === "1", equityPos: sp.e === "1", profitable: sp.p === "1", notCustomer: sp.nc === "1", withPlants: sp.pl === "1",
    year: Number(sp.y) > 1989 ? Number(sp.y) : undefined, page: Number(sp.page) > 0 ? Number(sp.page) : 1,
  };
  const r = await explore(f);
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  const qs = (page: number) => { const u = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]); u.set("page", String(page)); return `?${u}`; };
  const growth = (x: { revenue: number | null; prevRevenue: number | null }) => (x.revenue != null && x.prevRevenue && x.prevRevenue > 0 ? Math.round(((x.revenue - x.prevRevenue) / x.prevRevenue) * 1000) / 10 : null);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado">{t("Mercado", "Market")}</Link></div>
          <h1>{t("Explorador económico", "Economic explorer")}</h1>
          <p>{t("¿Qué empresas parecen lo bastante sólidas para que valga la pena conocerlas? Hechos y tendencias de fuentes públicas; nunca una decisión de crédito.", "Which companies look solid enough to be worth getting to know? Facts and trends from public sources; never a credit decision.")}</p>
        </div>
        {canImportData(user) && <Link href="/mercado/fuentes" className="btn secondary">{t("Fuentes de inteligencia", "Intelligence sources")}</Link>}
      </div>

      <form className="card mk-filters" method="get">
        <input name="q" defaultValue={sp.q} placeholder={t("Empresa o NIT", "Company or NIT")} />
        <input name="sector" defaultValue={sp.sector} list="mk-sectors" placeholder={t("Sector o CIIU", "Sector or CIIU")} />
        <datalist id="mk-sectors">{r.sectors.map((s) => <option key={s} value={s} />)}</datalist>
        <input name="place" defaultValue={sp.place} placeholder={t("Departamento o ciudad", "Department or city")} />
        <label className="row small">{t("Ingresos desde", "Revenue from")}<input name="min" type="number" min="0" defaultValue={sp.min} style={{ width: 110 }} /><select name="cur" defaultValue={f.currency}><option>COP</option><option>USD</option></select><span className="muted">{t("millones", "million")}</span></label>
        <select name="y" defaultValue={sp.y ?? ""}><option value="">{t("Último año disponible", "Latest year available")}</option>{r.years.map((y) => <option key={y} value={y}>FY{y}</option>)}</select>
        <label className="loc-check"><input type="checkbox" name="g" value="1" defaultChecked={f.growing} /> {t("Ingresos creciendo", "Revenue growing")}</label>
        <label className="loc-check"><input type="checkbox" name="e" value="1" defaultChecked={f.equityPos} /> {t("Patrimonio positivo", "Positive equity")}</label>
        <label className="loc-check"><input type="checkbox" name="p" value="1" defaultChecked={f.profitable} /> {t("Con utilidad", "Profitable")}</label>
        <label className="loc-check"><input type="checkbox" name="nc" value="1" defaultChecked={f.notCustomer} /> {t("Aún no son clientes ni prospectos", "Not customers or prospects yet")}</label>
        <label className="loc-check"><input type="checkbox" name="pl" value="1" defaultChecked={f.withPlants} /> {t("Con plantas conocidas", "With known plants")}</label>
        <button type="submit">{t("Buscar", "Search")}</button>
        {Object.values(sp).some(Boolean) && <Link href="/mercado/economia" className="small">{t("Limpiar", "Clear")}</Link>}
      </form>

      {r.total === 0 ? (
        <div className="card empty"><b>{r.years.length ? t("Ninguna empresa cumple estos filtros", "No company matches these filters") : t("Aún no hay datos económicos", "No economic data yet")}</b>
          <span className="src block">{r.years.length ? t("Prueba con menos filtros.", "Try fewer filters.") : t("Cuando se cargue un archivo de Supersociedades en Fuentes de inteligencia, aquí podrás filtrar miles de empresas por tamaño, sector, región y tendencia.", "Once a Supersociedades file is loaded in Intelligence sources, you'll be able to filter thousands of companies by size, sector, region and trend here.")}</span></div>
      ) : (
        <>
          <p className="small muted">{t(`${i.n(r.total)} empresas · ordenadas por ingresos`, `${i.n(r.total)} companies · sorted by revenue`)}</p>
          <div className="card flush mk-scroll">
            <table>
              <thead><tr><th>{t("Empresa", "Company")}</th><th className="n">{t("Ingresos", "Revenue")}</th><th className="n">{t("vs. año anterior", "vs. prior year")}</th><th>{t("Patrimonio · utilidad", "Equity · profit")}</th><th>{t("Señales", "Signals")}</th><th>{t("Relación", "Relationship")}</th></tr></thead>
              <tbody>{r.list.map((x) => {
                const g = growth(x);
                return (
                  <tr key={x.id}>
                    <td><Link href={`/mercado/economia/${x.id}`}><b>{x.name}</b></Link><span className="src">NIT {x.nit}{x.sector ? ` · ${x.sector}` : ""}{x.city || x.department ? ` · ${[x.city, x.department].filter(Boolean).join(", ")}` : ""}</span></td>
                    <td className="n">{bigMoney(x.currency, x.revenue, user.lang)}<span className="src">FY{x.fiscalYear}</span></td>
                    <td className="n">{g == null ? "—" : <span className={g >= 0 ? "" : "muted"}>{g > 0 ? "+" : ""}{i.n(g)} %</span>}</td>
                    <td className="small">{x.equity == null ? "—" : x.equity > 0 ? t("Positivo", "Positive") : t("Negativo", "Negative")} · {x.netIncome == null ? "—" : x.netIncome > 0 ? t("utilidad", "profit") : x.netIncome < 0 ? t("pérdida", "loss") : t("equilibrio", "break-even")}</td>
                    <td>{x.signals.slice(0, 2).map((s) => <span key={s.key} className={`sig ${s.tone === "good" ? "ok" : "attn"}`} style={{ marginRight: 4 }}>{t(s.es, s.en)}</span>)}{x.signals.length > 2 && <span className="small muted">+{x.signals.length - 2}</span>}</td>
                    <td className="small">{x.accountId ? <Link href={`/mercado/empresas/${x.accountId}`}>{x.relation === "CUSTOMER" ? t("Cliente", "Customer") : t("Prospecto", "Prospect")}</Link> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {pages > 1 && <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>{r.page > 1 && <Link href={qs(r.page - 1)}>← {t("Anterior", "Previous")}</Link>}<span className="small muted">{t(`Página ${r.page} de ${pages}`, `Page ${r.page} of ${pages}`)}</span>{r.page < pages && <Link href={qs(r.page + 1)}>{t("Siguiente", "Next")} →</Link>}</div>}
        </>
      )}
    </>
  );
}
