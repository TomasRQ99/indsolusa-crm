import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { groupPatterns, PATTERNS, type GroupBy, type GroupPatterns, type PatternKey } from "@/lib/econ";
import { growthTone } from "../../EconBlock";

// Mercado · patterns by sector or department across the years loaded. Like-for-like (same companies in both
// years), because the list of the 10,000 largest changes every year. Context to decide where to look, never a ranking.

type SP = { by?: string; only?: string };

export default async function Patterns({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const by: Exclude<GroupBy, "all"> = sp.by === "department" ? "department" : "sector";
  const only = sp.only?.trim().slice(0, 120) || null;
  const [all, data] = await Promise.all([groupPatterns("all"), groupPatterns(by, only)]);
  const years = all.years;
  const gYears = years.slice(1); // growth needs the year before
  const num = (v: number, d = 1) => new Intl.NumberFormat(user.lang === "EN" ? "en-US" : "es-CO", { maximumFractionDigits: d }).format(v);
  const pc = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v)} %`);
  const groups = (only ? data.groups : data.groups.slice(0, by === "department" ? 20 : 40)).filter((g) => g.companies >= 3);
  const explore = (g: string | null, k?: PatternKey) => { const u = new URLSearchParams(); if (g) u.set(by === "sector" ? "sector" : "place", g); if (k) u.set("pat", k); return `/mercado/economia?${u}`; };
  const label = (g: GroupPatterns["groups"][number]) => g.name ?? t("(sin dato)", "(not given)");
  const rowsWithAll = [...(only ? [] : all.groups.map((g) => ({ ...g, isAll: true }))), ...groups.map((g) => ({ ...g, isAll: false }))];
  const name = (g: (typeof rowsWithAll)[number]) => (g.isAll ? <b>{t("Todas las empresas", "All companies")}</b> : <Link href={`?by=${by}&only=${encodeURIComponent(g.name ?? "")}`}>{label(g)}</Link>);

  const table = (title: [string, string], note: [string, string], ys: number[], cell: (y: GroupPatterns["groups"][number]["years"][number] | undefined) => { text: string; cls?: string; tip?: string }) => (
    <div className="card flush mk-scroll">
      <p className="small" style={{ padding: "10px 16px 0" }}><b>{t(...title)}</b><span className="src block">{t(...note)}</span></p>
      <table className="ec-tab">
        <thead><tr><th>{t(by === "sector" ? "Sector" : "Departamento", by === "sector" ? "Sector" : "Department")}</th><th className="n">{t("Empresas", "Companies")}</th>{ys.map((y) => <th key={y} className="n">FY{y}</th>)}</tr></thead>
        <tbody>{rowsWithAll.map((g) => (
          <tr key={`${g.isAll}-${g.name}`}><td>{name(g)}</td><td className="n">{i.n(g.companies)}</td>{ys.map((y) => { const x = cell(g.years[y]); return <td key={y} className={`n ${x.cls ?? ""}`} title={x.tip}>{x.text}</td>; })}</tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado/economia">{t("Mercado · Explorador económico", "Market · Economic explorer")}</Link></div>
          <h1>{only ? only : t("Patrones por sector y región", "Patterns by sector and region")}</h1>
          <p>{t("Cómo se movieron las empresas de cada grupo año a año, con los datos cargados. Sirve para decidir dónde mirar; no es un ranking.", "How each group's companies moved year to year, with the data loaded. It helps decide where to look; it isn't a ranking.")}</p>
        </div>
        <Link href="/mercado/economia/comparar" className="btn secondary">{t("Comparar empresas", "Compare companies")}</Link>
      </div>

      <div className="row card">
        <span className="small">{t("Agrupar por", "Group by")}:</span>
        <Link href="?by=sector" className={by === "sector" && !only ? "btn small" : "btn secondary small"}>{t("Sector", "Sector")}</Link>
        <Link href="?by=department" className={by === "department" && !only ? "btn small" : "btn secondary small"}>{t("Departamento", "Department")}</Link>
        {only && <Link href={`?by=${by}`} className="small">{t("← Todos los grupos", "← All groups")}</Link>}
        <span className="src block" style={{ flexBasis: "100%" }}>{t(`Años con datos: ${years.map((y) => `FY${y}`).join(", ") || "ninguno"}. Solo cifras en COP.`, `Years with data: ${years.map((y) => `FY${y}`).join(", ") || "none"}. COP figures only.`)}</span>
      </div>

      {years.length < 2 ? (
        <div className="card empty"><b>{t("Hace falta más de un año de datos", "More than one year of data is needed")}</b><span className="src block">{t("Carga publicaciones de otros años en Fuentes de inteligencia para ver patrones.", "Load publications for other years in Intelligence sources to see patterns.")}</span></div>
      ) : (
        <>
          <section className="mk-sec">
            <h2>{t("Ingresos: crecimiento comparable", "Revenue: like-for-like growth")}</h2>
            {table(["Cambio de ingresos frente al año anterior", "Revenue change vs. the prior year"], ["Suma solo las empresas que reportaron ambos años (la lista de las 10.000 más grandes cambia cada año). Azul: sube; rojo: baja. Pasa el cursor para ver la mediana por empresa.", "Adds only companies that reported both years (the list of the 10,000 largest changes every year). Blue: up; red: down. Hover to see the median per company."], gYears,
              (y) => ({ text: pc(y?.growth), cls: growthTone(y?.growth ?? null), tip: y ? t(`${i.n(y.pairs)} empresas con ambos años · mediana por empresa ${pc(y.medGrowth)}`, `${i.n(y.pairs)} companies with both years · median per company ${pc(y.medGrowth)}`) : undefined }))}
          </section>
          <section className="mk-sec">
            <h2>{t("Rentabilidad", "Profitability")}</h2>
            {table(["Empresas con utilidad", "Companies with a profit"], ["Porcentaje de las empresas del grupo con utilidad neta positiva ese año. Pasa el cursor para ver el margen neto mediano.", "Share of the group's companies with positive net income that year. Hover to see the median net margin."], years,
              (y) => ({ text: y?.profitablePct == null ? "—" : `${y.profitablePct} %`, tip: y ? t(`${i.n(y.n)} empresas · margen neto mediano ${y.medMargin == null ? "—" : `${num(y.medMargin)} %`}`, `${i.n(y.n)} companies · median net margin ${y.medMargin == null ? "—" : `${num(y.medMargin)}%`}`) : undefined }))}
          </section>
          <section className="mk-sec">
            <h2>{t("Patrones de varios años", "Multi-year patterns")}</h2>
            <div className="card flush mk-scroll">
              <p className="small" style={{ padding: "10px 16px 0" }}><span className="src block">{t("Cuántas empresas de cada grupo muestran cada patrón en todos los años cargados. Pulsa un número para ver esas empresas.", "How many companies in each group show each pattern across all the years loaded. Press a number to see those companies.")}</span></p>
              <table className="ec-tab">
                <thead><tr><th>{t(by === "sector" ? "Sector" : "Departamento", by === "sector" ? "Sector" : "Department")}</th><th className="n">{t("Empresas", "Companies")}</th>{(Object.keys(PATTERNS) as PatternKey[]).map((k) => <th key={k} className="n">{t(PATTERNS[k].es, PATTERNS[k].en)}</th>)}</tr></thead>
                <tbody>{rowsWithAll.map((g) => (
                  <tr key={`${g.isAll}-${g.name}`}><td>{name(g)}</td><td className="n">{i.n(g.companies)}</td>
                    {(Object.keys(PATTERNS) as PatternKey[]).map((k) => <td key={k} className="n">{g.patterns[k] ? <Link href={explore(g.isAll ? null : g.name, k)}>{i.n(g.patterns[k])}</Link> : "0"}<span className="src">{g.companies ? `${Math.round((g.patterns[k] / g.companies) * 100)} %` : ""}</span></td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
