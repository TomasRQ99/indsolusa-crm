import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { CellBar } from "@/components/Viz";
import { buildTeamCompare, TEAM_COLS, type TeamCol } from "@/lib/team-compare";

// COMPARAR EQUIPO (owner, 2026-11-24): everyone sees every person side by side. The table is the chart: each figure
// carries a bar scaled to the highest one in its column, the person looking is marked, and any column orders the
// table. Figures only; no score joins them.

export default async function TeamComparePage({ searchParams }: { searchParams: Promise<{ p?: string; o?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser()]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const c = await buildTeamCompare(user, i, { period: sp.p, order: sp.o });
  const href = (o: { p?: string; o?: string }) => `/mi-dia/equipo?${new URLSearchParams({ p: o.p ?? c.period, o: o.o ?? c.order })}`;
  const periods: [string, string][] = [["30", t("30 días", "30 days")], ["90", t("3 meses", "3 months")], ["365", t("12 meses", "12 months")]];
  const fmt = (col: TeamCol, v: number) => (col === "sales" ? i.money(v) : String(v));
  const me = c.rows.find((r) => r.me);
  const orderLabel = c.order === "name" ? t("por nombre", "by name") : t(`por «${c.cols.find((x) => x.key === c.order)!.label}», de mayor a menor`, `by «${c.cols.find((x) => x.key === c.order)!.label}», highest first`);

  return (
    <div className="tc">
      <div className="ph">
        <div>
          <h1>{t("Comparar equipo", "Compare the team")}</h1>
          <p>{t("Cada persona del equipo, lado a lado: sus clientes, cuántos estuvieron activos y lo que movió en el periodo. Todos ven esta página.", "Each person on the team, side by side: their customers, how many were active and what they moved in the period. Everyone sees this page.")}</p>
        </div>
        <span className="grow" />
        <nav className="seg" aria-label={t("Periodo", "Period")}>
          {periods.map(([k, label]) => <Link key={k} href={href({ p: k })} className={k === c.period ? "on" : undefined} aria-current={k === c.period ? "true" : undefined}>{label}</Link>)}
        </nav>
      </div>

      <section className="card">
        <p className="tc-sub">
          <b>{t(`${c.rows.length} ${c.rows.length === 1 ? "persona" : "personas"}`, `${c.rows.length} ${c.rows.length === 1 ? "person" : "people"}`)}</b>
          {" · "}{t(`del ${i.day(c.start)} al ${i.day(c.end)}`, `from ${i.day(c.start)} to ${i.day(c.end)}`)}
          {" · "}<span className="src">{t(`ordenado ${orderLabel}; haz clic en el título de una columna para ordenar por ella`, `ordered ${orderLabel}; click a column title to order by it`)}</span>
        </p>
        {me && (
          <p className="tc-me">{t("Tú: ", "You: ")}<b>{me.accounts}</b> {t("clientes a cargo", "customers in care")}, <b>{me.activeAccounts}</b> {t("activos", "active")}, <b>{me.contacts}</b> {t("contactos hechos", "contacts made")}, <b>{i.money(me.sales)}</b> {t("facturado", "invoiced")}.</p>
        )}
        <div className="tscroll">
          <table className="tc-t">
            <thead>
              <tr>
                <th scope="col"><Link href={href({ o: "name" })} aria-current={c.order === "name" ? "true" : undefined}>{t("Persona", "Person")}{c.order === "name" ? " ▲" : ""}</Link></th>
                {c.cols.map((col) => (
                  <th key={col.key} scope="col" className="num" title={col.help}>
                    <Link href={href({ o: col.key })} aria-current={c.order === col.key ? "true" : undefined}>{col.label}{c.order === col.key ? " ▼" : ""}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.id} className={r.me ? "me" : undefined}>
                  <th scope="row">{r.name}{r.me && <span className="sig info">{t("Tú", "You")}</span>}</th>
                  {TEAM_COLS.map((col) => (
                    <td key={col} className="num">
                      <span className="tc-v">{fmt(col, r[col])}{col === "activeAccounts" && r.accounts > 0 ? <small> {t("de", "of")} {r.accounts}</small> : null}</span>
                      <CellBar value={r[col]} max={c.max[col]} tone={r.me ? "info" : "wait"} tip={`${r.name} · ${c.cols.find((x) => x.key === col)!.label}: ${fmt(col, r[col])}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t("Equipo", "Team")}</th>
                {TEAM_COLS.map((col) => <td key={col} className="num"><b>{fmt(col, c.total[col])}</b></td>)}
              </tr>
            </tfoot>
          </table>
        </div>
        <details className="tc-help">
          <summary>{t("Qué cuenta cada columna", "What each column counts")}</summary>
          <dl>{c.cols.map((col) => <div key={col.key}><dt>{col.label}</dt><dd>{col.help}</dd></div>)}</dl>
          <p className="src">{t("Aparece quien tiene clientes o Necesidades a su cargo, o algo registrado en el periodo. Cada barra se mide contra la cifra más alta de su columna. No hay un puntaje que junte las columnas.", "Anyone with customers or Needs in their care, or something recorded in the period, appears. Each bar is measured against the highest figure in its column. No score joins the columns.")}</p>
        </details>
      </section>
    </div>
  );
}
