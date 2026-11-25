import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll, canOrganizeGoals, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { sumMoney } from "@/lib/money";
import { isClosed, paceOf, periodBounds, periodOf, shiftPeriod, validPeriod } from "@/lib/goal-rules";
import { recipeOf, shortMoney } from "@/lib/goal-recipe";
import { recipeActuals } from "@/lib/goal-recipe-data";
import { ACC_PREFIX } from "@/lib/batting-coach";
import Recetario from "../../comercial/metas/Recetario";
import { saveTeamRecipe } from "../../comercial/metas/actions";

// EQUIPO → Mi equipo → Organizar metas del equipo (owner, 2026-11-25: "el recetario mensual de cada empleado puede ser
// editado por gerencia y administración, la opción para hacerlo debería estar en equipo"). One row per person with
// the month's recipe; "Escribir / Cambiar recetario" opens that person's recipe on this same page.

export default async function TeamGoalsPage({ searchParams }: { searchParams: Promise<{ u?: string; p?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  if (!canOrganizeGoals(user)) redirect("/equipo/mi-rol");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const now = new Date();
  const period = sp.p && validPeriod(sp.p) ? sp.p : periodOf(now);
  const { start, end } = periodBounds(period);
  const closed = isClosed(period, now);
  const future = period > periodOf(now);
  const workdays = paceOf(null, 0, period, now).totalDays;
  const monthName = new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(start).replace(/^./, (c) => c.toUpperCase());

  const [people, recipes, accepted, accGoals] = await Promise.all([
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    db.goalRecipe.findMany({ where: { period } }),
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: { gte: start, lt: end }, deal: { internal: false } }, select: { protSale: true, deal: { select: { ownerId: true } } } }),
    // Metas por empresa: each person's customer goals add up to their goal, and everyone's to the team's.
    db.goalTarget.findMany({ where: { period, supersededAt: null, metric: { startsWith: ACC_PREFIX } }, select: { userId: true, target: true } }),
  ]);
  const byCompanies = (id: string) => { const xs = accGoals.filter((g) => g.userId === id); return xs.length ? sumMoney(xs.map((g) => g.target)) : null; };
  const recipeBy = new Map(recipes.map((r) => [r.userId, r]));
  const input = (r: (typeof recipes)[number]) => ({ salesGoal: Number(r.salesGoal), avgSale: Number(r.avgSale), quotesPerClose: r.quotesPerClose, meetingsPerQuote: r.meetingsPerQuote, pitchesPerMeeting: r.pitchesPerMeeting, activitiesPerPitch: r.activitiesPerPitch });
  const soldBy = (id: string) => sumMoney(accepted.filter((q) => q.deal.ownerId === id).map((q) => q.protSale));
  const person = sp.u ? people.find((p) => p.id === sp.u) ?? null : null;
  const picked = person ? recipeBy.get(person.id) ?? null : null;
  const ra = person ? await recipeActuals(person.id, period, now) : null;
  const href = (p: string, u?: string) => `/equipo/metas?p=${p}${u ? `&u=${u}#recetario` : ""}`;
  const withRecipe = people.filter((p) => recipeBy.has(p.id)).length;
  const n0 = new Intl.NumberFormat(i.es ? "es-CO" : "en-US", { maximumFractionDigits: 0 });

  const okMsg: Record<string, string> = { recetario: t("Recetario guardado.", "Recipe saved.") };
  const errMsg: Record<string, string> = {
    cerrado: t("Ese mes ya cerró: su recetario no cambia.", "That month is closed: its recipe doesn't change."),
    periodo: t("Mes no válido.", "Invalid month."),
    persona: t("Esa persona no está activa.", "That person isn't active."),
    "permiso-recetario": t("El recetario de otra persona lo escriben Gerencia, Administración o la Dirección Comercial.", "Another person's recipe is written by Management, Administration or the Commercial Director."),
    "recetario-valor": t("Escribe la meta de ventas y el valor de la venta promedio, mayores que cero.", "Type the sales goal and the average sale, above zero."),
    "recetario-proporcion": t("Cada proporción es un número entero de 1 a 50.", "Each ratio is a whole number from 1 to 50."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Organizar metas del equipo", "Organise team goals")}</h1>
        <p>{t("El recetario mensual de cada persona: su meta de ventas y lo que necesita hacer para llegar. Aquí lo escribes o lo cambias por ella.", "Each person's monthly recipe: their sales goal and what they need to do to reach it. Here you write it or change it for them.")}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <div className="goal-bar-top">
        <Link className="qa-btn" href={href(shiftPeriod(period, -1), person?.id)}>← {t("Mes anterior", "Previous month")}</Link>
        <b className="goal-month">{monthName}</b>
        {closed && <span className="sig wait">{t("Cerrado", "Closed")}</span>}
        <Link className="qa-btn" href={href(shiftPeriod(period, 1), person?.id)}>{t("Mes siguiente", "Next month")} →</Link>
        <span className="grow" />
        <span className="src">{t(`${withRecipe} de ${people.length} personas tienen recetario este mes`, `${withRecipe} of ${people.length} people have a recipe this month`)}</span>
      </div>

      {person && (
        <>
          <Recetario es={i.es} name={person.name} workdays={workdays} closed={closed} canEdit forOther={person.id !== user.id}
            saved={picked ? input(picked) : null} savedBy={picked?.setByName ?? null} actual={future ? {} : ra!.actual} avg12={ra!.avg12}
            action={saveTeamRecipe.bind(null, person.id, period)} key={`${person.id}-${period}-${picked?.updatedAt.getTime() ?? 0}`} />
          <p className="src" style={{ marginTop: -6 }}>
            <Link href={`/equipo/metas?p=${period}#personas`}>← {t("Volver a la lista del equipo", "Back to the team list")}</Link>
            {canManageAll(user) && <> · <Link href={`/comercial/metas?p=${period}&u=${person.id}`}>{t(`Ver todas las metas de ${person.name}`, `See all of ${person.name}'s goals`)} →</Link></>}
          </p>
        </>
      )}

      <section className="card" id="personas">
        <b>{t("RECETARIO DE CADA PERSONA", "EACH PERSON'S RECIPE")}</b> · {monthName}
        <div className="tscroll"><table>
          <thead><tr>
            <th>{t("Persona", "Person")}</th>
            <th className="n">{t("Meta de ventas", "Sales goal")}</th>
            <th className="n">{t("Suma de metas por empresa", "Sum of goals per company")}</th>
            <th className="n">{t("Lleva", "So far")}</th>
            <th className="n">{t("Venta promedio", "Average sale")}</th>
            <th className="n">{t("Negocios", "Deals")}</th>
            <th className="n">{t("Cotizaciones", "Quotes")}</th>
            <th className="n">{t("Actividades por día", "Activities per day")}</th>
            <th>{t("Guardado por", "Saved by")}</th>
            <th />
          </tr></thead>
          <tbody>
            {people.map((p) => {
              const r = recipeBy.get(p.id);
              const calc = r ? recipeOf(input(r), workdays) : null;
              const sold = future ? null : soldBy(p.id);
              const co = byCompanies(p.id);
              const coCell = <td className="n mono" data-co>{co == null ? "—" : canManageAll(user) ? <Link href={`/comercial/metas?p=${period}&u=${p.id}#empresas`} title={`USD ${n0.format(co)}`}>{shortMoney(co)}</Link> : <span title={`USD ${n0.format(co)}`}>{shortMoney(co)}</span>}</td>;
              return (
                <tr key={p.id} data-u={p.id} className={person?.id === p.id ? "on" : undefined}>
                  <td><b>{p.name}</b><span className="src block">{t(ROLE_LABEL[p.role].es, ROLE_LABEL[p.role].en)}</span></td>
                  {calc ? (
                    <>
                      <td className="n mono" title={`USD ${n0.format(calc.salesGoal)}`}>{shortMoney(calc.salesGoal)}</td>
                      {coCell}
                      <td className="n mono">{sold == null ? "—" : shortMoney(sold)}</td>
                      <td className="n mono">{shortMoney(calc.avgSale)}</td>
                      <td className="n mono">{n0.format(calc.closes)}</td>
                      <td className="n mono">{n0.format(calc.quotes)}</td>
                      <td className="n mono">{n0.format(calc.daily)}</td>
                      <td className="small">{r!.setByName}</td>
                    </>
                  ) : (
                    <>
                      <td className="n"><span className="sig wait">{t("Sin recetario", "No recipe")}</span></td>
                      {coCell}
                      <td className="n mono">{sold == null ? "—" : shortMoney(sold)}</td>
                      <td colSpan={5} />
                    </>
                  )}
                  <td>{closed ? (r ? <Link href={href(period, p.id)}>{t("Ver recetario", "View recipe")}</Link> : null) : <Link className="qa-btn" href={href(period, p.id)}>{r ? t("Cambiar recetario", "Change recipe") : t("Escribir recetario", "Write recipe")}</Link>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr data-total>
            <td><b>{t("Total del equipo", "Team total")}</b></td>
            <td className="n mono"><b>{shortMoney(sumMoney(recipes.filter((r) => people.some((p) => p.id === r.userId)).map((r) => r.salesGoal)))}</b></td>
            <td className="n mono"><b>{accGoals.some((g) => people.some((p) => p.id === g.userId)) ? shortMoney(sumMoney(accGoals.filter((g) => people.some((p) => p.id === g.userId)).map((g) => g.target))) : "—"}</b></td>
            <td className="n mono"><b>{future ? "—" : shortMoney(sumMoney(accepted.filter((q) => people.some((p) => p.id === q.deal.ownerId)).map((q) => q.protSale)))}</b></td>
            <td colSpan={6} />
          </tr></tfoot>
        </table></div>
        <p className="src">{t("«Lleva» son las cotizaciones aceptadas en el mes, en las Necesidades que la persona lleva. «Suma de metas por empresa» es lo que cada persona fijó cliente por cliente en COMERCIAL → Mis metas → METAS POR EMPRESA (solo Gerencia y Dirección Comercial pueden abrir ese enlace); la suma de todos es la meta del equipo. Negocios, cotizaciones y actividades por día salen del recetario. Cada persona también puede escribir el suyo en COMERCIAL → Mis metas. Un mes que ya cerró no se cambia.", "«So far» is the quotes accepted this month on the Needs the person carries. «Sum of goals per company» is what each person set customer by customer in COMERCIAL → Mis metas → GOALS PER COMPANY (only Management and the Commercial Director can open that link); everyone's sum is the team's goal. Deals, quotes and activities per day come from the recipe. Each person can also write their own in COMERCIAL → Mis metas. A month already closed doesn't change.")}</p>
      </section>
    </div>
  );
}
