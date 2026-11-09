import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { compareCompanies, findCompanies } from "@/lib/econ";
import { bigMoney, type SeriesRow } from "@/lib/fin-rules";
import { IndexLines, SERIES_CLS } from "@/components/EconCharts";
import { growthTone } from "../../EconBlock";

// Mercado · compare up to four companies across the years they have: facts and trends side by side, never a score.

type SP = { id?: string | string[]; q?: string };
const MAX = 4;

export default async function Compare({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const ids = [...new Set((Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : []).filter((x) => /^[a-z0-9]{10,40}$/i.test(x)))].slice(0, MAX);
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const [list, matches] = await Promise.all([compareCompanies(ids), q && ids.length < MAX ? findCompanies(q, ids) : Promise.resolve([])]);
  const href = (xs: string[], extra = "") => `/mercado/economia/comparar?${xs.map((x) => `id=${x}`).join("&")}${extra}`;
  const num = (v: number, d = 1) => new Intl.NumberFormat(user.lang === "EN" ? "en-US" : "es-CO", { maximumFractionDigits: d }).format(v);
  const pc = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v)} %`);
  const years = [...new Set(list.flatMap((c) => c.rows.map((r) => r.year)))].sort((a, b) => a - b);
  const cur = list.flatMap((c) => c.rows)[0]?.currency ?? "COP";

  // Index base: the first year every company reports revenue; otherwise each company's own first year.
  const common = years.find((y) => list.every((c) => (c.rows.find((r) => r.year === y)?.revenue ?? 0) > 0));
  const series = list.map((c, n) => {
    const baseRow = common ? c.rows.find((r) => r.year === common) : c.rows.find((r) => (r.revenue ?? 0) > 0);
    const b = baseRow?.revenue ?? null;
    return {
      label: c.name, cls: SERIES_CLS[n],
      pts: years.map((y) => { const r = c.rows.find((x) => x.year === y); const v = b && r?.revenue != null ? Math.round((r.revenue / b) * 1000) / 10 : null; return { year: y, v, tip: `${c.name} · FY${y} · ${v == null ? "—" : `${num(v)} (${bigMoney(r!.currency, r!.revenue, user.lang)})`}` }; }),
    };
  });

  const metric = (title: [string, string], cell: (r: SeriesRow | undefined) => { text: string; cls?: string }, note?: [string, string]) => (
    <div className="card flush mk-scroll">
      <p className="small" style={{ padding: "10px 16px 0" }}><b>{t(...title)}</b>{note && <span className="src block">{t(...note)}</span>}</p>
      <table className="ec-tab">
        <thead><tr><th>{t("Empresa", "Company")}</th>{years.map((y) => <th key={y} className="n">FY{y}</th>)}</tr></thead>
        <tbody>{list.map((c, n) => (
          <tr key={c.id}><td><i className={`ec-key ${SERIES_CLS[n]}`} />{c.name}</td>{years.map((y) => { const x = cell(c.rows.find((r) => r.year === y)); return <td key={y} className={`n ${x.cls ?? ""}`}>{x.text}</td>; })}</tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado/economia">{t("Mercado · Explorador económico", "Market · Economic explorer")}</Link></div>
          <h1>{t("Comparar empresas", "Compare companies")}</h1>
          <p>{t("Hasta cuatro empresas, año por año. Hechos y tendencias de fuentes públicas para entender a quién vale la pena conocer; no es un ranking ni una decisión de crédito.", "Up to four companies, year by year. Facts and trends from public sources to understand who is worth getting to know; not a ranking or a credit decision.")}</p>
        </div>
        <Link href="/mercado/economia/patrones" className="btn secondary">{t("Patrones por sector", "Patterns by sector")}</Link>
      </div>

      <div className="card stack">
        {list.length > 0 && (
          <ul className="mk-ul">{list.map((c, n) => (
            <li key={c.id} className="row">
              <span style={{ flex: 1 }}><i className={`ec-key ${SERIES_CLS[n]}`} /><Link href={`/mercado/economia/${c.id}`}><b>{c.name}</b></Link>{" "}<span className="src">NIT {c.nit}{c.sector ? ` · ${c.sector}` : ""}{c.accountId ? ` · ${t("en SOLU", "in SOLU")}` : ""}</span></span>
              <Link href={href(ids.filter((x) => x !== c.id))} className="small">{t("Quitar", "Remove")}</Link>
            </li>
          ))}</ul>
        )}
        {ids.length < MAX ? (
          <form method="get" className="row">
            {ids.map((x) => <input key={x} type="hidden" name="id" value={x} />)}
            <input name="q" defaultValue={q} placeholder={t("Agregar empresa: nombre o NIT", "Add a company: name or NIT")} style={{ flex: 1, minWidth: 200 }} />
            <button type="submit" className="secondary">{t("Buscar", "Search")}</button>
          </form>
        ) : <span className="small muted">{t("Máximo cuatro empresas. Quita una para agregar otra.", "Four companies at most. Remove one to add another.")}</span>}
        {q && ids.length < MAX && (matches.length === 0 ? <span className="small muted">{t("Ninguna empresa con ese nombre o NIT en los datos cargados.", "No company with that name or NIT in the loaded data.")}</span> : (
          <ul className="mk-ul">{matches.map((m) => <li key={m.id} className="row"><span style={{ flex: 1 }}>{m.name}{" "}<span className="src">NIT {m.nit}{m.sector ? ` · ${m.sector}` : ""}</span></span><Link href={href([...ids, m.id])} className="small">{t("Agregar", "Add")}</Link></li>)}</ul>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card empty"><b>{t("Elige empresas para comparar", "Pick companies to compare")}</b><span className="src block">{t("Búscalas arriba, o márcalas en el explorador económico y pulsa «Comparar».", "Search for them above, or tick them in the economic explorer and press “Compare”.")}</span></div>
      ) : years.length < 2 ? (
        <div className="card empty"><b>{t("Hace falta más de un año de datos", "More than one year of data is needed")}</b><span className="src block">{t("Cuando se carguen publicaciones de otros años, aquí verás la tendencia.", "Once publications for other years are loaded, the trend shows here.")}</span></div>
      ) : (
        <>
          <section className="mk-sec">
            <h2>{t("Ingresos, en la misma escala", "Revenue, on the same scale")}</h2>
            <div className="card">
              <IndexLines series={series} years={years} label={t("Ingresos indexados", "Indexed revenue")} fmt={(v) => num(v, 0)} />
              <span className="src block">{common ? t(`Índice: ingresos de FY${common} = 100 para cada empresa. 130 significa 30 % más que en FY${common}. Así una empresa grande y una pequeña se leen juntas.`, `Index: FY${common} revenue = 100 for each company. 130 means 30% more than in FY${common}. That way a large and a small company read together.`) : t("Índice: el primer año de cada empresa = 100 (no tienen un año en común).", "Index: each company's first year = 100 (they share no year).")}</span>
            </div>
            <div className="grid cols-2">
              {list.map((c, n) => (
                <div key={c.id} className="card">
                  <b><i className={`ec-key ${SERIES_CLS[n]}`} />{c.name}</b>
                  {c.facts.length ? <ul className="mk-ul">{c.facts.map((f) => <li key={f.es} className="small">{t(f.es, f.en)}</li>)}</ul> : <p className="small muted">{t("Pocos años para ver un patrón.", "Too few years to see a pattern.")}</p>}
                </div>
              ))}
            </div>
          </section>
          <section className="mk-sec">
            <h2>{t("Año por año", "Year by year")}</h2>
            {metric(["Ingresos", "Revenue"], (r) => ({ text: bigMoney(r?.currency ?? cur, r?.revenue ?? null, user.lang) }))}
            {metric(["Crecimiento de ingresos", "Revenue growth"], (r) => ({ text: pc(r?.growth ?? null), cls: growthTone(r?.growth ?? null) }), ["Frente al año anterior. Azul: sube; rojo: baja.", "Vs. the prior year. Blue: up; red: down."])}
            {metric(["Margen neto", "Net margin"], (r) => ({ text: r?.margin == null ? "—" : `${num(r.margin)} %` }), ["Utilidad neta / ingresos.", "Net income / revenue."])}
            {metric(["Pasivos / activos", "Liabilities / assets"], (r) => ({ text: r?.leverage == null ? "—" : `${num(r.leverage)} %` }), ["Qué parte de lo que tiene la empresa está financiada con deuda.", "How much of what the company owns is financed with debt."])}
          </section>
        </>
      )}
    </>
  );
}
