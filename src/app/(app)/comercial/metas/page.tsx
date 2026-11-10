import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { goalBoard } from "@/lib/goals";
import { GOAL_METRICS, GOAL_RULES, METRIC_KEYS, VALUE_KINDS, isClosed, periodBounds, periodOf, shiftPeriod, validPeriod, type Pace, type PaceStatus } from "@/lib/goal-rules";
import { saveTargets } from "./actions";

// Comercial C7 · Goals & Future Creation (v1.1 §37–42, §50). One person and one month at a time.
// Decided C-01 / C-15: the person sees their own goals; Gerencia / Director Comercial pick one person to review
// and set targets. There is no list of people by result and no ranking anywhere on this page.

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ u?: string; p?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const now = new Date();
  const period = sp.p && validPeriod(sp.p) ? sp.p : periodOf(now);
  const people = manage ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const personId = manage && sp.u && people.some((p) => p.id === sp.u) ? sp.u : user.id;
  const person = personId === user.id ? { id: user.id, name: user.name } : people.find((p) => p.id === personId)!;
  const b = await goalBoard(personId, period, now);
  const closed = isClosed(period, now);
  const future = period > periodOf(now);
  const monthName = new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(periodBounds(period).start).replace(/^./, (c) => c.toUpperCase());
  const fmt = (k: keyof typeof GOAL_METRICS, v: number | null) => (v == null ? "—" : GOAL_METRICS[k].unit === "usd" ? i.money(v) : i.n(Math.round(v * 10) / 10));
  const one = new Intl.NumberFormat(i.es ? "es-CO" : "en-US", { maximumFractionDigits: 1 });
  // Counts are whole things: below one a day, the pace reads better per week (5 working days).
  const perDay = (k: keyof typeof GOAL_METRICS, v: number, days: number) => GOAL_METRICS[k].unit === "usd" ? t(`${fmt(k, v)} por día hábil · ${days} días hábiles`, `${fmt(k, v)} per working day · ${days} working days`)
    : v < 1 ? t(`${one.format(v * 5)} por semana · ${days} días hábiles`, `${one.format(v * 5)} per week · ${days} working days`) : t(`${one.format(v)} por día hábil · ${days} días hábiles`, `${one.format(v)} per working day · ${days} working days`);
  const href = (p: string, u = personId) => `/comercial/metas?p=${p}${u !== user.id ? `&u=${u}` : ""}`;
  const own = personId === user.id;

  const statusTxt: Record<PaceStatus, [string, string, string]> = {
    NO_TARGET: ["Sin meta", "No target", "wait"],
    DONE: ["Meta cumplida", "Target met", "ok"],
    AHEAD: ["Adelante del ritmo", "Ahead of pace", "ok"],
    ON_PACE: ["Al ritmo", "On pace", "ok"],
    CLOSE: ["Casi al ritmo", "Nearly on pace", "attn"],
    BEHIND: ["Detrás del ritmo", "Behind pace", "risk"],
    EARLY: ["El mes no empieza", "Month not started", "wait"],
  };
  const okMsg: Record<string, string> = { guardado: t("Metas guardadas. La versión anterior queda en el historial.", "Targets saved. The previous version stays in history."), "sin-cambios": t("No había cambios que guardar.", "There were no changes to save.") };
  const errMsg: Record<string, string> = {
    permiso: t("Solo Gerencia o la Dirección Comercial fijan metas.", "Only Management or the Commercial Director set targets."),
    cerrado: t("Ese mes ya cerró: sus metas no cambian.", "That month is closed: its targets don't change."),
    motivo: t("Estás cambiando una meta ya fijada: escribe por qué, para que la persona lo entienda.", "You're changing a target already set: write why, so the person understands."),
    valor: t("Las metas son números de cero en adelante.", "Targets are numbers from zero up."),
    periodo: t("Mes no válido.", "Invalid month."),
    persona: t("Esa persona no está activa.", "That person isn't active."),
  };

  const Card = ({ k, p }: { k: (typeof METRIC_KEYS)[number]; p: Pace }) => {
    const m = GOAL_METRICS[k];
    const [es, en, tone] = statusTxt[p.status];
    const share = p.target ? Math.min(100, (p.actual / p.target) * 100) : 0;
    const mark = p.target && p.expected != null ? Math.min(100, (p.expected / p.target) * 100) : null;
    const tgt = b.tOf(k);
    return (
      <article className="goal-card" id={`g-${k}`}>
        <header><b>{t(m.es, m.en)}</b><span className="grow" /><span className={`sig ${tone}`}>{t(es, en)}</span></header>
        <div className="goal-num"><b className="tv">{fmt(k, p.actual)}</b><span className="tsub">{p.target ? t(`de ${fmt(k, p.target)}`, `of ${fmt(k, p.target)}`) : t("sin meta fijada", "no target set")}</span></div>
        {k === "ESAGARA_AMOUNT" && <p className="src">{t(`${i.pct(b.extras.esagaraPct)} sobre ventas aceptadas de ${i.money(b.sale)}`, `${i.pct(b.extras.esagaraPct)} on accepted sales of ${i.money(b.sale)}`)}{b.extras.lowEsagaraApproved > 0 ? t(` · ${b.extras.lowEsagaraApproved} con excepción de Eságara baja`, ` · ${b.extras.lowEsagaraApproved} with a low-Eságara exception`) : ""}</p>}
        {k === "DECISIONS_MOVED" && <p className="src">{t(`${b.extras.accepted} aceptadas · ${b.extras.declined} rechazadas`, `${b.extras.accepted} accepted · ${b.extras.declined} declined`)}</p>}
        {k === "SOLUTIONS_PRESENTED" && b.extras.sentWithoutPresenting > 0 && <p className="src">{t(`Aparte: ${b.extras.sentWithoutPresenting} enviadas sin presentar (no cuentan)`, `Separately: ${b.extras.sentWithoutPresenting} sent without presenting (not counted)`)}</p>}
        {p.target != null && (
          <>
            <div className="goal-bar" role="img" aria-label={t(`${Math.round(share)} % de la meta`, `${Math.round(share)} % of target`)}><span style={{ width: `${share}%` }} />{mark != null && <i style={{ left: `${mark}%` }} title={t("Esperado a hoy", "Expected by today")} />}</div>
            <dl className="qv-dl tight">
              {!closed && <><dt>{t("Esperado a hoy", "Expected by today")}</dt><dd className="mono">{fmt(k, p.expected)}</dd></>}
              <dt>{t("Falta", "To go")}</dt><dd className="mono">{fmt(k, p.remaining)}</dd>
              {!closed && p.perDayNeeded != null && <><dt>{t("Ritmo necesario", "Pace needed")}</dt><dd className="mono">{perDay(k, p.perDayNeeded, p.remainingDays)}</dd></>}
              {!closed && p.projection != null && <><dt>{t("Si sigue el ritmo actual", "If the current pace holds")}</dt><dd className="mono">≈ {fmt(k, p.projection)}</dd></>}
            </dl>
          </>
        )}
        {p.target == null && !closed && p.projection != null && <p className="src">{t(`Si sigue el ritmo actual: ≈ ${fmt(k, p.projection)} en el mes`, `If the current pace holds: ≈ ${fmt(k, p.projection)} this month`)}</p>}
        {tgt?.rationale && <p className="src">«{tgt.rationale}» · {tgt.setByName}</p>}
        <p className="src">{t(m.how.es, m.how.en)}</p>
      </article>
    );
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{own ? t("Mis metas del mes", "My goals this month") : t(`Metas de ${person.name}`, `${person.name}'s goals`)}</h1>
          <p>{t("Cinco metas que crean futuro: conversaciones que dejan algo, necesidades nuevas, soluciones presentadas, decisiones del cliente y Eságara. Solo las ves tú y tu gerencia; no hay ranking.", "Five goals that create the future: conversations that leave something, new needs, presented solutions, customer decisions and Eságara. Only you and your managers see them; there's no ranking.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <div className="goal-bar-top">
        <Link className="qa-btn" href={href(shiftPeriod(period, -1))}>← {t("Mes anterior", "Previous month")}</Link>
        <b className="goal-month">{monthName}</b>
        {closed && <span className="sig wait">{t("Cerrado", "Closed")}</span>}
        <Link className="qa-btn" href={href(shiftPeriod(period, 1))}>{t("Mes siguiente", "Next month")} →</Link>
        <span className="grow" />
        {manage && (
          <form method="get" className="goal-pick">
            <input type="hidden" name="p" value={period} />
            <label>{t("Persona", "Person")}
              <select name="u" defaultValue={personId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            <button type="submit" className="secondary">{t("Ver", "View")}</button>
          </form>
        )}
      </div>
      {!future && <p className="src">{t(`Día hábil ${b.paces.VALUE_CONTACTS.elapsedDays} de ${b.paces.VALUE_CONTACTS.totalDays} (lunes a viernes, sin festivos de Colombia). La proyección aparece desde el día hábil ${GOAL_RULES.projectionMinDays}.`, `Working day ${b.paces.VALUE_CONTACTS.elapsedDays} of ${b.paces.VALUE_CONTACTS.totalDays} (Monday to Friday, skipping Colombian holidays). The projection shows from working day ${GOAL_RULES.projectionMinDays}.`)}</p>}

      <div className="goal-grid">{METRIC_KEYS.map((k) => <Card key={k} k={k} p={b.paces[k]} />)}</div>

      <section className="card" id="camino">
        <b>{t("Dónde se estrecha el camino", "Where the path narrows")}</b>
        {b.hints.length === 0 ? <p className="small muted">{b.targets.length === 0 ? t("Cuando haya metas fijadas, aquí aparece en palabras simples dónde se frena el avance.", "Once targets are set, this says in plain words where progress slows down.") : t("Nada se está frenando por ahora.", "Nothing is slowing down for now.")}</p> : <ul className="mk-ul">{b.hints.map((h) => <li key={h.key}>{t(h.es, h.en)}</li>)}</ul>}
      </section>

      <section className="card" id="contactos">
        <b>{t("Qué dejaron los contactos útiles", "What the useful contacts left")}</b>
        {Object.keys(b.byKind).length === 0 ? <p className="small muted">{t("Aún no hay contactos marcados como útiles este mes. Al registrar una llamada, correo o reunión, marca qué dejó.", "No contacts marked useful this month yet. When you log a call, email or meeting, mark what it left.")}</p> : (
          <ul className="goal-kinds">{Object.entries(VALUE_KINDS).filter(([k]) => b.byKind[k]).map(([k, v]) => <li key={k}><b>{b.byKind[k]}</b> {t(v.es, v.en)}</li>)}</ul>
        )}
      </section>

      {manage && (
        <section className="card" id="fijar">
          <b>{t(`Fijar metas de ${person.name} · ${monthName}`, `Set ${person.name}'s targets · ${monthName}`)}</b>
          {closed ? <p className="small muted">{t("Este mes ya cerró: sus metas quedan como estaban.", "This month is closed: its targets stay as they were.")}</p> : (
            <form action={saveTargets.bind(null, personId, period)} className="qa-form" style={{ maxWidth: 620 }}>
              {METRIC_KEYS.map((k) => (
                <label key={k}>{t(GOAL_METRICS[k].es, GOAL_METRICS[k].en)}{GOAL_METRICS[k].unit === "usd" ? " (USD)" : ""}
                  <input name={k} type="number" min={0} step={GOAL_METRICS[k].unit === "usd" ? "0.01" : "1"} defaultValue={b.tOf(k) ? Number(b.tOf(k)!.target) : ""} />
                </label>
              ))}
              <label>{t("Por qué estas metas (obligatorio si cambias una ya fijada)", "Why these targets (required when changing one already set)")}<textarea name="rationale" rows={2} maxLength={500} /></label>
              <button type="submit">{t("Guardar metas", "Save targets")}</button>
              <span className="src block">{t("Vacío o cero = sin meta. Cada cambio guarda una versión nueva.", "Empty or zero = no target. Each change saves a new version.")}</span>
            </form>
          )}
          {b.history.length > 0 && (
            <details style={{ marginTop: 10 }}><summary className="small">{t("Versiones anteriores", "Previous versions")}</summary>
              <ul className="mk-ul small">{b.history.map((h) => <li key={h.id}>{t(GOAL_METRICS[h.metric as keyof typeof GOAL_METRICS]?.es ?? h.metric, GOAL_METRICS[h.metric as keyof typeof GOAL_METRICS]?.en ?? h.metric)} v{h.version}: {fmt(h.metric as keyof typeof GOAL_METRICS, Number(h.target))} · {h.setByName} · {i.day(h.createdAt)}{h.rationale ? ` · «${h.rationale}»` : ""}</li>)}</ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
