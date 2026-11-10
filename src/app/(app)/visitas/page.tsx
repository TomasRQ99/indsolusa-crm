import Link from "next/link";
import { isMoneyRole } from "@/lib/permissions";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today, addDays } from "@/lib/domain";
import { OBJECTIVE_CATS, VISIT_STATUS, readObjectives } from "@/lib/visits";
import { createMission, createVisit } from "./actions";
import { BUDGET_STATUS, EXPENSES_STATUS, canDecideBudget, canReconcile } from "@/lib/travel-rules";

// Comercial C8a · Visits & Commercial Missions (v1.3 §57): my upcoming visits, what's still owed from past visits,
// and missions (trips grouping several visits). Travel budget and expenses wait for Administration (Module 14).

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; cliente?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const now = today();
  const [upcoming, recent, owed, missions, accounts] = await Promise.all([
    db.visitPlan.findMany({ where: { ownerId: user.id, status: "PLANNED" }, orderBy: { plannedAt: "asc" }, include: { account: { select: { id: true, name: true } }, mission: { select: { title: true } } } }),
    db.visitPlan.findMany({ where: { ownerId: user.id, status: { not: "PLANNED" }, updatedAt: { gte: addDays(now, -60) } }, orderBy: { updatedAt: "desc" }, take: 15, include: { account: { select: { id: true, name: true } } } }),
    db.visitCommitment.findMany({ where: { status: "OPEN", visit: { ownerId: user.id } }, orderBy: { dueAt: "asc" }, include: { visit: { select: { id: true, account: { select: { name: true } } } } } }),
    db.commercialMission.findMany({ where: { ownerId: user.id, endDate: { gte: addDays(now, -30) } }, orderBy: { startDate: "asc" }, include: { visits: { select: { id: true, status: true, account: { select: { name: true } } } } } }),
    db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  // Travel money waiting for this person: budgets to decide, expenses to check (never their own).
  const pending = user.role === "GERENCIA" || isMoneyRole(user.role) ? await db.commercialMission.findMany({ where: { ownerId: { not: user.id }, OR: [{ budgetStatus: "REQUESTED" }, { expensesStatus: "SUBMITTED" }] }, orderBy: { startDate: "asc" }, select: { id: true, title: true, destination: true, startDate: true, budgetStatus: true, budgetAmount: true, expensesStatus: true, ownerId: true, owner: { select: { name: true, role: true } } } }) : [];
  const toDecide = pending.filter((m) => m.budgetStatus === "REQUESTED" && canDecideBudget(user, { ownerId: m.ownerId, ownerRole: m.owner.role }));
  const toCheck = pending.filter((m) => m.expensesStatus === "SUBMITTED" && canReconcile(user, { ownerId: m.ownerId, ownerRole: m.owner.role }));
  const okMsg: Record<string, string> = { mision: t("Misión creada.", "Mission created.") };
  const errMsg: Record<string, string> = {
    cliente: t("Elige el cliente.", "Pick the customer."), fecha: t("Indica la fecha de la visita.", "Give the visit date."),
    objetivo: t("Marca al menos un objetivo: una visita sin objetivo es solo un viaje.", "Tick at least one objective: a visit without one is just a trip."),
    mision: t("La misión necesita título, destino, propósito y fechas.", "The mission needs a title, destination, purpose and dates."), fechas: t("La misión termina antes de empezar.", "The mission ends before it starts."),
    visita: t("Esa visita no existe.", "That visit doesn't exist."), "mision-no": t("Esa misión no existe.", "That mission doesn't exist."), monto: t("Para pedir presupuesto, indica el monto estimado.", "To request a budget, give the estimated amount."), compromiso: t("Ese compromiso no existe.", "That commitment doesn't exist."),
  };
  const late = (d: Date | null) => !!d && d < now;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Visitas y misiones", "Visits and missions")}</h1>
          <p>{t("Cada visita tiene un objetivo, llega con el contexto que SOLU ya conoce y termina con lo aprendido, los compromisos y el próximo paso.", "Every visit has an objective, arrives with the context SOLU already knows, and ends with what was learned, the commitments and the next step.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {(toDecide.length > 0 || toCheck.length > 0) && (
        <section className="card" id="viajes">
          <b>{t("Dinero de viajes esperando tu decisión", "Travel money waiting for your decision")}</b>
          <ul className="mk-ul">
            {toDecide.map((m) => <li key={`d-${m.id}`}><span className="sig attn">{t("Presupuesto", "Budget")}</span> <Link href={`/visitas/mision/${m.id}#presupuesto`}>{m.title}</Link> · {m.owner.name} · {m.destination} · <span className="mono">{m.budgetAmount != null ? i.money2(m.budgetAmount) : "—"}</span> · {i.day(m.startDate)}</li>)}
            {toCheck.map((m) => <li key={`c-${m.id}`}><span className="sig attn">{t("Gastos", "Expenses")}</span> <Link href={`/visitas/mision/${m.id}#gastos`}>{m.title}</Link> · {m.owner.name} · {m.destination}</li>)}
          </ul>
        </section>
      )}

      <section className="card" id="proximas">
        <div className="jbh"><b>{t("Próximas visitas", "Upcoming visits")}</b><span className="grow" />
          <details className="qa" open={!!sp.cliente || sp.err === "objetivo" || sp.err === "fecha" || sp.err === "cliente"}><summary className="qa-btn">{t("+ Planear visita", "+ Plan visit")}</summary>
            <div className="qa-pop wide right">
              <form action={createVisit} className="qa-form">
                <label>{t("Cliente", "Customer")}<select name="accountId" required defaultValue={sp.cliente ?? ""}><option value="" disabled>{t("Elige…", "Choose…")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                <div className="qa-row">
                  <label>{t("Fecha", "Date")}<input name="plannedAt" type="date" defaultValue={dayInput(addDays(now, 1))} /></label>
                  <label className="chk"><input type="checkbox" name="unplanned" value="1" /> {t("Ya la hice sin planearla (hoy)", "I already did it unplanned (today)")}</label>
                </div>
                <label>{t("Con quién (opcional)", "With whom (optional)")}<input name="meetWith" maxLength={300} placeholder={t("Ej.: Juan, jefe de mantenimiento", "E.g.: Juan, maintenance lead")} /></label>
                <b className="small">{t("¿Para qué vas?", "What are you going for?")}</b>
                {Object.entries(OBJECTIVE_CATS).map(([k, c]) => (
                  <div key={k} className="qa-row">
                    <label className="chk" style={{ flex: "0 0 170px" }}><input type="checkbox" name={`obj_${k}`} value="1" /> {t(c.es, c.en)}</label>
                    <input name={`objtext_${k}`} maxLength={300} placeholder={t("Qué quieres lograr", "What you want to achieve")} aria-label={t(c.es, c.en)} />
                  </div>
                ))}
                {missions.length > 0 && <label>{t("Parte de la misión (opcional)", "Part of mission (optional)")}<select name="missionId" defaultValue=""><option value="">—</option>{missions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
                <button type="submit">{t("Planear", "Plan")}</button>
              </form>
            </div>
          </details>
        </div>
        {upcoming.length === 0 ? <p className="small muted">{t("No tienes visitas planeadas.", "You have no planned visits.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Fecha", "Date")}</th><th>{t("Cliente", "Customer")}</th><th>{t("Objetivos", "Objectives")}</th><th>{t("Misión", "Mission")}</th></tr></thead>
            <tbody>{upcoming.map((v) => (
              <tr key={v.id}>
                <td className="mono">{i.dateShort(v.plannedAt)}{late(v.plannedAt) && <span className="sig attn" style={{ marginLeft: 6 }}>{t("sin cerrar", "not closed")}</span>}</td>
                <td><Link href={`/visitas/${v.id}`}>{v.account.name}</Link></td>
                <td className="small">{readObjectives(v.objectives).map((o) => t(OBJECTIVE_CATS[o.cat].es, OBJECTIVE_CATS[o.cat].en)).join(" · ")}</td>
                <td className="small">{v.mission?.title ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="compromisos">
        <b>{t("Compromisos abiertos de visitas", "Open commitments from visits")}</b>
        {owed.length === 0 ? <p className="small muted">{t("Nada pendiente.", "Nothing pending.")}</p> : (
          <ul className="mk-ul">{owed.map((c) => <li key={c.id}><span className={`sig ${c.side === "US" ? "attn" : "wait"}`}>{c.side === "US" ? t("Nosotros", "Us") : t("Cliente", "Customer")}</span> {c.what} · <Link href={`/visitas/${c.visit.id}`}>{c.visit.account.name}</Link>{c.dueAt && <span className={late(c.dueAt) ? "risk-t" : "muted"}> · {i.day(c.dueAt)}</span>}</li>)}</ul>
        )}
      </section>

      <section className="card" id="misiones">
        <div className="jbh"><b>{t("Misiones", "Missions")}</b><span className="grow" />
          <details className="qa" open={sp.err === "mision" || sp.err === "fechas" || sp.err === "monto"}><summary className="qa-btn">{t("+ Nueva misión", "+ New mission")}</summary>
            <div className="qa-pop wide right">
              <form action={createMission} className="qa-form">
                <label>{t("Título", "Title")}<input name="title" required maxLength={160} placeholder={t("Ej.: Gira Valle del Cauca", "E.g.: Valle del Cauca tour")} /></label>
                <label>{t("Destino", "Destination")}<input name="destination" required maxLength={200} /></label>
                <div className="qa-row">
                  <label>{t("Desde", "From")}<input name="startDate" type="date" required /></label>
                  <label>{t("Hasta", "To")}<input name="endDate" type="date" required /></label>
                </div>
                <label>{t("Propósito", "Purpose")}<textarea name="purpose" rows={2} required maxLength={600} /></label>
                <label>{t("Viaje (transporte, hotel…)", "Travel (transport, hotel…)")}<input name="travelNote" maxLength={600} /></label>
                <div className="qa-row">
                  <label className="chk"><input type="checkbox" name="requestBudget" value="1" /> {t("Necesito presupuesto de viaje", "I need a travel budget")}</label>
                  <label>{t("Monto estimado (USD)", "Estimated amount (USD)")}<input name="budgetAmount" type="number" min={0} step="0.01" /></label>
                </div>
                <span className="src block">{t("El presupuesto lo aprueba Gerencia (nunca quien viaja). Después del viaje cargas los gastos con soporte y los revisa Finanzas o Gerencia.", "Management approves the budget (never the traveller). After the trip you enter the expenses with receipts and Finance or Management checks them.")}</span>
                <button type="submit">{t("Crear misión", "Create mission")}</button>
              </form>
            </div>
          </details>
        </div>
        {missions.length === 0 ? <p className="small muted">{t("Sin misiones recientes. Una misión agrupa varias visitas de un mismo viaje.", "No recent missions. A mission groups several visits on one trip.")}</p> : missions.map((m) => (
          <article key={m.id} className="exc-item">
            <header className="exc-head"><b><Link href={`/visitas/mision/${m.id}`}>{m.title}</Link></b> · {m.destination} · <span className="mono small">{i.day(m.startDate)} – {i.day(m.endDate)}</span><span className="grow" />
              {m.budgetStatus !== "NOT_REQUESTED" && <span className={`sig ${(BUDGET_STATUS[m.budgetStatus] ?? BUDGET_STATUS.REQUESTED).tone}`}>{t((BUDGET_STATUS[m.budgetStatus] ?? BUDGET_STATUS.REQUESTED).es, (BUDGET_STATUS[m.budgetStatus] ?? BUDGET_STATUS.REQUESTED).en)}{m.budgetAmount ? ` · ${i.money(m.budgetApproved ?? m.budgetAmount)}` : ""}</span>}
              {m.budgetStatus === "APPROVED" && m.expensesStatus !== "OPEN" && <span className={`sig ${EXPENSES_STATUS[m.expensesStatus]?.tone ?? "wait"}`} style={{ marginLeft: 4 }}>{t(EXPENSES_STATUS[m.expensesStatus]?.es ?? m.expensesStatus, EXPENSES_STATUS[m.expensesStatus]?.en ?? m.expensesStatus)}</span>}
            </header>
            <p className="small">{m.purpose}</p>
            <p className="src">{m.visits.length === 0 ? t("Aún sin visitas: al planear una, elige esta misión.", "No visits yet: when planning one, choose this mission.") : m.visits.map((v) => `${v.account.name} (${t(VISIT_STATUS[v.status].es, VISIT_STATUS[v.status].en).toLowerCase()})`).join(" · ")}</p>
          </article>
        ))}
      </section>

      {recent.length > 0 && (
        <section className="card" id="recientes">
          <b>{t("Visitas recientes", "Recent visits")}</b>
          <ul className="mk-ul">{recent.map((v) => <li key={v.id}><Link href={`/visitas/${v.id}`}>{v.account.name}</Link> · {t(VISIT_STATUS[v.status].es, VISIT_STATUS[v.status].en)} · <span className="muted">{i.day(v.happenedAt ?? v.plannedAt)}</span>{v.learned && <span className="muted"> — {v.learned.slice(0, 120)}</span>}</li>)}</ul>
        </section>
      )}
    </>
  );
}
