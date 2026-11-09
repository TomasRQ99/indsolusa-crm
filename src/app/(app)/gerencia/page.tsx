import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { addDays, daysBetween, today } from "@/lib/domain";
import { loadCredit, loadReceivables, loadSupplierPayments } from "@/lib/queries";
import { stateLabel } from "@/lib/result";
import { causeLabel, causeOf, CAUSE_KEYS, type CauseKey } from "@/lib/causes";
import {
  bareName, causesOf, CERTAINTIES, dependencies, economicsOf, futureOf, horizon, inMonth, loadInsightDeals, median, monthStart, patternsOf, promiseOf, promisesAhead,
  type Certainty, type Effect, type IDeal,
} from "@/lib/insights";
import { Dumbbell, HBars, Horizon, Legend, PromiseStrip, Q, StackBars } from "@/components/InsightCharts";
import { ReportSignal } from "@/components/ReportSignal";

type SP = { view?: string; m?: string; owner?: string; sector?: string; cert?: string; cause?: string; effect?: string; ask?: string };
const VIEWS = ["mes", "forward", "causas", "recovery"] as const;
type View = (typeof VIEWS)[number];

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireRole("ADMIN", "MANAGER");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const now = today();
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "mes";
  // A monthly review looks at the last complete month during the first week of a new month.
  const defMonth = now.getUTCDate() < 8 ? monthStart(now, -1) : monthStart(now);
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? new Date(`${sp.m}-01T00:00:00Z`) : defMonth;
  const mKey = (d: Date) => d.toISOString().slice(0, 7);
  const mName = (d: Date, o: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { ...o, timeZone: "UTC" }).format(d);
  const cert = (CERTAINTIES as string[]).includes(sp.cert ?? "") ? (sp.cert as Certainty) : null;
  const filters = { owner: sp.owner || undefined, sector: sp.sector || undefined };

  const [deals, owners, sectors, signals] = await Promise.all([
    loadInsightDeals(filters),
    db.user.findMany({ where: { active: true, deals: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.account.findMany({ where: { industry: { not: null } }, distinct: ["industry"], select: { industry: true }, orderBy: { industry: "asc" } }),
    db.productSignal.findMany({ where: { createdAt: { gte: addDays(now, -90) } }, orderBy: { createdAt: "desc" } }),
  ]);

  const link = (p: Partial<SP>) => {
    const q = new URLSearchParams();
    const all: SP = { view, m: sp.m, owner: sp.owner, sector: sp.sector, cert: sp.cert, ...p };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "view" && v === "mes")) q.set(k, v);
    const s = q.toString();
    return `/gerencia${s ? `?${s}` : ""}`;
  };
  const jName = (d: IDeal) => `${d.code ?? ""} · ${bareName(d.account.name)}`;
  const cName = (c: string) => causeLabel(t, c);
  const openRecs = deals.flatMap((d) => d.recoveries.filter((r) => !r.resolvedAt).map((r) => ({ r, d })));

  // ---------------- Ask SOLU (deterministic, computed from records; no AI) ----------------
  const ASKS = [
    { key: "resultados", q: t("¿Por qué no logramos algunos resultados?", "Why did we fall short on some results?") },
    { key: "dependencias", q: t("¿De qué proveedor depende lo comprometido?", "Which supplier does the committed future depend on?") },
    { key: "esagra", q: t("¿Dónde perdimos eságara protegida?", "Where did we lose protected eságara?") },
    { key: "promesas", q: t("¿Qué promesas cambiaron tarde o sin aviso?", "Which promises changed late or without warning?") },
  ];
  const askAnswer = (() => {
    if (!sp.ask) return null;
    const lines: { text: string; href: string }[] = [];
    let lead = "";
    if (sp.ask === "resultados") {
      const bad = deals.filter((d) => d.resultState === "NOT_ACHIEVED" || d.resultState === "PARTIAL");
      lead = bad.length ? t(`${bad.length} Journey(s) no lograron todo el resultado. Causas:`, `${bad.length} Journey(s) fell short. Causes:`) : t("Ningún Journey está en Parcial o No logrado.", "No Journey is Partial or Not achieved.");
      for (const d of bad) { const r = d.recoveries[0]; lines.push({ href: `/deals/${d.id}/resultado`, text: `${jName(d)} — ${stateLabel(i, d.resultState).text}: ${cName(r ? causeOf(r.cause, r.whatChanged) : "UNKNOWN")}${r ? ` · ${r.whatChanged}` : ""}${r && !r.resolvedAt ? t(r.selectedKey ? " · Recovery en curso" : " · Recovery sin opción elegida", r.selectedKey ? " · Recovery in progress" : " · Recovery with no option chosen") : ""}` }); }
    } else if (sp.ask === "dependencias") {
      const dep = dependencies(deals, now);
      const total = dep.reduce((s, x) => s + x.committed, 0);
      lead = dep.length ? t(`Lo comprometido con compra abierta (${i.money(total)}) depende de ${dep.length} proveedor(es):`, `Committed value with open purchases (${i.money(total)}) depends on ${dep.length} supplier(s):`) : t("Nada comprometido depende hoy de una compra abierta.", "Nothing committed depends on an open purchase today.");
      for (const s of dep) lines.push({ href: `/suppliers/${s.id}`, text: `${bareName(s.name)} — ${i.money(s.committed)} (${Math.round((s.committed / total) * 100)} %) · ${s.journeys.size} Journey(s) · ${s.measured ? t(`${s.onTime} de ${s.measured} despachos a tiempo en 12 meses`, `${s.onTime} of ${s.measured} shipments on time in 12 months`) : t("sin despachos medidos", "no measured shipments")}` });
    } else if (sp.ask === "esagra") {
      const er = deals.map((d) => ({ d, e: economicsOf(d) })).filter((x) => x.e.erosion).sort((a, b) => b.e.erosion!.amount - a.e.erosion!.amount);
      lead = er.length ? t(`Se perdieron ${i.money(er.reduce((s, x) => s + x.e.erosion!.amount, 0))} de eságara protegida en ${er.length} Journey(s):`, `${i.money(er.reduce((s, x) => s + x.e.erosion!.amount, 0))} of protected eságara lost in ${er.length} Journey(s):`) : t("Ningún Journey perdió eságara frente a lo protegido.", "No Journey lost eságara against what was protected.");
      for (const { d, e } of er) { const p = e.erosion!.parts; const part = [p.price < -1 ? t(`precio −${i.money(-p.price)}`, `price −${i.money(-p.price)}`) : "", p.supplier < -1 ? t(`costo proveedor +${i.money(-p.supplier)}`, `supplier cost +${i.money(-p.supplier)}`) : "", p.freight < -1 ? t(`flete/otros +${i.money(-p.freight)}`, `freight/other +${i.money(-p.freight)}`) : ""].filter(Boolean).join(" · "); lines.push({ href: `/deals/${d.id}`, text: `${jName(d)} — −${i.money(e.erosion!.amount)}: ${part} (${t("protegida en", "protected in")} ${e.prot!.ref})` }); }
    } else if (sp.ask === "promesas") {
      const ps = deals.map((d) => ({ d, p: promiseOf(d) })).filter((x) => x.p && (x.p.silent || (x.p.revised && !x.p.revisedInTime)));
      lead = ps.length ? t(`${ps.length} promesa(s) cambiaron después de la fecha original o se incumplieron sin aviso:`, `${ps.length} promise(s) changed after the original date or were missed without warning:`) : t("Toda promesa que cambió se avisó antes de la fecha original.", "Every promise that changed was flagged before the original date.");
      for (const { d, p } of ps) lines.push({ href: `/deals/${d.id}?tab=promise`, text: `${jName(d)} — ${t("original", "original")} ${i.day(p!.original)}${p!.revised ? ` → ${t("revisada", "revised")} ${i.day(p!.revised)} (${t("el", "on")} ${i.day(p!.revisedAt)})` : ""}${p!.actual ? ` · ${t("real", "actual")} ${i.day(p!.actual)}` : ""}${p!.silent ? t(" · sin aviso previo", " · no prior warning") : ""} · ${cName(p!.changeCause ?? "UNKNOWN")}` });
    } else return null;
    return { q: ASKS.find((a) => a.key === sp.ask)?.q ?? "", lead, lines };
  })();

  // ---------------- Header, views, filters ----------------
  const header = (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Gerencia", "Management")}</div>
          <h1>Insights</h1>
          <p>{t("Un sistema de decisiones: qué resultados logramos para los clientes, qué promesas cumplimos, qué viene y con qué certeza, y qué causas se repiten. No mide actividad de personas.", "A decision system: what results we achieved for customers, which promises we kept, what's coming and how certain it is, and which causes repeat. It doesn't measure people's activity.")}</p>
        </div>
      </div>
      <nav className="iv-tabs" aria-label={t("Vistas", "Views")}>
        {([["mes", t("Vista mensual", "Monthly view")], ["forward", t("Vista forward", "Forward view")], ["causas", t("Causalidad", "Causality")], ["recovery", t("Recovery abierto", "Open Recovery")]] as const).map(([k, l]) => (
          <Link key={k} href={link({ view: k, cause: undefined, effect: undefined, ask: undefined })} className={view === k ? "on" : ""}>{l}{k === "recovery" && openRecs.length > 0 && <span className="iv-n">{openRecs.length}</span>}</Link>
        ))}
      </nav>
      <form className="iv-filters" method="get" action="/gerencia">
        {view !== "mes" && <input type="hidden" name="view" value={view} />}
        {view === "mes" && (
          <label>{t("Mes", "Month")}<select name="m" defaultValue={mKey(month)}>{Array.from({ length: 12 }, (_, n) => monthStart(now, -n)).map((m) => <option key={mKey(m)} value={mKey(m)}>{mName(m)}</option>)}</select></label>
        )}
        <label>{t("Equipo / persona", "Team / person")}<select name="owner" defaultValue={sp.owner ?? ""}><option value="">{t("Todo el equipo", "Whole team")}</option>{owners.map((o) => <option key={o.id} value={o.id}>{bareName(o.name)}</option>)}</select></label>
        <label>{t("Sector", "Sector")}<select name="sector" defaultValue={sp.sector ?? ""}><option value="">{t("Todos", "All")}</option>{sectors.map((s) => <option key={s.industry!} value={s.industry!}>{s.industry}</option>)}</select></label>
        {view === "forward" && (
          <label>{t("Certeza", "Certainty")}<select name="cert" defaultValue={sp.cert ?? ""}><option value="">{t("Los cuatro niveles", "All four levels")}</option>{CERTAINTIES.map((c) => <option key={c} value={c}>{certName(c)}</option>)}</select></label>
        )}
        <button type="submit" className="btn secondary sm">{t("Aplicar", "Apply")}</button>
        {(sp.owner || sp.sector || sp.cert || sp.m) && <Link href={link({ owner: undefined, sector: undefined, cert: undefined, m: undefined })} className="small">{t("Quitar filtros", "Clear filters")}</Link>}
      </form>
      <div className="iv-ask">
        <span className="iv-ask-k">{t("Pregúntale a SOLU sobre causas y dependencias", "Ask SOLU about causes and dependencies")}</span>
        {ASKS.map((a) => <Link key={a.key} href={link({ ask: a.key })} className={`iv-chip${sp.ask === a.key ? " on" : ""}`}>{a.q}</Link>)}
      </div>
      {askAnswer && (
        <section className="iv-answer">
          <div className="iv-answer-h"><b>{askAnswer.q}</b><Link href={link({ ask: undefined })} className="small">{t("Cerrar", "Close")}</Link></div>
          <p>{askAnswer.lead}</p>
          {askAnswer.lines.length > 0 && <ul>{askAnswer.lines.map((l, n) => <li key={n}><Link href={l.href}>{l.text}</Link></li>)}</ul>}
          <span className="src">{t("Respuesta calculada con los registros de SOLU (no es IA). Cada línea lleva a su Journey o ficha.", "Answer computed from SOLU's records (not AI). Each line opens its Journey or record.")}</span>
        </section>
      )}
    </>
  );

  function certName(c: Certainty) {
    return { COMMITTED: t("Comprometido", "Committed"), EXPECTED: t("Esperado", "Expected"), POSSIBLE: t("Posible", "Possible"), EXPLORATORY: t("Exploratorio", "Exploratory") }[c];
  }
  const filterNote = filters.owner || filters.sector ? <p className="src iv-fnote">{t("Filtrado por", "Filtered by")} {[filters.owner ? bareName(owners.find((o) => o.id === filters.owner)?.name ?? "") : "", filters.sector ?? ""].filter(Boolean).join(" · ")}</p> : null;

  // ======================= FORWARD =======================
  if (view === "forward") {
    const fut = futureOf(deals);
    const levels = cert ? [cert] : CERTAINTIES;
    const desc: Record<Certainty, string> = {
      COMMITTED: t("PO aceptada, saldo por facturar · fecha = promesa al cliente", "PO accepted, balance not invoiced · date = customer promise"),
      EXPECTED: t("cotización presentada, el cliente decide · fecha = decisión esperada", "quote presented, customer deciding · date = expected decision"),
      POSSIBLE: t("necesidad con monto o especificación, sin cotizar · fecha = cierre estimado", "need with amount or spec, not quoted · date = estimated close"),
      EXPLORATORY: t("señales futuras y leads sin monto: no son oportunidades ni se valoran", "future signals and leads with no amount: not opportunities, not valued"),
    };
    const hLabels = [t("vencido", "late"), mName(now, { month: "short" }), mName(monthStart(now, 1), { month: "short" }), mName(monthStart(now, 2), { month: "short" }), t("después", "later"), t("sin fecha", "no date")];
    const ahead = promisesAhead(deals, now);
    const atRisk = ahead.filter((x) => x.why.length);
    const why = (w: string) => {
      const [k, a, b] = w.split(":");
      if (k === "SUPPLIER") return t(`${bareName(a)} no ha despachado (${b} d tarde)`, `${bareName(a)} hasn't shipped (${b} d late)`);
      if (k === "ETA") return t(`ETA del transportador ${a} d después de la promesa`, `Carrier ETA ${a} d after the promise`);
      if (k === "CUSTOMS") return t("retenido en aduana", "held at customs");
      if (k === "RECOVERY") return t("Recovery abierta", "Recovery open");
      return t("sin compra al proveedor", "no supplier purchase");
    };
    const live = deals.filter((d) => d.stage === "WON" && !d.closedAt).map((d) => ({ d, e: economicsOf(d) })).filter((x) => x.e.prot && !x.e.final);
    const dep = dependencies(deals, now);
    const depTotal = dep.reduce((s, x) => s + x.committed, 0);
    return (
      <>
        {header}
        {filterNote}
        <Q q={t("¿Qué viene y con qué certeza?", "What's coming, and how certain is it?")} a={t("Cada nivel tiene su propia escala y su propio total. Los niveles nunca se suman entre sí.", "Each level has its own scale and its own total. Levels are never added together.")}>
          <div className={`iv-cert n${levels.length}`}>
            {levels.map((c) => {
              const items = fut[c];
              const h = horizon(items, now);
              const money = c !== "EXPLORATORY";
              const total = items.reduce((s, x) => s + (x.amount ?? 0), 0);
              return (
                <section key={c} className={`iv-c c-${c.toLowerCase()}`}>
                  <div className="iv-c-h"><b>{certName(c)}</b><Link href={link({ cert: cert === c ? undefined : c })} className="small">{cert === c ? t("ver los cuatro", "see all four") : t("solo este", "only this")}</Link></div>
                  <div className="iv-c-v">{money ? i.money(total) : `${items.length}`}<span className="src"> · {money ? t(`${items.length} Journey(s)`, `${items.length} Journey(s)`) : t("señales / leads", "signals / leads")}</span></div>
                  <span className="src block">{desc[c]}</span>
                  {items.length > 0 ? (
                    <Horizon label={certName(c)} money={money} cols={h.keys.map((k, n) => ({ label: hLabels[n], n: h.b[k].n, amount: h.b[k].amount, cls: k === "late" ? "ich-late" : undefined, tip: `${hLabels[n]}: ${h.b[k].n}${money ? ` · ${i.money(h.b[k].amount)}` : ""}` }))} />
                  ) : <p className="quiet-p">{t("Nada en este nivel.", "Nothing at this level.")}</p>}
                  <ul className="plain small iv-c-l">
                    {items.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || (a.when?.getTime() ?? 9e15) - (b.when?.getTime() ?? 9e15)).slice(0, cert ? 30 : 4).map((x) => (
                      <li key={x.key}><Link href={`/deals/${x.deal.id}`}>{x.what}</Link><span className="src block">{bareName(x.deal.account.name)}{x.amount ? ` · ${i.money(x.amount)}` : ""} · {x.when ? i.day(x.when) : t("sin fecha", "no date")}{x.when && x.when < now ? <b className="risk-t"> · {t("vencido", "late")}</b> : null}{c === "EXPLORATORY" && x.basis !== "lead" ? ` · ${x.basis}` : ""}</span></li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </Q>
        <div className="iv-grid">
          <Q q={t("¿Qué promesas de los próximos 30 días están en riesgo, y por qué?", "Which promises in the next 30 days are at risk, and why?")} a={atRisk.length ? t(`${atRisk.length} de ${ahead.length} promesas tienen una causa de riesgo identificada.`, `${atRisk.length} of ${ahead.length} promises have an identified risk cause.`) : t(`${ahead.length} promesas en 30 días, ninguna con causa de riesgo.`, `${ahead.length} promises in 30 days, none with a risk cause.`)}>
            {ahead.length === 0 ? <p className="quiet-p">{t("No hay promesas en los próximos 30 días.", "No promises in the next 30 days.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>Journey</th><th>{t("Promesa", "Promise")}</th><th>{t("Causa del riesgo", "Risk cause")}</th></tr></thead>
                <tbody>{ahead.map(({ d, why: w }) => (
                  <tr key={d.id}><td><Link href={`/deals/${d.id}`}>{jName(d)}</Link><span className="src block">{d.title}</span></td><td className="mono">{i.day(d.promisedDate)}{d.promiseRevisions > 0 && <span className="src block">{t(`revisada ${d.promiseRevisions}×`, `revised ${d.promiseRevisions}×`)}</span>}</td><td>{w.length ? w.map((x) => <span key={x} className="sig risk block-sig">{why(x)}</span>) : <span className="sig ok">{t("sin riesgo identificado", "no risk identified")}</span>}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Q>
          <Q q={t("¿La eságara protegida se mantiene en lo que está en curso?", "Is the protected eságara holding in what's in progress?")} a={live.length ? t(`${live.filter((x) => x.e.cur.value < x.e.prot!.value - 1).length} de ${live.length} Journeys en curso están por debajo de lo protegido (${i.money(live.reduce((s, x) => s + Math.max(0, x.e.prot!.value - x.e.cur.value), 0))}).`, `${live.filter((x) => x.e.cur.value < x.e.prot!.value - 1).length} of ${live.length} Journeys in progress are below what was protected (${i.money(live.reduce((s, x) => s + Math.max(0, x.e.prot!.value - x.e.cur.value), 0))}).`) : t("Ningún Journey en curso tiene economía protegida (cotización presentada).", "No Journey in progress has protected economics (presented quote).")}
            side={<Legend items={[{ cls: "ich-prot", label: t("protegida", "protected"), shape: "ring" }, { cls: "ich-cur", label: t("actual", "current"), shape: "dot" }]} />}>
            {live.length > 0 && <Dumbbell label="eságara" rows={live.map(({ d, e }) => ({ label: jName(d), href: `/deals/${d.id}`, prot: (e.prot!.value / e.prot!.sale) * 100, cur: e.cur.pct, fin: null, down: e.cur.value < e.prot!.value - 1, tip: `${jName(d)} · ${t("protegida", "protected")} ${i.money(e.prot!.value)} (${i.pct((e.prot!.value / e.prot!.sale) * 100)}) → ${t("actual", "current")} ${i.money(e.cur.value)} (${i.pct(e.cur.pct)})` }))} />}
          </Q>
        </div>
        <Q q={t("¿De qué proveedores depende lo comprometido?", "Which suppliers does the committed future depend on?")} a={dep.length ? t(`${bareName(dep[0].name)} sostiene el ${Math.round((dep[0].committed / depTotal) * 100)} % de lo comprometido con compra abierta.`, `${bareName(dep[0].name)} carries ${Math.round((dep[0].committed / depTotal) * 100)} % of committed value with open purchases.`) : t("Nada comprometido depende hoy de una compra abierta.", "Nothing committed depends on an open purchase today.")}>
          {dep.length > 0 && <HBars label="dep" unit="USD " rows={dep.map((s) => ({ label: `${bareName(s.name)} · ${s.measured ? t(`${s.onTime}/${s.measured} a tiempo`, `${s.onTime}/${s.measured} on time`) : t("sin historial", "no history")}`, value: Math.round(s.committed), href: `/suppliers/${s.id}`, cls: s.measured >= 3 && s.onTime / s.measured < 0.75 ? "risk" : "", tip: t(`${s.journeys.size} Journey(s) comprometido(s)`, `${s.journeys.size} committed Journey(s)`) }))} />}
        </Q>
      </>
    );
  }

  // ======================= CAUSALITY =======================
  if (view === "causas") {
    const rows = deals.flatMap(causesOf);
    const EFFECTS: { k: Effect; l: string }[] = [
      { k: "RESULT", l: t("Resultado parcial / no logrado", "Result partial / not achieved") },
      { k: "RECOVERY", l: "Recovery" },
      { k: "PROMISE", l: t("Promesa revisada / incumplida", "Promise revised / missed") },
      { k: "ESAGRA", l: t("Eságara perdida", "Eságara lost") },
    ];
    const causes = [...CAUSE_KEYS, "UNKNOWN"] as CauseKey[];
    const cell = (c: CauseKey, e: Effect) => rows.filter((r) => r.cause === c && r.effect === e);
    const usedCauses = causes.filter((c) => rows.some((r) => r.cause === c));
    const selCause = causes.includes(sp.cause as CauseKey) ? (sp.cause as CauseKey) : null;
    const selEffect = EFFECTS.some((e) => e.k === sp.effect) ? (sp.effect as Effect) : null;
    const drill = rows.filter((r) => (!selCause || r.cause === selCause) && (!selEffect || r.effect === selEffect));
    const top = usedCauses.filter((c) => c !== "UNKNOWN").map((c) => ({ c, n: new Set(rows.filter((r) => r.cause === c).map((r) => r.deal.id)).size })).sort((a, b) => b.n - a.n)[0];
    const unknown = new Set(rows.filter((r) => r.cause === "UNKNOWN").map((r) => r.deal.id)).size;
    const effText = (r: (typeof rows)[number]) => r.effect === "ESAGRA" ? `−${i.money(r.amount)}` : r.effect === "PROMISE" ? (r.text === "MISSED" ? t("incumplida", "missed") : t("revisada", "revised")) : r.effect === "RESULT" ? stateLabel(i, r.deal.resultState).text : r.text;
    return (
      <>
        {header}
        {filterNote}
        <Q q={t("¿Qué causas producen qué efectos?", "Which causes produce which effects?")} a={top ? t(`${cName(top.c)} es la causa más repetida: ${top.n} Journey(s). ${unknown ? `${unknown} Journey(s) sin causa registrada.` : ""}`, `${cName(top.c)} is the most repeated cause: ${top.n} Journey(s). ${unknown ? `${unknown} Journey(s) with no cause recorded.` : ""}`) : t("No hay efectos negativos registrados.", "No negative effects recorded.")}>
          {usedCauses.length === 0 ? <p className="quiet-p">{t("Sin Recoveries, promesas cambiadas, eságara perdida ni resultados parciales.", "No Recoveries, changed promises, lost eságara or partial results.")}</p> : (
            <div className="iv-scroll">
              <table className="x3-t iv-matrix">
                <thead><tr><th>{t("Causa", "Cause")}</th>{EFFECTS.map((e) => <th key={e.k} className="n">{e.l}</th>)}</tr></thead>
                <tbody>{usedCauses.map((c) => (
                  <tr key={c} className={selCause === c ? "sel" : ""}>
                    <td><Link href={link({ cause: selCause === c && !selEffect ? undefined : c, effect: undefined })}><b>{cName(c)}</b></Link></td>
                    {EFFECTS.map((e) => { const x = cell(c, e.k); const v = e.k === "ESAGRA" ? x.reduce((s, r) => s + (r.amount ?? 0), 0) : x.length; return <td key={e.k} className="n">{x.length ? <Link href={link({ cause: c, effect: e.k })} className={`iv-cell${v && (e.k === "ESAGRA" ? v > 500 : x.length >= 2) ? " hot" : ""}`}>{e.k === "ESAGRA" ? i.money(v) : v}</Link> : <span className="muted">—</span>}</td>; })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="src">{t("Cada celda abre los Journeys que la forman. Las causas vienen de lo que la persona registró (Recovery, cambio de promesa); si no hay registro, SOLU la deduce del texto y lo dice.", "Each cell opens the Journeys behind it. Causes come from what the person recorded (Recovery, promise change); when there's no record SOLU infers it from the text and says so.")}</p>
        </Q>
        <Q id="drill" q={selCause || selEffect ? t(`¿Qué Journeys están detrás de ${[selCause ? cName(selCause) : "", selEffect ? EFFECTS.find((e) => e.k === selEffect)!.l : ""].filter(Boolean).join(" → ")}?`, `Which Journeys are behind ${[selCause ? cName(selCause) : "", selEffect ? EFFECTS.find((e) => e.k === selEffect)!.l : ""].filter(Boolean).join(" → ")}?`) : t("¿Qué Journeys están detrás de cada causa?", "Which Journeys are behind each cause?")} a={t(`${drill.length} efecto(s) en ${new Set(drill.map((r) => r.deal.id)).size} Journey(s).`, `${drill.length} effect(s) in ${new Set(drill.map((r) => r.deal.id)).size} Journey(s).`)} side={(selCause || selEffect) && <Link href={link({ cause: undefined, effect: undefined })} className="small">{t("ver todas", "see all")}</Link>}>
          <table className="x3-t">
            <thead><tr><th>Journey</th><th>{t("Causa", "Cause")}</th><th>{t("Efecto", "Effect")}</th><th>{t("Detalle", "Detail")}</th></tr></thead>
            <tbody>{drill.map((r, n) => (
              <tr key={n}><td><Link href={r.effect === "RESULT" || r.effect === "RECOVERY" ? `/deals/${r.deal.id}/resultado` : `/deals/${r.deal.id}`}>{jName(r.deal)}</Link><span className="src block">{r.deal.title}</span></td><td>{cName(r.cause)}</td><td>{EFFECTS.find((e) => e.k === r.effect)!.l}</td><td className="small">{effText(r)}</td></tr>
            ))}</tbody>
          </table>
        </Q>
      </>
    );
  }

  // ======================= OPEN RECOVERY =======================
  if (view === "recovery") {
    const pri = (r: (typeof openRecs)[number]["r"]) => (!r.selectedKey ? 0 : r.expectedBy && r.expectedBy < now ? 1 : 2);
    const list = [...openRecs].sort((a, b) => pri(a.r) - pri(b.r) || a.r.openedAt.getTime() - b.r.openedAt.getTime());
    const year = deals.flatMap((d) => d.recoveries.filter((r) => r.openedAt >= addDays(now, -365)).map((r) => ({ r, d })));
    const byCause = new Map<string, number>();
    for (const { r } of year) { const c = causeOf(r.cause, r.whatChanged); byCause.set(c, (byCause.get(c) ?? 0) + 1); }
    const resolved = year.filter((x) => x.r.resolvedAt);
    const ttr = median(resolved.map((x) => daysBetween(x.r.openedAt, x.r.resolvedAt!)));
    const decide = list.filter((x) => pri(x.r) < 2).length;
    return (
      <>
        {header}
        {filterNote}
        <Q q={t("¿Qué Recoveries necesitan una decisión hoy?", "Which Recoveries need a decision today?")} a={list.length ? t(`${list.length} abierta(s): ${list.filter((x) => !x.r.selectedKey).length} sin opción elegida, ${list.filter((x) => pri(x.r) === 1).length} vencida(s).`, `${list.length} open: ${list.filter((x) => !x.r.selectedKey).length} with no option chosen, ${list.filter((x) => pri(x.r) === 1).length} overdue.`) : t("No hay Recoveries abiertas.", "No open Recoveries.")} side={decide > 0 && <span className="sig risk">{t(`${decide} necesitan decisión`, `${decide} need a decision`)}</span>}>
          {list.length > 0 && (
            <div className="iv-recs">
              {list.map(({ r, d }) => {
                const p = pri(r);
                return (
                  <article key={r.id} className={`iv-rec p${p}`}>
                    <div className="iv-rec-h">
                      <span className={`sig ${p === 2 ? "attn" : "risk"}`}>{p === 0 ? t("Elegir opción", "Choose an option") : p === 1 ? t("Recuperación vencida", "Recovery overdue") : t("En curso", "In progress")}</span>
                      <Link href={`/deals/${d.id}/resultado#recovery`}><b>{jName(d)}</b></Link>
                      <span className="grow" />
                      <span className="src">{t(`abierta hace ${daysBetween(r.openedAt, now)} d`, `open ${daysBetween(r.openedAt, now)} d`)} · {bareName(d.owner.name)}</span>
                    </div>
                    <dl className="iv-rec-dl">
                      <dt>{t("Qué cambió", "What changed")}</dt><dd>{r.whatChanged}</dd>
                      <dt>{t("Impacto", "Impact")}</dt><dd>{r.impact}</dd>
                      <dt>{t("Causa", "Cause")}</dt><dd>{cName(causeOf(r.cause, r.whatChanged))}</dd>
                      <dt>{t("Resultado deseado", "Desired result")}</dt><dd>{d.desiredResult ?? "—"}</dd>
                      {r.selectedKey && <><dt>{t("Esperada", "Expected")}</dt><dd className="mono">{r.expectedBy ? i.day(r.expectedBy) : "—"}{r.expectedBy && r.expectedBy < now && <b className="risk-t"> · {t(`${daysBetween(r.expectedBy, now)} d vencida`, `${daysBetween(r.expectedBy, now)} d overdue`)}</b>}</dd></>}
                    </dl>
                    <Link href={`/deals/${d.id}/resultado#recovery`} className="btn secondary sm">{p === 0 ? t("Decidir opción", "Decide option") : t("Abrir Recovery", "Open Recovery")}</Link>
                  </article>
                );
              })}
            </div>
          )}
        </Q>
        <div className="iv-grid">
          <Q q={t("¿Qué causas materiales se repiten?", "Which material causes repeat?")} a={byCause.size ? t(`${year.length} Recoveries en 12 meses; la causa más repetida es ${cName([...byCause].sort((a, b) => b[1] - a[1])[0][0])}.`, `${year.length} Recoveries in 12 months; the most repeated cause is ${cName([...byCause].sort((a, b) => b[1] - a[1])[0][0])}.`) : t("Sin Recoveries en 12 meses.", "No Recoveries in 12 months.")}>
            {byCause.size > 0 && <HBars label="causes" rows={[...byCause].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ label: cName(c), value: n, href: link({ view: "causas", cause: c, effect: "RECOVERY" }), tip: `${n}`, cls: c === "UNKNOWN" ? "muted" : "" }))} />}
          </Q>
          <Q q={t("¿Cuánto tardamos en recuperar y cómo terminó?", "How long does recovery take, and how did it end?")} a={resolved.length ? t(`Mediana ${ttr} d de abierta a resuelta · ${resolved.filter((x) => x.r.outcome === "RECOVERED").length} de ${resolved.length} recuperadas.`, `Median ${ttr} d from open to resolved · ${resolved.filter((x) => x.r.outcome === "RECOVERED").length} of ${resolved.length} recovered.`) : t("Todavía no hay Recoveries resueltas.", "No resolved Recoveries yet.")}>
            {resolved.length > 0 && (
              <ul className="plain small">{resolved.map(({ r, d }) => <li key={r.id}><Link href={`/deals/${d.id}/resultado`}>{jName(d)}</Link> · {daysBetween(r.openedAt, r.resolvedAt!)} d · <b className={r.outcome === "RECOVERED" ? "" : "risk-t"}>{r.outcome === "RECOVERED" ? t("recuperada", "recovered") : r.outcome === "NO_LONGER_RELEVANT" ? t("ya no aplica", "no longer relevant") : t("no recuperada", "not recovered")}</b> · {cName(causeOf(r.cause, r.whatChanged))}<span className="src block">{r.outcomeNote ?? r.whatChanged}</span></li>)}</ul>
            )}
          </Q>
        </div>
      </>
    );
  }

  // ======================= MONTHLY =======================
  const [receivables, payments, credit] = await Promise.all([loadReceivables(), loadSupplierPayments({ executedAt: null }), loadCredit()]);
  const decisions: { key: string; title: string; detail: string; href: string; cta: string }[] = [];
  for (const { r, d } of openRecs.filter((x) => !x.r.selectedKey)) decisions.push({ key: `r${r.id}`, title: t(`Recovery sin opción elegida: ${jName(d)}`, `Recovery with no option chosen: ${jName(d)}`), detail: r.impact, href: `/deals/${d.id}/resultado#recovery`, cta: t("Decidir", "Decide") });
  for (const a of credit) for (const d of a.blocking) decisions.push({ key: `c${d.id}`, title: t(`Decidir el cupo de ${a.name}`, `Decide ${a.name}'s credit limit`), detail: t(`${d.code} supera el cupo por ${i.money(a.used - (a.limit ?? 0))}`, `${d.code} exceeds the limit by ${i.money(a.used - (a.limit ?? 0))}`), href: `/administracion/cupos#${a.id}`, cta: t("Ver opciones", "See options") });
  for (const p of payments.filter((x) => x.state === "APPROVE" && x.requestedById !== user.id && x.verifiedById !== user.id)) decisions.push({ key: `p${p.id}`, title: t(`Aprobar pago a ${p.supplierPo.supplier.name}`, `Approve payment to ${p.supplierPo.supplier.name}`), detail: `${p.currency} ${i.n2(p.amount)} · ${p.reason}`, href: `/administracion/pagos-proveedores/${p.id}`, cta: t("Revisar", "Review") });
  const broken = receivables.filter((r) => r.state === "BROKEN");
  if (broken.length) decisions.push({ key: "broken", title: t(`${broken.length} compromisos de pago incumplidos`, `${broken.length} payment commitments missed`), detail: i.money(broken.reduce((s, r) => s + r.cash.balance, 0)), href: "/administracion/cobrar", cta: t("Ver", "View") });

  // Result conversion (by month the result was confirmed).
  const RS = ["ACHIEVED", "PARTIAL", "NOT_ACHIEVED", "NO_LONGER_RELEVANT"] as const;
  const months = Array.from({ length: 6 }, (_, n) => monthStart(month, n - 5));
  const resCols = months.map((m) => {
    const ds = deals.filter((d) => d.resultState !== "PENDING" && inMonth(d.resultConfirmedAt, m));
    const v = RS.map((s) => ds.filter((d) => d.resultState === s).length);
    return { label: mName(m, { month: "short" }), hl: m.getTime() === month.getTime(), values: v, tips: RS.map((s, k) => `${mName(m)} · ${stateLabel(i, s).text}: ${v[k]}`) };
  });
  const monthRes = deals.filter((d) => d.resultState !== "PENDING" && inMonth(d.resultConfirmedAt, month)).sort((a, b) => RS.indexOf(a.resultState as (typeof RS)[number]) - RS.indexOf(b.resultState as (typeof RS)[number]));
  const enoughTrend = resCols.filter((c) => c.values.some(Boolean)).length >= 3;
  const deliveredNoResult = deals.filter((d) => d.resultState === "PENDING" && d.deliveries.length && !d.closedAt);
  const ach = monthRes.filter((d) => d.resultState === "ACHIEVED").length;
  const relevant = monthRes.filter((d) => d.resultState !== "NO_LONGER_RELEVANT").length;

  // Promise performance (by month of the actual delivery).
  const proms = deals.map((d) => ({ d, p: promiseOf(d) })).filter((x) => x.p?.actual && inMonth(x.p.actual, month));
  const pc = { KEPT: proms.filter((x) => x.p!.outcome === "KEPT").length, REV: proms.filter((x) => x.p!.outcome === "REVISED_IN_TIME").length, MISSED: proms.filter((x) => x.p!.outcome === "MISSED").length };

  // Economics (Journeys whose final invoice was issued in the month).
  const econ = deals.map((d) => ({ d, e: economicsOf(d) })).filter((x) => x.e.final && inMonth(x.e.final.at, month));
  const econP = econ.filter((x) => x.e.prot);
  const sum = (f: (x: (typeof econ)[number]) => number, l = econP) => l.reduce((s, x) => s + f(x), 0);
  const tot = { prot: sum((x) => x.e.prot!.value), cur: sum((x) => x.e.cur.value), fin: sum((x) => x.e.final!.value), sale: sum((x) => x.e.final!.sale) };

  // Recoveries in the month.
  const recM = deals.flatMap((d) => d.recoveries.filter((r) => inMonth(r.openedAt, month)).map((r) => ({ r, d })));
  const recCause = new Map<string, number>();
  for (const { r } of recM) { const c = causeOf(r.cause, r.whatChanged); recCause.set(c, (recCause.get(c) ?? 0) + 1); }

  // Product health (SOLU, not people): warning quality and re-entry.
  const allP = deals.map((d) => ({ d, p: promiseOf(d) })).filter((x) => x.p && x.p.original >= addDays(now, -180));
  const revisedAll = allP.filter((x) => x.p!.revised);
  const inTime = revisedAll.filter((x) => x.p!.revisedInTime).length;
  const silent = allP.filter((x) => x.p!.silent);
  const sig = (k: string) => signals.filter((s) => s.kind === k);
  const patterns = patternsOf(deals, now, t, cName).slice(0, 6);

  return (
    <>
      {header}
      {filterNote}
      {decisions.length > 0 && (
        <section className="iv-decide">
          <div className="iv-decide-h"><b>{t("Necesita a gerencia", "Needs management")}</b><span className="src">{t("decisiones que hoy solo gerencia puede tomar", "decisions only management can make today")}</span></div>
          <ul>{decisions.map((d) => <li key={d.key}><div><b>{d.title}</b><span className="src block">{d.detail}</span></div><Link className="btn secondary sm" href={d.href}>{d.cta}</Link></li>)}</ul>
        </section>
      )}
      <h2 className="iv-month">{mName(month).replace(/^./, (c) => c.toUpperCase())}{month.getTime() === monthStart(now).getTime() && <span className="src"> · {t("mes en curso", "month in progress")}</span>}</h2>
      <div className="iv-grid">
        <Q q={t("¿Nuestras soluciones resolvieron el problema del cliente?", "Did our solutions solve the customer's problem?")}
          a={monthRes.length ? t(`${ach} de ${relevant} resultados confirmados se lograron${monthRes.length - relevant ? ` (${monthRes.length - relevant} ya no aplica)` : ""}. Entregar no cuenta como resultado.`, `${ach} of ${relevant} confirmed results were achieved${monthRes.length - relevant ? ` (${monthRes.length - relevant} no longer relevant)` : ""}. Delivering doesn't count as a result.`) : t("Ningún resultado se confirmó este mes.", "No result was confirmed this month.")}
          side={<Legend items={RS.map((s) => ({ cls: `ich-${s.toLowerCase()}`, label: stateLabel(i, s).text }))} />}>
          {enoughTrend ? <StackBars label={t("Resultados por mes", "Results by month")} cols={resCols} segs={RS.map((s) => ({ cls: `ich-${s.toLowerCase()}` }))} /> : <p className="src">{t("Menos de 3 meses con resultados: no se dibuja tendencia.", "Fewer than 3 months with results: no trend drawn.")}</p>}
          {monthRes.length > 0 && (
            <ul className="plain small iv-res">{monthRes.map((d) => { const S = stateLabel(i, d.resultState, d.recoveries.some((r) => r.outcome === "RECOVERED")); return <li key={d.id}><span className={`sig ${S.cls}`}>{S.text}</span> <Link href={`/deals/${d.id}/resultado`}>{jName(d)}</Link><span className="src block">{d.desiredResult ?? d.title} → {d.actualResult ?? "—"}</span></li>; })}</ul>
          )}
          {deliveredNoResult.length > 0 && <p className="src">{t(`${deliveredNoResult.length} Journey(s) entregados sin resultado confirmado todavía:`, `${deliveredNoResult.length} delivered Journey(s) with no confirmed result yet:`)} {deliveredNoResult.slice(0, 5).map((d, n) => <span key={d.id}>{n ? ", " : ""}<Link href={`/deals/${d.id}/resultado`}>{d.code}</Link></span>)}</p>}
        </Q>

        <Q q={t("¿Cumplimos lo que prometimos, y cuándo lo cambiamos?", "Did we keep what we promised, and when did we change it?")}
          a={proms.length ? t(`${pc.KEPT} cumplidas a la fecha original · ${pc.REV} revisadas a tiempo y cumplidas · ${pc.MISSED} incumplida(s).`, `${pc.KEPT} kept on the original date · ${pc.REV} revised in time and kept · ${pc.MISSED} missed.`) : t("Ninguna entrega con promesa este mes.", "No delivery with a promise this month.")}
          side={<Legend items={[{ cls: "ich-orig", label: t("original", "original"), shape: "ring" }, { cls: "ich-rev", label: t("revisada", "revised"), shape: "diamond" }, { cls: "ich-act kept", label: t("real", "actual"), shape: "dot" }]} />}>
          {proms.length > 0 && <PromiseStrip label="promises" early={t("antes", "early")} late={t("después (días)", "later (days)")} rows={proms.sort((a, b) => (b.p!.deltaActual ?? 0) - (a.p!.deltaActual ?? 0)).map(({ d, p }) => ({ label: jName(d), href: `/deals/${d.id}?tab=promise`, revised: p!.deltaRevised, actual: p!.deltaActual, cls: p!.outcome === "KEPT" ? "kept" : p!.outcome === "REVISED_IN_TIME" ? "rev" : "missed", tip: `${jName(d)} · ${t("original", "original")} ${i.day(p!.original)}${p!.revised ? ` · ${t("revisada", "revised")} ${i.day(p!.revised)} (${t("avisada el", "flagged on")} ${i.day(p!.revisedAt)})` : ""} · ${t("real", "actual")} ${i.day(p!.actual)}${p!.changeCause ? ` · ${cName(p!.changeCause)}` : ""}` }))} />}
          {proms.some((x) => x.p!.outcome !== "KEPT") && <ul className="plain small">{proms.filter((x) => x.p!.outcome !== "KEPT").map(({ d, p }) => <li key={d.id}><Link href={`/deals/${d.id}`}>{jName(d)}</Link> · {p!.outcome === "MISSED" ? <b className="risk-t">{t(`${p!.deltaActual} d después de la original`, `${p!.deltaActual} d after the original`)}</b> : t("revisada antes de la fecha original", "revised before the original date")} · {cName(p!.changeCause ?? "UNKNOWN")}{p!.silent && <b className="risk-t"> · {t("sin aviso previo", "no prior warning")}</b>}</li>)}</ul>}
        </Q>

        <Q q={t("¿Cuánta eságara protegimos, cuánta tenemos y cuánta quedó?", "How much eságara did we protect, how much do we have, and how much was left?")}
          a={econP.length ? t(`En ${econP.length} Journey(s) facturados: protegida ${i.money(tot.prot)} → actual ${i.money(tot.cur)} → final ${i.money(tot.fin)} (${i.pct(tot.sale ? (tot.fin / tot.sale) * 100 : null)} de la venta).`, `In ${econP.length} invoiced Journey(s): protected ${i.money(tot.prot)} → current ${i.money(tot.cur)} → final ${i.money(tot.fin)} (${i.pct(tot.sale ? (tot.fin / tot.sale) * 100 : null)} of sales).`) : t("Ningún Journey con cotización presentada terminó de facturarse este mes.", "No Journey with a presented quote finished invoicing this month.")}
          side={<Legend items={[{ cls: "ich-prot", label: t("protegida", "protected"), shape: "ring" }, { cls: "ich-fin", label: t("final", "final"), shape: "dot" }, { cls: "ich-fin down", label: t("final bajo lo protegido", "final below protected"), shape: "dot" }]} />}>
          {econP.length > 0 && (
            <>
              <div className="iv-econ">
                <div><span className="k">{t("Protegida", "Protected")}</span><b>{i.money(tot.prot)}</b><span className="src">{t("al presentar la cotización", "when the quote was presented")}</span></div>
                <div><span className="k">{t("Actual", "Current")}</span><b>{i.money(tot.cur)}</b><span className="src">{t("costos reales del Journey", "the Journey's real costs")}</span></div>
                <div><span className="k">{t("Final", "Final")}</span><b>{i.money(tot.fin)}</b><span className="src">{t("facturada", "invoiced")}{tot.fin < tot.prot - 1 && <b className="risk-t"> · −{i.money(tot.prot - tot.fin)}</b>}</span></div>
              </div>
              <Dumbbell label="eságara" rows={econP.map(({ d, e }) => ({ label: jName(d), href: `/deals/${d.id}`, prot: (e.prot!.value / e.prot!.sale) * 100, cur: e.cur.pct, fin: e.final!.sale ? (e.final!.value / e.final!.sale) * 100 : null, down: e.final!.value < e.prot!.value - 1, tip: `${jName(d)} · ${t("protegida", "protected")} ${i.money(e.prot!.value)} (${e.prot!.ref}) → ${t("final", "final")} ${i.money(e.final!.value)}${e.erosion ? ` · ${cName(e.erosion.cause)}` : ""}` }))} />
            </>
          )}
          {econ.length > econP.length && <p className="src">{t(`${econ.length - econP.length} Journey(s) facturados sin cotización presentada: sin economía protegida para comparar.`, `${econ.length - econP.length} invoiced Journey(s) with no presented quote: no protected economics to compare.`)}</p>}
        </Q>

        <Q q={t("¿Qué se rompió este mes y por qué?", "What broke this month, and why?")}
          a={recM.length ? t(`${recM.length} Recovery abierta(s) este mes · ${openRecs.length} abiertas hoy en total.`, `${recM.length} Recovery(ies) opened this month · ${openRecs.length} open today in total.`) : t(`Ninguna Recovery abierta este mes · ${openRecs.length} abiertas hoy.`, `No Recovery opened this month · ${openRecs.length} open today.`)}
          side={openRecs.length > 0 && <Link href={link({ view: "recovery" })} className="small">{t("ver Recovery abierto", "see open Recovery")}</Link>}>
          {recM.length > 0 && <HBars label="causes" rows={[...recCause].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ label: cName(c), value: n, tip: recM.filter((x) => causeOf(x.r.cause, x.r.whatChanged) === c).map((x) => jName(x.d)).join(", "), href: link({ view: "causas", cause: c, effect: "RECOVERY" }) }))} />}
          {recM.length > 0 && <ul className="plain small">{recM.map(({ r, d }) => <li key={r.id}><Link href={`/deals/${d.id}/resultado#recovery`}>{jName(d)}</Link> · {r.whatChanged} · <b>{r.resolvedAt ? (r.outcome === "RECOVERED" ? t("recuperada", "recovered") : t("resuelta", "resolved")) : t("abierta", "open")}</b></li>)}</ul>}
        </Q>
      </div>

      <div className="iv-grid">
        <Q q={t("¿Qué patrones se repiten con clientes, proveedores y productos?", "Which patterns repeat across customers, suppliers and products?")} a={patterns.length ? t(`${patterns.length} patrón(es) en 12 meses, cada uno con su evidencia.`, `${patterns.length} pattern(s) in 12 months, each with its evidence.`) : t("Ningún patrón se repite todavía.", "No pattern repeats yet.")}>
          {patterns.length > 0 && <ul className="iv-pat">{patterns.map((p) => <li key={p.key}><span className={`iv-pk k-${p.kind.toLowerCase()}`}>{{ CUSTOMER: t("Cliente", "Customer"), SUPPLIER: t("Proveedor", "Supplier"), PRODUCT: t("Producto", "Product"), CAUSE: t("Causa", "Cause") }[p.kind]}</span><div><Link href={p.href}><b>{p.title}</b></Link><span className="src block">{p.context}</span></div></li>)}</ul>}
        </Q>

        <Q q={t("¿SOLU avisó a tiempo, sin ruido y sin hacer reescribir datos?", "Did SOLU warn in time, without noise and without making people retype data?")}
          a={t("Salud del producto, no de las personas: mide si el sistema ayudó a decidir.", "Product health, not people's: it measures whether the system helped decide.")}>
          <dl className="iv-health">
            <dt>{t("Cambios de promesa avisados antes de la fecha original", "Promise changes flagged before the original date")}</dt>
            <dd><b>{revisedAll.length ? `${inTime} / ${revisedAll.length}` : "—"}</b><span className="src">{t("últimos 6 meses", "last 6 months")}</span></dd>
            <dt>{t("Incumplidas sin ningún aviso previo (defecto de atención)", "Missed with no prior warning (attention defect)")}</dt>
            <dd><b className={silent.length ? "risk-t" : ""}>{silent.length}</b>{silent.length > 0 && <span className="src">{silent.slice(0, 4).map((x, n) => <span key={x.d.id}>{n ? ", " : ""}<Link href={`/deals/${x.d.id}`}>{x.d.code}</Link></span>)}</span>}</dd>
            <dt>{t("Avisos sin necesidad, reportados", "Unneeded warnings, reported")}</dt>
            <dd><b>{sig("ATTENTION_NOISE").length}</b><span className="src">{t("90 días", "90 days")}</span></dd>
            <dt>{t("Avisos que faltaron, reportados", "Missing warnings, reported")}</dt>
            <dd><b>{sig("ATTENTION_MISSED").length}</b><span className="src">{t("90 días", "90 days")}</span></dd>
            <dt>{t("Datos que hubo que reescribir (no-reentry)", "Data that had to be retyped (no-reentry)")}</dt>
            <dd><b className={sig("REENTRY").length ? "attn-t" : ""}>{sig("REENTRY").length}</b><span className="src">{t("90 días", "90 days")}</span></dd>
          </dl>
          {signals.length > 0 && <ul className="plain small iv-sigs">{signals.slice(0, 5).map((s) => <li key={s.id}><b>{{ REENTRY: t("Reescribir", "Retype"), ATTENTION_NOISE: t("Aviso innecesario", "Unneeded warning"), ATTENTION_MISSED: t("Aviso faltante", "Missing warning") }[s.kind] ?? s.kind}</b>{s.screen ? ` · ${s.screen}` : ""} — {s.note}<span className="src block">{bareName(s.reportedByName)} · {i.day(s.createdAt)}</span></li>)}</ul>}
          <ReportSignal es={i.es} />
        </Q>
      </div>
      <p className="src iv-foot">{t("Aquí no se muestran mensajes enviados, llamadas, minutos conectados ni rankings de personas: no cambian una decisión de gerencia.", "Messages sent, calls, minutes connected and people rankings are not shown here: they don't change a management decision.")}</p>
    </>
  );
}
