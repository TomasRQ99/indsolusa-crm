import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { Delta } from "@/components/Viz";
import { StatBars } from "@/components/StatBars";
import "@/components/customer-stats.css";
import { STATS, STAT_GROUPS, cellOf, eventsIn, fmtStat, isMonthKey, loadCustomerStats, monthLabel, monthOf, monthRange, periodOf, prevYear, shortStat, type StatDef } from "@/lib/customer-stats";

// MERCADO → Clientes → a customer → Estadísticas. Owner, 2026-11-24: "how they have performed for us … monthly
// comparisons for every stat … confirmable on a large scale timeline". Each figure says how it is counted, each
// month opens the records behind it, and every period is compared with the one before.

const RANGES = [["12", 12], ["24", 24], ["36", 36], ["todo", 0]] as const;

export default async function CustomerStatsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rango?: string; mes?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const a = await db.account.findUnique({ where: { id }, select: { id: true, name: true, createdAt: true } });
  if (!a) notFound();
  const s = await loadCustomerStats(id);

  const nowKey = monthOf(new Date());
  const range = RANGES.find(([k]) => k === sp.rango) ?? RANGES[0];
  const span = range[1] || Math.min(120, Math.max(1, monthsBetween(s.firstMonth, nowKey) + 1));
  const months = monthRange(nowKey, span);
  // The period just before, of the same length (12 months → the 12 before them).
  const prevMonths = range[1] ? monthRange(shiftBack(months[0]), span) : [];
  const mes = isMonthKey(sp.mes) ? sp.mes : null;
  const base = `/accounts/${id}/estadisticas`;
  const q = (over: { rango?: string | null; mes?: string | null }) => {
    const p = new URLSearchParams();
    const r = over.rango === undefined ? range[0] : over.rango;
    const m = over.mes === undefined ? mes : over.mes;
    if (r && r !== "12") p.set("rango", r);
    if (m) p.set("mes", m);
    const str = p.toString();
    return `${base}${str ? `?${str}` : ""}`;
  };
  const fmt = (d: StatDef, v: number | null) => fmtStat(i, d.unit, v);
  const anyData = STATS.some((d) => d.key !== "credit" && s.events[d.key].length > 0);
  const won = periodOf(s, STATS.find((d) => d.key === "accepted")!, months).value ?? 0;
  const lost = periodOf(s, STATS.find((d) => d.key === "declined")!, months).value ?? 0;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/accounts">{t("Clientes", "Customers")}</Link> › <Link href={`/accounts/${id}`}>{a.name}</Link></div>
          <h1>{t("Estadísticas", "Statistics")}</h1>
          <p>{t("Cómo se ha comportado este cliente con nosotros, mes a mes. Cada cifra dice cómo se cuenta y cada mes abre los registros que la forman.", "How this customer has performed for us, month by month. Each figure says how it is counted and each month opens the records behind it.")}</p>
        </div>
      </div>

      <nav className="cs-range" aria-label={t("Periodo", "Period")}>
        {RANGES.map(([k, n]) => (
          <Link key={k} href={q({ rango: k, mes: null })} className={`cs-chip${k === range[0] ? " on" : ""}`} aria-current={k === range[0] ? "page" : undefined}>
            {n === 12 ? t("Últimos 12 meses", "Last 12 months") : n === 24 ? t("Últimos 24 meses", "Last 24 months") : n === 36 ? t("Últimos 36 meses", "Last 36 months") : t("Toda la historia", "All history")}
          </Link>
        ))}
        <span className="src">
          {monthLabel(i.es, months[0])} – {monthLabel(i.es, months[months.length - 1])}
          {prevMonths.length ? t(` · comparado con ${monthLabel(i.es, prevMonths[0])} – ${monthLabel(i.es, prevMonths[prevMonths.length - 1])}`, ` · compared with ${monthLabel(i.es, prevMonths[0])} – ${monthLabel(i.es, prevMonths[prevMonths.length - 1])}`) : t(` · desde el primer registro (${monthLabel(i.es, s.firstMonth)})`, ` · since the first record (${monthLabel(i.es, s.firstMonth)})`)}
        </span>
      </nav>

      {!anyData && <p className="note">{t("Este cliente aún no tiene Necesidades, cotizaciones, facturas, pagos ni correos registrados. Las cifras aparecen solas a medida que se trabaja con él.", "This customer has no Needs, quotes, invoices, payments or emails recorded yet. The figures appear on their own as work is done with them.")}</p>}

      {mes && <MonthDetail s={s} mes={mes} i={i} close={q({ mes: null })} />}

      <p className="src cs-legend"><span className="cs-key bar" aria-hidden /> {t("el mes", "the month")} · <span className="cs-key prev" aria-hidden /> {t("el mismo mes un año antes", "the same month a year earlier")} · {t("toca un mes para ver sus registros", "tap a month to see its records")}{won + lost > 0 ? t(` · cotizaciones decididas en el periodo: ${won} aceptada(s), ${lost} rechazada(s) (${Math.round((won / (won + lost)) * 100)} % aceptadas)`, ` · quotes decided in the period: ${won} accepted, ${lost} declined (${Math.round((won / (won + lost)) * 100)} % accepted)`) : ""}</p>

      {STAT_GROUPS.map((g) => (
        <section key={g.key} className="card cs-group" id={`g-${g.key}`}>
          <h2 className="cs-gh">{t(g.es, g.en)}</h2>
          <ul className="cs-list">
            {STATS.filter((d) => d.group === g.key).map((d) => {
              const now = periodOf(s, d, months);
              const prev = prevMonths.length ? periodOf(s, d, prevMonths) : null;
              const bars = months.map((k) => {
                const c = cellOf(s, d, k);
                const p = cellOf(s, d, prevYear(k));
                const v = c.value;
                return {
                  key: k, label: monthLabel(i.es, k, false), value: d.agg === "sum" ? v ?? 0 : v, prev: p.value, on: k === mes,
                  href: `${q({ mes: k })}#mes`,
                  tip: `${monthLabel(i.es, k)}: ${fmt(d, v)}${d.agg === "avg" && c.n ? t(` (${c.n} caso(s))`, ` (${c.n} case(s))`) : ""} · ${monthLabel(i.es, prevYear(k))}: ${fmt(d, p.value)}`,
                };
              });
              const empty = d.agg !== "last" && s.events[d.key].length === 0;
              return (
                <li key={d.key} className="cs-row" id={`s-${d.key}`}>
                  <div className="cs-name">
                    <b>{t(d.es, d.en)}</b>
                    <span className="src">{t(d.defEs, d.defEn)}</span>
                  </div>
                  <div className="cs-fig">
                    <b className="val">{fmt(d, now.value)}</b>
                    <span className="src">
                      {d.agg === "avg" ? t(`promedio de ${now.n} caso(s)`, `average of ${now.n} case(s)`) : d.agg === "last" ? t("hoy", "today") : t("en el periodo", "in the period")}
                    </span>
                    {prev && (
                      <span className="small">
                        <Delta now={now.value ?? 0} prev={now.value == null ? null : prev.value} good={d.good} fmt={(x) => fmt(d, x)} same={t("igual", "same")} />{" "}
                        <span className="src">{t("antes", "before")}: {fmt(d, prev.value)}</span>
                      </span>
                    )}
                  </div>
                  <div className="cs-plot">
                    {empty ? <p className="quiet-p small">{t("Sin registros todavía.", "No records yet.")}</p> : <StatBars months={bars} title={t(`${d.es}, mes a mes`, `${d.en}, month by month`)} short={(v) => shortStat(i, d.unit, v)} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {g.key === "credito" && <CreditHistory s={s} i={i} id={id} />}
        </section>
      ))}

      <section className="card flush" id="tabla">
        <div className="cs-th"><b>{t("Mes a mes, todas las cifras", "Month by month, every figure")}</b> <span className="src">{t("el mes más reciente a la izquierda · toca un mes para ver sus registros", "most recent month on the left · tap a month to see its records")}</span></div>
        <div className="tscroll">
          <table className="cs-table">
            <thead>
              <tr>
                <th>{t("Cifra", "Figure")}</th>
                <th className="n">{t("Periodo", "Period")}</th>
                {[...months].reverse().map((k) => <th key={k} className={`n${k === mes ? " on" : ""}`}><Link href={`${q({ mes: k })}#mes`}>{monthLabel(i.es, k)}</Link></th>)}
              </tr>
            </thead>
            <tbody>
              {STAT_GROUPS.map((g) => [
                <tr key={`h-${g.key}`} className="cs-tg"><td colSpan={months.length + 2}>{t(g.es, g.en)}</td></tr>,
                ...STATS.filter((d) => d.group === g.key).map((d) => (
                  <tr key={d.key}>
                    <td>{t(d.es, d.en)}</td>
                    <td className="n val">{fmt(d, periodOf(s, d, months).value)}</td>
                    {[...months].reverse().map((k) => { const c = cellOf(s, d, k); return <td key={k} className={`n${k === mes ? " on" : ""}`}>{d.agg === "sum" && !c.value ? <span className="muted">0</span> : fmt(d, c.value)}</td>; })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </section>
      <p className="src">{t("Fuente: los registros de SOLU de este cliente. Solo cuenta lo que quedó registrado: un correo que no llegó al buzón conectado o un pago aún sin conciliar no aparece todavía.", "Source: SOLU's records for this customer. Only what was recorded counts: an email that didn't reach the connected mailbox or a payment not yet reconciled doesn't appear yet.")}</p>
    </>
  );
}

function MonthDetail({ s, mes, i, close }: { s: Awaited<ReturnType<typeof loadCustomerStats>>; mes: string; i: ReturnType<typeof makeI18n>; close: string }) {
  const { t } = i;
  const rows = STATS.filter((d) => d.key !== "credit").map((d) => ({ d, xs: eventsIn(s, d.key, mes) })).filter((r) => r.xs.length);
  const credit = s.creditChanges.filter((c) => monthOf(c.at) === mes);
  return (
    <section className="card cs-month" id="mes" aria-live="polite">
      <div className="cs-th"><b>{t(`Qué pasó en ${monthLabel(i.es, mes)}`, `What happened in ${monthLabel(i.es, mes)}`)}</b><span className="grow" /><Link href={close} className="small">{t("Cerrar", "Close")}</Link></div>
      {rows.length === 0 && credit.length === 0 ? <p className="quiet-p">{t("Ningún registro de este cliente en ese mes.", "No records for this customer that month.")}</p> : (
        <div className="cs-mgrid">
          {rows.map(({ d, xs }) => (
            <div key={d.key}>
              <p className="small"><b>{t(d.es, d.en)}</b> · {fmtStat(i, d.unit, cellOf(s, d, mes).value)}{d.agg === "avg" ? t(" en promedio", " on average") : ""}</p>
              <ul className="plain small">
                {xs.map((e, k) => (
                  <li key={k}>
                    <span className="mono">{i.day(e.at)}</span> {e.href ? <Link href={e.href}>{e.text}</Link> : e.text}
                    {d.unit !== "n" && <span className="src"> · {fmtStat(i, d.unit, e.value)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {credit.length > 0 && (
            <div>
              <p className="small"><b>{t("Cambios de cupo", "Credit limit changes")}</b></p>
              <ul className="plain small">{credit.map((c, k) => <li key={k}><span className="mono">{i.day(c.at)}</span> {c.initial ? t("cupo inicial", "starting limit") : fmtStat(i, "usd", c.before)} →<b>{fmtStat(i, "usd", c.after)}</b> <span className="src">· {c.by}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CreditHistory({ s, i, id }: { s: Awaited<ReturnType<typeof loadCustomerStats>>; i: ReturnType<typeof makeI18n>; id: string }) {
  const { t } = i;
  const ch = [...s.creditChanges].reverse();
  return (
    <details className="cs-credit" open={ch.length > 0 && ch.length <= 6}>
      <summary className="small">{t(`Historial del cupo (${ch.length} cambio(s))`, `Credit limit history (${ch.length} change(s))`)}</summary>
      {ch.length === 0 ? (
        <p className="src">{t(`El cupo no ha cambiado desde que SOLU guarda el historial. Hoy: ${fmtStat(i, "usd", s.creditNow)}.`, `The limit hasn't changed since SOLU keeps the history. Today: ${fmtStat(i, "usd", s.creditNow)}.`)}</p>
      ) : (
        <table className="small">
          <thead><tr><th>{t("Fecha", "Date")}</th><th className="n">{t("Antes", "Before")}</th><th className="n">{t("Después", "After")}</th><th className="n">{t("Cambio", "Change")}</th><th>{t("Quién", "Who")}</th></tr></thead>
          <tbody>{ch.map((c, k) => (
            <tr key={k}>
              <td className="mono">{i.date(c.at)}</td>
              <td className="n">{c.initial ? <span className="src">{t("cupo inicial", "starting limit")}</span> : fmtStat(i, "usd", c.before)}</td>
              <td className="n val">{fmtStat(i, "usd", c.after)}</td>
              <td className="n">{c.before != null && c.after != null ? <Delta now={c.after} prev={c.before} good="none" fmt={(x) => fmtStat(i, "usd", x)} same="=" /> : "—"}</td>
              <td>{c.by}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="src"><Link href={`/administracion/cupos#${id}`}>{t("Ver o cambiar el cupo en Cupos de crédito", "See or change the limit in Credit limits")}</Link></p>
    </details>
  );
}

function monthsBetween(a: string, b: string) {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
function shiftBack(first: string) {
  const [y, m] = first.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
