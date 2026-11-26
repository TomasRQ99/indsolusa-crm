import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { sum } from "@/lib/sales-budget-rules";
import type { FactPick, FactSet } from "@/lib/sales-budget";
import { addPlant, addShare, removeShare, saveSites, setDealPlant } from "./sitios-actions";
import { budgetFmt } from "./ui";

// Presupuesto comercial · inside a company's budget: its sites or plants (what share of the goals each carries and
// what each has really brought) and its Needs (which site each belongs to, and whether its sale is shared between
// two negotiators). The company stays the unit of the budget; sites only break it down.

type Props = {
  i: I18n; year: number; accountId: string; accountName: string; personId: string; viewerId: string;
  /** May this viewer change the proposal (its negotiator, Gerencia or Dirección Comercial)? */
  write: boolean; manage: boolean;
  budget: { id: string; editable: boolean; ocGoal: number; factGoal: number } | null;
  set: FactSet; pick: FactPick;
  people: { id: string; name: string }[];
};

export default async function Sitios({ i, year, accountId, accountName, personId, viewerId, write, manage, budget, set, pick, people }: Props) {
  const { t } = i;
  const f = budgetFmt(i);
  const c = { year, slot: accountId, userId: personId };
  const [plants, sites, deals] = await Promise.all([
    db.plant.findMany({ where: { accountId }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    budget ? db.salesBudgetSite.findMany({ where: { budgetId: budget.id }, select: { plantId: true, pct: true } }) : [],
    db.deal.findMany({ where: { accountId, internal: false }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, code: true, title: true, ownerId: true, plantId: true, owner: { select: { name: true } }, salesShares: { select: { id: true, userId: true, pct: true, reason: true } } } }),
  ]);
  const pctOf = new Map(sites.map((s) => [s.plantId, Number(s.pct)]));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  const mine = set.facts.filter((x) => x.accountId === accountId && pick(x) && x.usd != null);
  const of = (plantId: string | null, kpi: "OC_COP" | "FACT_COP", y: number) => sum(mine.filter((x) => (x.plantId ?? null) === plantId && x.kpi === kpi && x.month.startsWith(String(y))).map((x) => x.usd));
  const rows = [...plants.map((p) => ({ id: p.id as string | null, name: p.city ? `${p.name} · ${p.city}` : p.name })), { id: null as string | null, name: t("Sin sede asignada", "No site assigned") }];
  const given = sum(plants.map((p) => pctOf.get(p.id) ?? 0));
  const editable = !!budget?.editable && write;
  const H = { base: t(`OC ${year - 1}`, `POs ${year - 1}`), real: t(`OC ${year} reales`, `Real POs ${year}`), fact: t(`Facturación ${year}`, `Invoicing ${year}`), pct: t("% de la meta", "% of the goal"), goal: t(`Meta OC ${year}`, `PO goal ${year}`), adv: t("Avance del año", "Progress of the year") };

  return (
    <>
      <section className="card" id="sedes">
        <b>{t(`SEDES O PLANTAS DE ${accountName.toUpperCase()}`, `SITES OR PLANTS OF ${accountName.toUpperCase()}`)}</b>
        {plants.length === 0 ? <p className="small muted">{t("Esta empresa no tiene sedes registradas. El presupuesto es de la empresa completa; si quieres repartirlo, agrega sus sedes aquí abajo (también aparecen las plantas registradas en MERCADO).", "This company has no sites recorded. The budget is for the whole company; to break it down, add its sites below (plants recorded in MARKET also show here).")}</p> : (
          <form action={budget ? saveSites.bind(null, c, budget.id) : undefined}>
            <div className="pc-scroll">
              <table className="pc-table pc-cards" id="tabla-sedes">
                <thead><tr><th>{t("Sede o planta", "Site or plant")}</th><th>{H.base}</th><th>{H.real}</th><th>{H.fact}</th><th>{H.pct}</th><th>{H.goal}</th><th>{H.adv}</th></tr></thead>
                <tbody>
                  {rows.map((r) => { const pct = r.id ? pctOf.get(r.id) ?? 0 : Math.max(0, 100 - given); const goal = budget ? (budget.ocGoal * pct) / 100 : 0; const real = of(r.id, "OC_COP", year); return (
                    <tr key={r.id ?? "none"} data-p={r.id ?? "NONE"}>
                      <th scope="row">{r.name}</th>
                      <td data-l={H.base}>{f.bare(of(r.id, "OC_COP", year - 1))}</td>
                      <td data-l={H.real}>{f.bare(real)}</td>
                      <td data-l={H.fact}>{f.bare(of(r.id, "FACT_COP", year))}</td>
                      <td data-l={H.pct}>{!budget ? "—" : r.id && editable ? <input className="pc-in n" name={`pct_${r.id}`} inputMode="decimal" defaultValue={pct ? String(pct).replace(".", i.es ? "," : ".") : ""} aria-label={`${H.pct} · ${r.name}`} /> : f.pct(pct)}</td>
                      <td data-l={H.goal}>{budget ? f.bare(goal) : "—"}</td>
                      <td data-l={H.adv}>{budget && goal > 0 ? f.pct(Math.round((real / goal) * 1000) / 10) : "—"}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            <p className="src">{t("Cifras en dólares (US$), de lo que entra en el presupuesto de este negociador. «% de la meta» reparte la meta anual de órdenes de compra; lo que no se le da a una sede queda en «Sin sede asignada». Lo real de una sede son las Necesidades que la nombran (abajo se asigna); el historial cargado de antes de SOLU no tiene sede.", "Figures in dollars (US$), of what enters this negotiator's budget. «% of the goal» spreads the annual purchase-order goal; what is not given to a site stays under «No site assigned». A site's real figures are the Needs that name it (assigned below); history loaded from before SOLU has no site.")}{!budget ? t(" Guarda primero la propuesta para repartirla por sede.", " Save the proposal first to spread it by site.") : !editable ? t(" El reparto se cambia mientras la propuesta es un borrador; una aprobada necesita una versión nueva.", " The split is changed while the proposal is a draft; an approved one needs a new version.") : ""}</p>
            {editable && <div className="pc-actions"><button type="submit" className="secondary">{t("Guardar reparto por sede", "Save split by site")}</button></div>}
          </form>
        )}
        {write && (
          <details className="small" id="agregar-sede" style={{ marginTop: 8 }}>
            <summary>{t("+ Agregar una sede o planta", "+ Add a site or plant")}</summary>
            <form action={addPlant.bind(null, c)} className="pc-bar" style={{ marginTop: 8 }}>
              <label>{t("Nombre de la sede", "Site name")} *<input type="text" name="name" maxLength={120} /></label>
              <label>{t("Ciudad (opcional)", "City (optional)")}<input type="text" name="city" maxLength={80} /></label>
              <button type="submit" className="secondary">{t("Agregar sede", "Add site")}</button>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="necesidades">
        <b>{t(`NECESIDADES DE ${accountName.toUpperCase()}: SEDE Y VENTA COMPARTIDA`, `NEEDS OF ${accountName.toUpperCase()}: SITE AND SHARED SALE`)}</b>
        {deals.length === 0 ? <p className="small muted">{t("Esta empresa todavía no tiene Necesidades en SOLU.", "This company has no Needs in SOLU yet.")}</p> : (
          <div className="pc-scroll">
            <table className="pc-table pc-cards" id="tabla-necesidades">
              <thead><tr><th>{t("Necesidad", "Need")}</th><th className="l">{t("La lleva", "Led by")}</th><th className="l">{t("Sede", "Site")}</th><th className="l">{t("Venta compartida con", "Sale shared with")}</th></tr></thead>
              <tbody>
                {deals.map((d) => { const canSite = d.ownerId === viewerId || manage; const left = 100 - sum(d.salesShares.map((s) => Number(s.pct))); return (
                  <tr key={d.id} data-d={d.id}>
                    <th scope="row"><Link href={`/deals/${d.id}`}>{`${d.code ?? ""} ${d.title}`.trim()}</Link></th>
                    <td className="l" data-l={t("La lleva", "Led by")}>{d.owner.name}{d.salesShares.length > 0 ? ` · ${f.pct(left)}` : ""}</td>
                    <td className="l" data-l={t("Sede", "Site")}>{plants.length === 0 ? <span className="muted">—</span> : canSite ? (
                      <form action={setDealPlant.bind(null, c, d.id)} className="pc-actions" style={{ marginTop: 0 }}>
                        <select name="plantId" defaultValue={d.plantId ?? ""} aria-label={t("Sede de la Necesidad", "Site of the Need")}><option value="">{t("Sin sede", "No site")}</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                        <button type="submit" className="secondary sm">{t("Guardar sede", "Save site")}</button>
                      </form>
                    ) : plants.find((p) => p.id === d.plantId)?.name ?? t("Sin sede", "No site")}</td>
                    <td className="l" data-l={t("Venta compartida con", "Sale shared with")} style={{ whiteSpace: "normal" }}>
                      {d.salesShares.map((s) => (
                        <form key={s.id} action={removeShare.bind(null, c, s.id)} className="pc-actions" style={{ marginTop: 0 }}>
                          <span className="sig attn">{nameOf(s.userId)} · {f.pct(Number(s.pct))}</span>{s.reason ? <span className="src">«{s.reason}»</span> : null}
                          {manage && <button type="submit" className="secondary sm" data-confirm={t("¿Quitar esta parte? La venta vuelve completa a quien lleva la Necesidad.", "Remove this share? The sale goes back whole to whoever leads the Need.")}>{t("Quitar", "Remove")}</button>}
                        </form>
                      ))}
                      {manage ? (
                        <details><summary>{t("Compartir esta venta", "Share this sale")}</summary>
                          <form action={addShare.bind(null, c, d.id)} className="pc-bar" style={{ marginTop: 6 }}>
                            <label>{t("Con quién", "With whom")} *<select name="userId" defaultValue=""><option value="">—</option>{people.filter((p) => p.id !== d.ownerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                            <label>{t("Su parte (%)", "Their share (%)")} *<input className="pc-in n" name="pct" inputMode="decimal" /></label>
                            <label>{t("Motivo (opcional)", "Reason (optional)")}<input type="text" name="reason" maxLength={300} /></label>
                            <button type="submit" className="secondary">{t("Compartir venta", "Share sale")}</button>
                          </form>
                        </details>
                      ) : d.salesShares.length === 0 ? <span className="muted">{t("No", "No")}</span> : null}
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
        <p className="src">{t("Las 30 Necesidades más recientes de esta empresa. Una venta compartida reparte los valores en dólares de esa Necesidad (cotizado, órdenes de compra, Eságara y facturación) entre quien la lleva y la otra persona; el número de solicitudes, cotizaciones y órdenes sigue completo con quien la lleva. Siempre suma 100 %. La comparten Gerencia o la Dirección Comercial. El reparto vale para el presupuesto comercial: no cambia las comisiones ni la tabla de bateo.", "The 30 most recent Needs of this company. A shared sale splits that Need's peso figures (quoted, purchase orders, Eságara and invoicing) between whoever leads it and the other person; the number of requests, quotes and orders stays whole with whoever leads it. It always adds up to 100 %. Management or the Commercial Director share it. The split applies to the commercial budget: it does not change commissions or the batting table.")}</p>
      </section>
    </>
  );
}
