import Link from "next/link";
import { budgetGoalsOf } from "@/lib/sales-budget-goals";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { goalBoard } from "@/lib/goals";
import { GOAL_METRICS, GOAL_RULES, METRIC_KEYS, VALUE_KINDS, isClosed, periodBounds, periodOf, shiftPeriod, validPeriod, type Pace, type PaceStatus } from "@/lib/goal-rules";
import { saveBatTargets, saveCompanyGoals, saveRecipe, saveTargets } from "./actions";
import { recipeActuals, recipeFor } from "@/lib/goal-recipe-data";
import { recipeOf } from "@/lib/goal-recipe";
import { BAT_KEYS, findCompanies, loadBatting } from "@/lib/batting";
import Recetario from "./Recetario";
import Bateo, { type BatTarget } from "./Bateo";
import { Desarrollo, Marcador, MetasEmpresa, type PaceLine } from "./Coach";
import { coverOf, diagnose, loadCoach } from "@/lib/batting-coach";
import { monthOf } from "@/lib/customer-stats";
import { paceOf } from "@/lib/goal-rules";

// Comercial C7 · Goals & Future Creation (v1.1 §37–42, §50). One person and one month at a time.
// Decided C-01 / C-15: the person sees their own goals; Gerencia / Director Comercial pick one person to review
// and set targets. There is no list of people by result and no ranking anywhere on this page.

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ u?: string; p?: string; ok?: string; err?: string; q?: string; c?: string }> }) {
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
  // Tabla de bateo: the company comes from the link of a chosen match (?c=) or from the text searched (?q=).
  const q = (sp.q ?? "").trim().slice(0, 80);
  const picked = sp.c ? await db.account.findUnique({ where: { id: sp.c }, select: { id: true, name: true } }) : null;
  const matches = !picked && q ? await findCompanies(q) : null;
  const company = picked ?? (matches?.length === 1 ? matches[0] : null);
  const [b, recipe, ra, bat] = await Promise.all([goalBoard(personId, period, now), recipeFor(personId, period), recipeActuals(personId, period, now), loadBatting(personId, period, company?.id ?? null)]);
  const coach = await loadCoach(personId, period, company?.id ?? null);
  // The companies this person has Needs with: the list offered at the top to narrow the batting table.
  const mine = await db.deal.findMany({ where: { ownerId: personId, internal: false }, distinct: ["accountId"], select: { account: { select: { id: true, name: true } } } });
  const companies = mine.map((d) => d.account).filter((a): a is { id: string; name: string } => !!a).sort((a, b) => a.name.localeCompare(b.name, "es"));
  if (company && !companies.some((a) => a.id === company.id)) companies.unshift(company);
  const closed = isClosed(period, now);
  const future = period > periodOf(now);
  const monthName = new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(periodBounds(period).start).replace(/^./, (c) => c.toUpperCase());
  const fmt = (k: keyof typeof GOAL_METRICS, v: number | null) => (v == null ? "—" : GOAL_METRICS[k].unit === "usd" ? i.money(v) : i.n(Math.round(v * 10) / 10));
  const one = new Intl.NumberFormat(i.es ? "es-CO" : "en-US", { maximumFractionDigits: 1 });
  // Counts are whole things: below one a day, the pace reads better per week (5 working days).
  const perDay = (k: keyof typeof GOAL_METRICS, v: number, days: number) => GOAL_METRICS[k].unit === "usd" ? t(`${fmt(k, v)} por día hábil · ${days} días hábiles`, `${fmt(k, v)} per working day · ${days} working days`)
    : v < 1 ? t(`${one.format(v * 5)} por semana · ${days} días hábiles`, `${one.format(v * 5)} per week · ${days} working days`) : t(`${one.format(v)} por día hábil · ${days} días hábiles`, `${one.format(v)} per working day · ${days} working days`);
  const href = (p: string, u = personId) => `/comercial/metas?p=${p}${u !== user.id ? `&u=${u}` : ""}${company ? `&c=${company.id}` : ""}`;
  const own = personId === user.id;
  // Goals of the batting table: the ones typed; without them, quotes and orders come from the month's recipe.
  const rec = recipe ? recipeOf({ salesGoal: Number(recipe.salesGoal), avgSale: Number(recipe.avgSale), quotesPerClose: recipe.quotesPerClose, meetingsPerQuote: recipe.meetingsPerQuote, pitchesPerMeeting: recipe.pitchesPerMeeting, activitiesPerPitch: recipe.activitiesPerPitch }, b.paces.VALUE_CONTACTS.totalDays) : null;
  const fromRecipe: Partial<Record<string, number>> = rec ? { BAT_QUOTE_N: rec.quotes, BAT_PO_N: rec.closes, BAT_PO_USD: rec.salesGoal } : {};
  const batTargets: Partial<Record<string, BatTarget>> = {};
  // The Eságara row takes the month's «Eságara ganada» goal, set by management below.
  const esaGoal = b.tOf("ESAGARA_AMOUNT");
  if (esaGoal) batTargets.BAT_ESAGARA = { value: Number(esaGoal.target), fromRecipe: false };
  // The approved commercial budget of the month (pesos; turned into dollars at today's TRM) comes before the goals
  // per company and the recipe, and after what the person typed.
  const fromBudget = company ? null : await budgetGoalsOf(personId, period, now);
  for (const k of BAT_KEYS) {
    const typed = b.targets.find((x) => x.metric === k);
    const bg = fromBudget?.[k as "BAT_PO_USD" | "BAT_PO_N" | "BAT_QUOTE_N" | "BAT_REQ_N"];
    if (typed) batTargets[k] = { value: Number(typed.target), fromRecipe: false };
    else if (bg) batTargets[k] = { value: bg.value, fromRecipe: false, fromBudget: k === "BAT_PO_USD" ? t(`del presupuesto comercial aprobado: $ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(bg.cop / 1e6)} M a la TRM de hoy (${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(bg.rate)})`, `from the approved commercial budget: $ ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(bg.cop / 1e6)} M at today's TRM (${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(bg.rate)})`) : t("del presupuesto comercial aprobado", "from the approved commercial budget") };
    else if (k === "BAT_PO_USD" && coach.companies?.total) batTargets[k] = { value: coach.companies.total, fromRecipe: false, fromCompanies: true };
    else if (k === "BAT_REQ_N" && coach.companies?.reqTotal) batTargets[k] = { value: coach.companies.reqTotal, fromRecipe: false, fromCompanies: true };
    else if (k === "BAT_QUOTE_N" && coach.companies?.quoTotal) batTargets[k] = { value: coach.companies.quoTotal, fromRecipe: false, fromCompanies: true };
    else if (fromRecipe[k]) batTargets[k] = { value: fromRecipe[k]!, fromRecipe: true };
  }

  const statusTxt: Record<PaceStatus, [string, string, string]> = {
    NO_TARGET: ["Sin meta", "No target", "wait"],
    DONE: ["Meta cumplida", "Target met", "ok"],
    AHEAD: ["Adelante del ritmo", "Ahead of pace", "ok"],
    ON_PACE: ["Al ritmo", "On pace", "ok"],
    CLOSE: ["Casi al ritmo", "Nearly on pace", "attn"],
    BEHIND: ["Detrás del ritmo", "Behind pace", "risk"],
    EARLY: ["El mes no empieza", "Month not started", "wait"],
  };
  // Scoreboard: coverage, required pace and diagnosis use the effective goals above.
  const typedPo = b.targets.find((x) => x.metric === "BAT_PO_USD");
  const typedOf = (k: string) => { const g = b.targets.find((x) => x.metric === k); return g ? Number(g.target) : null; };
  const isCurrent = period === monthOf(now) && !company;
  const cover = coverOf(batTargets.BAT_PO_USD?.value ?? null, bat.lines.BAT_PO_USD.actual, coach.pipeline);
  const days = b.paces.VALUE_CONTACTS;
  const paces: PaceLine[] = ([["BAT_PO_USD", "Órdenes de compra (valor)", "Purchase orders (value)", "usd"], ["BAT_PO_N", "Órdenes de compra (número)", "Purchase orders (number)", "n"], ["BAT_ESAGARA", "Eságara", "Eságara", "usd"]] as const)
    .filter(([k]) => batTargets[k]).map(([k, es, en, unit]) => { const pc = paceOf(batTargets[k]!.value, bat.lines[k].actual, period, now); return { k, es, en, unit, remaining: pc.remaining ?? 0, perDay: pc.perDayNeeded, days: pc.remainingDays }; });
  const goalValues = Object.fromEntries(Object.entries(batTargets).map(([k, g]) => [k, g!.value]));
  const findings = diagnose({ bat, coach, cover, goals: goalValues, share: days.totalDays ? Math.min(1, days.elapsedDays / days.totalDays) : 1, money: (x) => i.money(x) });
  const okMsg: Record<string, string> = { empresas: t("Metas por empresa guardadas.", "Goals per company saved."), desarrollo: t("Metas de desarrollo guardadas.", "Development goals saved."), bateo: t("Metas de la tabla de bateo guardadas.", "Batting table goals saved."), recetario: t("Recetario guardado.", "Recipe saved."), guardado: t("Metas guardadas. La versión anterior queda en el historial.", "Targets saved. The previous version stays in history."), "sin-cambios": t("No había cambios que guardar.", "There were no changes to save.") };
  const errMsg: Record<string, string> = {
    permiso: t("Solo Gerencia o la Dirección Comercial fijan metas.", "Only Management or the Commercial Director set targets."),
    cerrado: t("Ese mes ya cerró: sus metas no cambian.", "That month is closed: its targets don't change."),
    motivo: t("Estás cambiando una meta ya fijada: escribe por qué, para que la persona lo entienda.", "You're changing a target already set: write why, so the person understands."),
    valor: t("Las metas son números de cero en adelante.", "Targets are numbers from zero up."),
    periodo: t("Mes no válido.", "Invalid month."),
    persona: t("Esa persona no está activa.", "That person isn't active."),
    "permiso-recetario": t("El recetario lo escribe la propia persona, Gerencia, Administración o la Dirección Comercial.", "The recipe is written by the person, Management, Administration or the Commercial Director."),
    "permiso-bateo": t("Las metas de la tabla de bateo las escribe la propia persona, Gerencia o la Dirección Comercial.", "The batting table goals are written by the person, Management or the Commercial Director."),
    "bateo-valor": t("Las metas de la tabla son números de cero en adelante; las de cantidad (#), enteros.", "The table goals are numbers from zero up; the count ones (#), whole numbers."),
    "recetario-valor": t("Escribe la meta de ventas y el valor de tu venta promedio, mayores que cero.", "Type the sales goal and your average sale, above zero."),
    "recetario-proporcion": t("Cada proporción es un número entero de 1 a 50.", "Each ratio is a whole number from 1 to 50."),
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
        <a className="qa-btn" href="#marcador">{t("Mi marcador ↓", "My scoreboard ↓")}</a>
        <a className="qa-btn" href="#bateo">{t("Tabla de bateo ↓", "Batting table ↓")}</a>
        <a className="qa-btn" href="#empresas">{t("Metas por empresa ↓", "Goals per company ↓")}</a>
        <span className="grow" />
        <form method="get" action="/comercial/metas#bateo" className="goal-pick" id="empresa">
          <input type="hidden" name="p" value={period} />
          {personId !== user.id && <input type="hidden" name="u" value={personId} />}
          <label>{t("Empresa", "Company")}
            <select name="c" defaultValue={company?.id ?? ""} key={company?.id ?? "all"}>
              <option value="">{t("Todas las empresas", "All companies")}</option>
              {companies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <button type="submit" className="secondary">{t("Ver empresa", "View company")}</button>
        </form>
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

      <Recetario es={i.es} name={person.name} workdays={b.paces.VALUE_CONTACTS.totalDays} closed={closed} canEdit={own || manage}
        saved={recipe ? { salesGoal: Number(recipe.salesGoal), avgSale: Number(recipe.avgSale), quotesPerClose: recipe.quotesPerClose, meetingsPerQuote: recipe.meetingsPerQuote, pitchesPerMeeting: recipe.pitchesPerMeeting, activitiesPerPitch: recipe.activitiesPerPitch } : null}
        savedBy={recipe?.setByName ?? null} actual={future ? {} : ra.actual} avg12={ra.avg12} action={saveRecipe.bind(null, personId, period)} key={`${personId}-${period}-${recipe?.updatedAt.getTime() ?? 0}`} />

      {!company && <Marcador i={i} name={person.name} bat={bat} coach={coach} goals={batTargets} cover={cover} paces={paces} findings={findings} future={future} isCurrent={isCurrent} />}

      <Bateo i={i} name={person.name} bat={bat} coach={coach} days={{ elapsed: days.elapsedDays, total: days.totalDays, min: GOAL_RULES.projectionMinDays }} targets={batTargets} company={company} matches={matches} q={q} future={future} closed={closed} canEdit={own || manage}
        action={saveBatTargets.bind(null, personId, period)} baseHref={`/comercial/metas?p=${period}${own ? "" : `&u=${personId}`}`} hidden={{ p: period, ...(own ? {} : { u: personId }) }}
        statsHref={company ? `/accounts/${company.id}/estadisticas` : null} />

      {!company && <MetasEmpresa i={i} name={person.name} coach={coach} typed={{ po: typedPo ? Number(typedPo.target) : null, req: typedOf("BAT_REQ_N"), quo: typedOf("BAT_QUOTE_N") }} future={future} closed={closed} canEdit={own || manage} action={saveCompanyGoals.bind(null, personId, period)} statsBase={`/comercial/metas?p=${period}${own ? "" : `&u=${personId}`}`} />}
      {!company && <Desarrollo i={i} name={person.name} coach={coach} goals={batTargets} future={future} closed={closed} canEdit={own || manage} action={saveBatTargets.bind(null, personId, period)} />}

      <div className="goal-grid">{METRIC_KEYS.map((k) => <Card key={k} k={k} p={b.paces[k]} />)}</div>

      <section className="card" id="camino">
        <b>{t("Dónde se estrecha el camino", "Where the path narrows")}</b>
        {b.hints.length === 0 ? <p className="small muted">{b.targets.length === 0 ? t("Cuando haya metas fijadas, aquí aparece en palabras simples dónde se frena el avance.", "Once targets are set, this says in plain words where progress slows down.") : t("Nada se está frenando por ahora.", "Nothing is slowing down for now.")}</p> : <ul className="mk-ul">{b.hints.map((h) => <li key={h.key}>{t(h.es, h.en)}</li>)}</ul>}
      </section>

      <section className="card" id="contactos">
        <b>{t("Qué dejaron los contactos útiles", "What the useful contacts left")}</b>
        {Object.keys(b.byKind).length === 0 ? <p className="small muted">{t("Aún no hay contactos marcados como útiles este mes. Al registrar una llamada, correo o reunión, marca qué dejó.", "No contacts marked useful this month yet. When you log a call, email or meeting, mark what it left.")} <Link href="/comercial/comunicaciones">{t("Registrar un contacto", "Record a contact")} →</Link></p> : (
          <ul className="goal-kinds">{Object.entries(VALUE_KINDS).filter(([k]) => b.byKind[k]).map(([k, v]) => <li key={k}><b>{b.byKind[k]}</b> {t(v.es, v.en)}</li>)}</ul>
        )}
      </section>

      {manage && (
        <section className="card" id="fijar">
          <b>{t(`Fijar metas de ${person.name} · ${monthName}`, `Set ${person.name}'s targets · ${monthName}`)}</b>
          {closed ? <p className="small muted">{t("Este mes ya cerró: sus metas quedan como estaban.", "This month is closed: its targets stay as they were.")}</p> : (
            <form action={saveTargets.bind(null, personId, period)} className="qa-form cols" style={{ maxWidth: 980 }}>
              {METRIC_KEYS.map((k) => (
                <label key={k}>{t(GOAL_METRICS[k].es, GOAL_METRICS[k].en)}{GOAL_METRICS[k].unit === "usd" ? " (USD)" : ""}
                  <input name={k} type="number" min={0} step={GOAL_METRICS[k].unit === "usd" ? "0.01" : "1"} defaultValue={b.tOf(k) ? Number(b.tOf(k)!.target) : ""} />
                </label>
              ))}
              <label className="wide">{t("Por qué estas metas (obligatorio si cambias una ya fijada)", "Why these targets (required when changing one already set)")}<textarea name="rationale" rows={2} maxLength={500} /></label>
              <button type="submit">{t("Guardar metas", "Save targets")}</button>
              <span className="src block wide">{t("Vacío o cero = sin meta. Cada cambio guarda una versión nueva.", "Empty or zero = no target. Each change saves a new version.")}</span>
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
