import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { periodOf } from "@/lib/goal-rules";
import { METRICS } from "@/lib/metric-dictionary";
import { computePulse } from "@/lib/pulse";
import { LINK_KINDS, PRIORITY_STATUS, priorityHealth } from "@/lib/gerencia-rules";
import { HowCalc } from "@/components/HowCalc";
import { Notes, fmtFig } from "../ui";
import { closePriority, linkPriority, reviewPriority, savePriority, unlinkPriority } from "./actions";

// Módulo 15 §3 · Strategic priorities: the direction chosen, why, what result is wanted, which early signs to watch,
// who answers for it, and the real records that carry it. Its indicators read the certified metrics, never a copy.

type Ind = { text: string; metric: string | null };

export default async function PrioritiesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; f?: string; ver?: string }> }) {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  const T = today();
  const closedToo = sp.ver === "todas";
  const [rows, pulse, people] = await Promise.all([
    db.strategicPriority.findMany({ where: closedToo ? {} : { status: "ACTIVE" }, orderBy: [{ status: "asc" }, { createdAt: "asc" }], include: { owner: { select: { id: true, name: true } }, links: { orderBy: { createdAt: "asc" } }, reviews: { orderBy: { createdAt: "desc" }, take: 6 } } }),
    computePulse(periodOf(T)),
    ger ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  // Resolve every link to the live record it points at.
  const ids = (k: string) => [...new Set(rows.flatMap((r) => r.links.filter((l) => l.kind === k).map((l) => l.refId)))];
  const [accounts, deals, explorations, decisions, scenarios, pick] = await Promise.all([
    db.account.findMany({ where: { id: { in: ids("ACCOUNT") } }, select: { id: true, name: true } }),
    db.deal.findMany({ where: { id: { in: ids("JOURNEY") } }, select: { id: true, code: true, title: true, stage: true, account: { select: { name: true } } } }),
    db.exploration.findMany({ where: { id: { in: ids("EXPLORATION") } }, select: { id: true, name: true, lifecycle: true } }),
    db.managementDecision.findMany({ where: { id: { in: ids("DECISION") } }, select: { id: true, code: true, question: true, status: true } }),
    db.scenario.findMany({ where: { id: { in: ids("SCENARIO") } }, select: { id: true, title: true, status: true } }),
    ger ? Promise.all([
      db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, take: 400, select: { id: true, name: true } }),
      db.deal.findMany({ where: { internal: false, stage: { not: "LOST" }, closedAt: null }, orderBy: { updatedAt: "desc" }, take: 150, select: { id: true, code: true, title: true, account: { select: { name: true } } } }),
      db.exploration.findMany({ orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } }),
      db.managementDecision.findMany({ where: { supersededAt: null, status: { not: "WITHDRAWN" } }, orderBy: { requestedAt: "desc" }, take: 80, select: { id: true, code: true, question: true } }),
      db.scenario.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, title: true } }),
    ]) : null,
  ]);
  const resolve = (kind: string, refId: string): { href: string; label: string; state: string | null } | null => {
    if (kind === "ACCOUNT") { const a = accounts.find((x) => x.id === refId); return a ? { href: `/accounts/${a.id}`, label: a.name, state: null } : null; }
    if (kind === "JOURNEY") { const d = deals.find((x) => x.id === refId); return d ? { href: `/deals/${d.id}`, label: `${d.code ?? ""} · ${d.account.name} · ${d.title}`, state: d.stage } : null; }
    if (kind === "EXPLORATION") { const e = explorations.find((x) => x.id === refId); return e ? { href: `/mercado/exploraciones/${e.id}`, label: e.name, state: e.lifecycle } : null; }
    if (kind === "DECISION") { const d = decisions.find((x) => x.id === refId); return d ? { href: `/gerencia/decisiones/${d.id}`, label: `${d.code} · ${d.question}`, state: d.status } : null; }
    const s = scenarios.find((x) => x.id === refId); return s ? { href: `/gerencia/escenarios#s-${s.id}`, label: s.title, state: s.status } : null;
  };
  const c = pulse.cur, st = pulse.state;
  const live: Record<string, { v: number | null; unit: "usd" | "n" | "pct"; when: string }> = {
    SALES: { v: c.sale, unit: "usd", when: t("este mes", "this month") }, ESAGARA_AMOUNT: { v: c.esagara, unit: "usd", when: t("este mes", "this month") }, ESAGARA_PCT: { v: c.esagaraPct, unit: "pct", when: t("este mes", "this month") },
    NEEDS_CREATED: { v: c.needs, unit: "n", when: t("este mes", "this month") }, SOLUTIONS_PRESENTED: { v: c.presentations, unit: "n", when: t("este mes", "this month") }, DECISIONS_MOVED: { v: c.decisions, unit: "n", when: t("este mes", "this month") },
    OUTSTANDING: { v: st.outstanding, unit: "usd", when: t("hoy", "today") }, OVERDUE: { v: st.overdue, unit: "usd", when: t("hoy", "today") }, CUSTOMER_PROMISE: { v: c.withPromise ? (c.onTime / c.withPromise) * 100 : null, unit: "pct", when: t("este mes", "this month") },
  };
  const miss = new Set((sp.f ?? "").split(","));
  const need = (k: string) => (miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const ok = { creada: t("Prioridad creada.", "Priority created."), guardada: t("Cambios guardados.", "Changes saved."), revisada: t("Revisión guardada.", "Review saved."), vinculada: t("Vinculada.", "Linked."), desvinculada: t("Vínculo quitado.", "Link removed."), cerrada: t("Prioridad cerrada. Queda en el registro.", "Priority closed. It stays in the record.") };
  const err = { gerencia: t("Solo Gerencia define las prioridades.", "Only Management sets the priorities."), permiso: t("Solo Gerencia o quien responde por la prioridad.", "Only Management or the priority's owner."), faltan: t("Falta lo marcado en rojo: título, por qué, resultado buscado, horizonte, responsable y al menos una señal temprana. No se guardó nada.", "What is marked in red is missing: title, why, desired result, horizon, owner and at least one early sign. Nothing was saved."), revision: t("Escribe cómo va de verdad y cuándo se vuelve a revisar.", "Write how it is really going and when it is reviewed again."), vinculo: t("Elige un registro que exista.", "Choose a record that exists."), cierre: t("Elige cómo terminó y escribe por qué.", "Choose how it ended and write why."), cerrada: t("Esa prioridad ya está cerrada.", "That priority is already closed."), "no-existe": t("No existe.", "It doesn't exist.") };
  const HEALTH = { NO_LINKS: t("No apunta a ningún registro real: así es solo una intención", "It points at no real record: like this it is only an intention"), REVIEW_DUE: t("Toca revisarla", "Time to review it"), NO_NARRATIVE: t("Nadie ha escrito cómo va", "Nobody has written how it is going") };

  const form = (p: (typeof rows)[number] | null) => {
    const ind: Ind[] = p ? ((Array.isArray(p.indicators) ? p.indicators : []) as Ind[]) : [];
    return (
      <form action={savePriority.bind(null, p?.id ?? null)} className="qa-form">
        <label>{t("Prioridad, en pocas palabras", "Priority, in a few words")}<input name="title" required maxLength={160} defaultValue={p?.title ?? ""} {...need("title")} /></label>
        <label>{t("Por qué la elegimos", "Why we chose it")}<textarea name="rationale" required rows={2} maxLength={2000} defaultValue={p?.rationale ?? ""} {...need("rationale")} /></label>
        <label>{t("Resultado que buscamos", "Result we want")}<textarea name="desiredOutcome" required rows={2} maxLength={2000} defaultValue={p?.desiredOutcome ?? ""} {...need("desiredOutcome")} /></label>
        <div className="qa-row">
          <label style={{ flex: "1 1 160px" }}>{t("Horizonte", "Horizon")}<input name="horizon" required maxLength={80} placeholder={t("p. ej. 18 meses", "e.g. 18 months")} defaultValue={p?.horizon ?? ""} {...need("horizon")} /></label>
          <label style={{ flex: "1 1 160px" }}>{t("Hasta (fecha, opcional)", "Until (date, optional)")}<input type="date" name="horizonTo" defaultValue={p?.horizonTo ? dayInput(p.horizonTo) : ""} /></label>
          <label style={{ flex: "1 1 200px" }}>{t("Quién responde", "Owner")}<select name="ownerId" required defaultValue={p?.ownerId ?? user.id} {...need("owner")}>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label style={{ flex: "1 1 160px" }}>{t("Próxima revisión", "Next review")}<input type="date" name="nextReviewOn" defaultValue={p?.nextReviewOn ? dayInput(p.nextReviewOn) : ""} /></label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} {...need("indicators")}><legend className="small">{t("Señales tempranas: métricas certificadas que se miran antes del resultado", "Early signs: certified metrics watched before the result")}</legend>
          <div className="qa-row">{Object.keys(live).map((m) => <label key={m} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><input type="checkbox" name="metric" value={m} defaultChecked={ind.some((x) => x.metric === m)} style={{ width: "auto" }} />{t(METRICS[m].name.es, METRICS[m].name.en)}</label>)}</div>
        </fieldset>
        <label>{t("Otras señales, una por línea (hechos que se pueden observar)", "Other signs, one per line (facts that can be observed)")}<textarea name="indicators" rows={2} maxLength={2000} defaultValue={ind.filter((x) => !x.metric).map((x) => x.text).join("\n")} {...need("indicators")} /></label>
        <div><button type="submit" className={p ? "secondary" : ""}>{p ? t("Guardar cambios", "Save changes") : t("Crear la prioridad", "Create the priority")}</button></div>
      </form>
    );
  };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Prioridades estratégicas", "Strategic priorities")}</h1>
        <p>{t("La dirección elegida: por qué, qué resultado buscamos, qué señales lo anuncian y qué clientes, Journeys y decisiones la llevan. No es una lista de tareas.", "The chosen direction: why, what result we want, which signs announce it and which customers, Journeys and decisions carry it. It is not a task list.")}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />
      {rows.length === 0 && <div className="card"><p className="small muted">{ger ? t("Aún no hay prioridades. Crea la primera abajo.", "No priorities yet. Create the first one below.") : t("Gerencia aún no ha definido prioridades.", "Management hasn't set priorities yet.")}</p></div>}

      {rows.map((p) => {
        const ind = (Array.isArray(p.indicators) ? p.indicators : []) as Ind[];
        const health = priorityHealth({ status: p.status, links: p.links.length, nextReviewOn: p.nextReviewOn, narrativeAt: p.narrativeAt }, T);
        const mine = ger || p.ownerId === user.id;
        return (
          <section key={p.id} id={`p-${p.id}`} className="card">
            <div><b style={{ fontSize: 15 }}>{p.title}</b> <span className={`sig ${PRIORITY_STATUS[p.status]?.tone ?? "wait"}`}>{t(PRIORITY_STATUS[p.status]?.es ?? p.status, PRIORITY_STATUS[p.status]?.en ?? p.status)}</span> <span className="small muted">· {p.owner.name} · {t("horizonte", "horizon")} {p.horizon}{p.horizonTo ? ` (${i.date(p.horizonTo)})` : ""}</span></div>
            {health.map((h) => <span key={h} className="sig attn" style={{ marginRight: 6, marginTop: 4 }}>{HEALTH[h]}</span>)}
            <dl className="qv-dl" style={{ marginTop: 8 }}>
              <dt>{t("Por qué", "Why")}</dt><dd className="gm-pre">{p.rationale}</dd>
              <dt>{t("Resultado buscado", "Desired result")}</dt><dd className="gm-pre">{p.desiredOutcome}</dd>
              <dt>{t("Señales tempranas", "Early signs")}</dt><dd><ul className="plain">{ind.map((x, k) => { const L = x.metric ? live[x.metric] : null; return <li key={k}>{x.metric && METRICS[x.metric] ? t(METRICS[x.metric].name.es, METRICS[x.metric].name.en) : x.text}{L ? <> · <b className="mono">{fmtFig(i, L.unit, L.v)}</b> <span className="src">{L.when}</span> <HowCalc id={x.metric!} es={i.es} /></> : <span className="src"> · {t("se observa a mano", "observed by hand")}</span>}</li>; })}</ul></dd>
              <dt>{t("Dónde vive", "Where it lives")}</dt><dd>{p.links.length === 0 ? <span className="muted">{t("Sin registros vinculados", "No linked records")}</span> : <ul className="plain">{p.links.map((l) => { const r = resolve(l.kind, l.refId); return <li key={l.id}><span className="sig wait">{t(LINK_KINDS[l.kind]?.es ?? l.kind, LINK_KINDS[l.kind]?.en ?? l.kind)}</span> {r ? <Link href={r.href}>{r.label}</Link> : <span className="muted">{t("el registro ya no existe", "the record no longer exists")}</span>}{r?.state ? <span className="src"> · {r.state}</span> : null}{l.note ? <span className="src"> · {l.note}</span> : null}{ger && p.status === "ACTIVE" ? <form action={unlinkPriority.bind(null, l.id)} style={{ display: "inline", marginLeft: 6 }}><button type="submit" className="linkb">{t("quitar", "remove")}</button></form> : null}</li>; })}</ul>}</dd>
              <dt>{t("Cómo va", "How it is going")}</dt><dd>{p.narrative ? <><span className="gm-pre">{p.narrative}</span><span className="src block">{p.narrativeByName} · {i.date(p.narrativeAt)}</span></> : <span className="muted">{t("Sin narrativa todavía", "No narrative yet")}</span>}</dd>
              <dt>{t("Próxima revisión", "Next review")}</dt><dd>{p.nextReviewOn ? i.date(p.nextReviewOn) : "—"}</dd>
              {p.closedAt && <><dt>{t("Cierre", "Close")}</dt><dd>{i.date(p.closedAt)} · {p.closedNote}</dd></>}
            </dl>
            {p.reviews.length > 1 && <details><summary className="small">{t(`Revisiones anteriores (${p.reviews.length - 1})`, `Earlier reviews (${p.reviews.length - 1})`)}</summary><ul className="plain small">{p.reviews.slice(1).map((r) => <li key={r.id}><b>{i.date(r.createdAt)}</b> · {r.byName}: <span className="gm-pre">{r.narrative}</span></li>)}</ul></details>}
            {p.status === "ACTIVE" && mine && (
              <div className="qa-form" style={{ marginTop: 8 }}>
                <details open={health.includes("REVIEW_DUE")}><summary className="small">{t("Revisar: escribir cómo va hoy", "Review: write how it is going today")}</summary>
                  <form action={reviewPriority.bind(null, p.id)} className="qa-form">
                    <label>{t("Cómo va de verdad: qué avanzó, qué no, qué aprendimos", "How it is really going: what moved, what didn't, what we learned")}<textarea name="narrative" required rows={3} maxLength={3000} /></label>
                    <div className="qa-row" style={{ alignItems: "flex-end" }}><label>{t("Volver a revisar el", "Review again on")}<input type="date" name="nextReviewOn" required min={dayInput(T)} /></label><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar la revisión", "Save the review")}</button></div>
                  </form>
                </details>
                {ger && pick && <>
                  <details><summary className="small">{t("Vincular un cliente, Journey, exploración, decisión o escenario", "Link a customer, Journey, exploration, decision or scenario")}</summary>
                    <form action={linkPriority.bind(null, p.id)} className="qa-row" style={{ alignItems: "flex-end" }}>
                      <label style={{ flex: "2 1 300px" }}>{t("Registro", "Record")}<select name="ref" required defaultValue=""><option value="" disabled>{t("Elegir", "Choose")}</option>
                        <optgroup label={t("Decisiones", "Decisions")}>{pick[3].map((d) => <option key={d.id} value={`DECISION:${d.id}`}>{d.code} · {d.question.slice(0, 70)}</option>)}</optgroup>
                        <optgroup label={t("Escenarios", "Scenarios")}>{pick[4].map((s) => <option key={s.id} value={`SCENARIO:${s.id}`}>{s.title}</option>)}</optgroup>
                        <optgroup label={t("Exploraciones de mercado", "Market explorations")}>{pick[2].map((e) => <option key={e.id} value={`EXPLORATION:${e.id}`}>{e.name}</option>)}</optgroup>
                        <optgroup label="Journeys">{pick[1].map((d) => <option key={d.id} value={`JOURNEY:${d.id}`}>{d.code} · {d.account.name} · {d.title.slice(0, 50)}</option>)}</optgroup>
                        <optgroup label={t("Clientes", "Customers")}>{pick[0].map((a) => <option key={a.id} value={`ACCOUNT:${a.id}`}>{a.name}</option>)}</optgroup>
                      </select></label>
                      <label style={{ flex: "1 1 200px" }}>{t("Qué papel juega (opcional)", "What part it plays (optional)")}<input name="note" maxLength={300} /></label>
                      <button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Vincular", "Link")}</button>
                    </form>
                  </details>
                  <details open={sp.err === "faltan"}><summary className="small">{t("Cambiar la prioridad", "Change the priority")}</summary>{form(p)}</details>
                  <details><summary className="small">{t("Cerrarla: lograda o abandonada", "Close it: achieved or dropped")}</summary>
                    <form action={closePriority.bind(null, p.id)} className="qa-row" style={{ alignItems: "flex-end" }}>
                      <label>{t("Cómo terminó", "How it ended")}<select name="status"><option value="ACHIEVED">{t("Lograda", "Achieved")}</option><option value="DROPPED">{t("Abandonada", "Dropped")}</option></select></label>
                      <label style={{ flex: "2 1 260px" }}>{t("Por qué", "Why")}<input name="note" required maxLength={1000} /></label>
                      <button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Cerrar", "Close")}</button>
                    </form>
                  </details>
                </>}
              </div>
            )}
          </section>
        );
      })}
      <p className="small">{closedToo ? <Link href="/gerencia/prioridades">{t("Ver solo las vigentes", "Show active only")}</Link> : <Link href="/gerencia/prioridades?ver=todas">{t("Ver también las cerradas", "Also show closed ones")}</Link>}</p>
      {ger && <section className="card" id="nueva"><b>{t("NUEVA PRIORIDAD", "NEW PRIORITY")}</b>{form(null)}</section>}
    </>
  );
}
