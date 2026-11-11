import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { SCENARIO_KINDS, asOptions, rangesOverlap, type ScenarioOption } from "@/lib/gerencia-rules";
import { Notes } from "../ui";
import { archiveScenario, saveScenario } from "./actions";

// Módulo 15 §7 · Scenarios and resource allocation. Options side by side, each with the assumptions it rests on and
// a range of what it may leave. The shared facts stay apart, on top. When ranges overlap SOLU says so instead of
// naming a winner: the choice is Gerencia's.

const ROWS = 4;

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; f?: string; ver?: string }> }) {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  const rows = await db.scenario.findMany({ where: sp.ver === "todos" ? {} : { status: { not: "ARCHIVED" } }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 60, include: { decisions: { where: { supersededAt: null }, select: { id: true, code: true, status: true, chosen: true, decision: true } } } });
  const miss = new Set((sp.f ?? "").split(","));
  const need = (k: string) => (miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const ok = { creado: t("Escenario guardado.", "Scenario saved."), guardado: t("Cambios guardados.", "Changes saved."), archivado: t("Escenario archivado.", "Scenario archived.") };
  const err = { permiso: t("Solo Gerencia, Dirección o quien lo creó.", "Only Management, Direction or its author."), cerrado: t("Ese escenario ya tiene una decisión o está archivado: se conserva como estaba.", "That scenario already has a decision or is archived: it is kept as it was."), faltan: t("Falta lo marcado en rojo. Un escenario necesita la pregunta, los hechos, qué miden los rangos y al menos dos opciones con nombres distintos; cada opción con sus supuestos y un rango (mínimo ≤ máximo), no una cifra única. No se guardó nada.", "What is marked in red is missing. A scenario needs the question, the facts, what the ranges measure and at least two options with different names; each option with its assumptions and a range (low ≤ high), not a single figure. Nothing was saved.") };
  const STATUS = { OPEN: { es: "Abierto", en: "Open", tone: "info" }, DECIDED: { es: "Con decisión", en: "Decided", tone: "ok" }, ARCHIVED: { es: "Archivado", en: "Archived", tone: "wait" } } as Record<string, { es: string; en: string; tone: string }>;

  const form = (s: (typeof rows)[number] | null) => {
    const opts: (ScenarioOption | null)[] = s ? asOptions(s.options) : [];
    while (opts.length < ROWS) opts.push(null);
    return (
      <form action={saveScenario.bind(null, s?.id ?? null)} className="qa-form">
        <div className="qa-row">
          <label style={{ flex: "2 1 260px" }}>{t("Nombre del escenario", "Scenario name")}<input name="title" required maxLength={160} defaultValue={s?.title ?? ""} {...need("title")} /></label>
          <label style={{ flex: "2 1 260px" }}>{t("Tipo", "Kind")}<select name="kind" defaultValue={s?.kind ?? "OTHER"}>{Object.entries(SCENARIO_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
        </div>
        <label>{t("La pregunta que hay que decidir", "The question to decide")}<input name="question" required maxLength={300} defaultValue={s?.question ?? ""} {...need("question")} /></label>
        <label>{t("Hechos: lo que se sabe y vale para todas las opciones (con su fuente)", "Facts: what is known and holds for every option (with its source)")}<textarea name="facts" required rows={3} maxLength={3000} defaultValue={s?.facts ?? ""} {...need("facts")} /></label>
        <label>{t("Qué miden los rangos", "What the ranges measure")}<input name="measure" required maxLength={160} placeholder={t("p. ej. Eságara a 12 meses, en USD", "e.g. Eságara over 12 months, in USD")} defaultValue={s?.measure ?? ""} {...need("measure")} /></label>
        <div className="gm-opts" {...need("options")}>
          {opts.slice(0, ROWS).map((o, k) => (
            <div key={k} className="gm-opt qa-form">
              <label>{t(`Opción ${k + 1}`, `Option ${k + 1}`)}{k < 2 ? "" : t(" (opcional)", " (optional)")}<input name={`name_${k}`} maxLength={120} defaultValue={o?.name ?? ""} {...need("optionNames")} /></label>
              <label>{t("En qué consiste", "What it consists of")}<input name={`description_${k}`} maxLength={600} defaultValue={o?.description ?? ""} /></label>
              <label>{t("Supuestos: lo que tendría que ser cierto", "Assumptions: what would have to be true")}<textarea name={`assumptions_${k}`} rows={2} maxLength={800} defaultValue={o?.assumptions ?? ""} {...need("assumptions")} /></label>
              <div className="qa-row">
                <label style={{ flex: "1 1 90px" }}>{t("Mínimo", "Low")}<input name={`low_${k}`} inputMode="decimal" defaultValue={o?.low ?? ""} {...need("range")} {...need("rangeOrder")} /></label>
                <label style={{ flex: "1 1 90px" }}>{t("Máximo", "High")}<input name={`high_${k}`} inputMode="decimal" defaultValue={o?.high ?? ""} {...need("range")} {...need("rangeOrder")} /></label>
              </div>
              <label>{t("Riesgos y lo que se sacrifica", "Risks and what is given up")}<input name={`risks_${k}`} maxLength={600} defaultValue={o?.risks ?? ""} /></label>
            </div>
          ))}
        </div>
        <div className="qa-row">
          <label style={{ flex: "1 1 240px" }}>{t("Registro de SOLU del que trata (dirección que empieza por /, opcional)", "SOLU record it is about (address starting with /, optional)")}<input name="sourceHref" maxLength={300} defaultValue={s?.sourceHref ?? ""} placeholder="/deals/…" /></label>
          <label style={{ flex: "1 1 200px" }}>{t("Nombre de ese registro", "Name of that record")}<input name="sourceLabel" maxLength={160} defaultValue={s?.sourceLabel ?? ""} /></label>
        </div>
        <div><button type="submit" className={s ? "secondary" : ""}>{s ? t("Guardar cambios", "Save changes") : t("Guardar el escenario", "Save the scenario")}</button></div>
      </form>
    );
  };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Escenarios", "Scenarios")}</h1>
        <p>{t("Para comparar opciones antes de decidir: aceptar un negocio de Eságara baja, subir un cupo, financiar una compra, comprar inventario, asignar personas, acelerar una importación. Un escenario no es un pronóstico: guarda sus supuestos y sus rangos.", "To compare options before deciding: accepting a low-Eságara deal, raising a limit, financing a purchase, buying stock, assigning people, expediting an import. A scenario is not a forecast: it keeps its assumptions and its ranges.")}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />
      {rows.length === 0 && <div className="card"><p className="small muted">{t("Aún no hay escenarios.", "No scenarios yet.")}</p></div>}

      {rows.map((s) => {
        const opts = asOptions(s.options);
        const lo = Math.min(...opts.map((o) => o.low ?? 0)), hi = Math.max(...opts.map((o) => o.high ?? 0)), span = hi - lo || 1;
        const overlap = opts.some((a, x) => opts.some((b, y) => y > x && rangesOverlap(a, b)));
        const decided = s.decisions.find((d) => d.status === "DECIDED");
        const editable = s.status === "OPEN" && (ger || s.createdById === user.id);
        return (
          <section key={s.id} id={`s-${s.id}`} className="card">
            <div><b style={{ fontSize: 15 }}>{s.title}</b> <span className={`sig ${STATUS[s.status]?.tone ?? "wait"}`}>{t(STATUS[s.status]?.es ?? s.status, STATUS[s.status]?.en ?? s.status)}</span> <span className="small muted">· {t(SCENARIO_KINDS[s.kind]?.es ?? s.kind, SCENARIO_KINDS[s.kind]?.en ?? s.kind)} · {s.createdByName} · {i.date(s.createdAt)}</span></div>
            <p style={{ margin: "6px 0" }}><b>{s.question}</b>{s.sourceHref ? <span className="small"> · <Link href={s.sourceHref}>{s.sourceLabel ?? s.sourceHref}</Link></span> : null}</p>
            <div className="note"><div><b>{t("Hechos", "Facts")}</b> <span className="src">{t("lo que se sabe", "what is known")}</span><span className="gm-pre block">{s.facts}</span></div></div>
            <p className="small" style={{ marginTop: 10 }}>{t("Rangos de", "Ranges of")}: <b>{s.measure}</b></p>
            <div className="gm-opts">
              {opts.map((o) => (
                <div key={o.name} className="gm-opt">
                  <b>{o.name}</b>{decided?.chosen === o.name ? <span className="sig ok" style={{ marginLeft: 6 }}>{t("elegida", "chosen")}</span> : null}
                  {o.description ? <span className="small block">{o.description}</span> : null}
                  <div className="gm-range" role="img" aria-label={`${o.low} – ${o.high}`}><i style={{ left: `${(((o.low ?? 0) - lo) / span) * 100}%`, width: `${Math.max(1, (((o.high ?? 0) - (o.low ?? 0)) / span) * 100)}%` }} /></div>
                  <span className="mono small">{i.n(o.low)} – {i.n(o.high)}</span>
                  <span className="small block" style={{ marginTop: 6 }}><span className="sig dash">{t("Supuestos", "Assumptions")}</span> <span className="gm-pre">{o.assumptions}</span></span>
                  {o.risks ? <span className="small block" style={{ marginTop: 4 }}><span className="sig wait">{t("Riesgos", "Risks")}</span> {o.risks}</span> : null}
                </div>
              ))}
            </div>
            <p className="src">{overlap ? t("Hay rangos que se cruzan: con estos supuestos ninguna opción es claramente mejor que otra. La elección depende de cuál supuesto se cree más.", "Some ranges overlap: with these assumptions no option is clearly better than another. The choice depends on which assumption is believed more.") : t("Los rangos no se cruzan, pero siguen siendo supuestos y no un pronóstico.", "The ranges do not overlap, but they are still assumptions and not a forecast.")}</p>
            {s.decisions.length > 0 ? <p className="small">{t("Decisión", "Decision")}: {s.decisions.map((d) => <span key={d.id}><Link href={`/gerencia/decisiones/${d.id}`}><b className="mono">{d.code}</b></Link>{d.decision ? ` · ${d.decision}` : ` · ${t("espera decisión", "awaiting decision")}`} </span>)}</p>
              : s.status === "OPEN" ? <p><Link className="btn secondary sm" href={`/gerencia/decisiones?escenario=${s.id}#pedir`}>{ger ? t("Llevarlo a una decisión", "Take it to a decision") : t("Pedir la decisión a Gerencia", "Ask Management for the decision")}</Link></p> : null}
            {editable && s.decisions.length === 0 && (
              <details open={sp.err === "faltan"}><summary className="small">{t("Cambiar el escenario", "Change the scenario")}</summary>{form(s)}
                <form action={archiveScenario.bind(null, s.id)} style={{ marginTop: 8 }}><button type="submit" className="linkb">{t("Archivarlo: ya no hace falta", "Archive it: no longer needed")}</button></form>
              </details>
            )}
          </section>
        );
      })}
      <p className="small">{sp.ver === "todos" ? <Link href="/gerencia/escenarios">{t("Ocultar los archivados", "Hide archived ones")}</Link> : <Link href="/gerencia/escenarios?ver=todos">{t("Ver también los archivados", "Also show archived ones")}</Link>}</p>
      <section className="card" id="nuevo"><b>{t("NUEVO ESCENARIO", "NEW SCENARIO")}</b>{form(null)}</section>
    </>
  );
}
