import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { periodOf } from "@/lib/goal-rules";
import { METRICS, periodStatus } from "@/lib/metric-dictionary";
import { reportScope } from "@/lib/reports";
import { DIMS, DIM_TEXT, MAX_MONTHS, builderFacts, buildRows, cleanConfig, configQuery } from "@/lib/report-builder";
import { HowCalc } from "@/components/HowCalc";
import { deleteView, saveView } from "./actions";

// Módulo 13 §15 · Report Builder and saved views. The person chooses a period, a grouping and filters; SOLU answers
// with certified metrics only, from live data, under that person's permissions.

export default async function BuilderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const now = new Date();
  const scope = await reportScope(user);
  const mayShare = canManageAll(user) || canFinance(user);
  const views = await db.reportView.findMany({ where: { OR: [{ ownerId: user.id }, { shared: true }] }, orderBy: { name: "asc" }, include: { owner: { select: { name: true } } } });
  const view = sp.v ? views.find((x) => x.id === sp.v) ?? null : null;
  const c = cleanConfig(view ? (view.config as Record<string, unknown>) : sp, periodOf(now));
  // Whose Journeys this person may see: everyone's, or their own plus the teams they lead.
  const visible = scope.all ? null : [user.id, ...scope.led.flatMap((x) => x.members.filter((m) => m.user.active).map((m) => m.userId))];
  const [facts, people, accounts] = await Promise.all([
    builderFacts(c, visible),
    db.user.findMany({ where: { active: true, ...(visible ? { id: { in: visible } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { internal: false, ...(visible ? { deals: { some: { ownerId: { in: visible } } } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const { rows, total } = buildRows(facts, c);
  const provisional = periodStatus(c.to, now) !== "CLOSED";
  const okMsg: Record<string, string> = { vista: t("Vista guardada.", "View saved."), borrada: t("Vista borrada.", "View deleted.") };
  const mv = ["SALES", "ESAGARA_AMOUNT", "ESAGARA_PCT"].map((k) => `${k} v${METRICS[k].version}`).join(" · ");

  return (
    <>
      <div className="ph"><div><h1>{t("Constructor de informes", "Report builder")}</h1><p>{t("Arma tu propio informe: elige el periodo, cómo agruparlo y los filtros. Usa solo métricas del diccionario y siempre calcula con los datos de hoy. Puedes guardar la pregunta como una vista para volver a ella.", "Build your own report: choose the period, how to group it and the filters. It uses only metrics from the dictionary and always calculates from today's data. You can save the question as a view to come back to.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err === "nombre" && <div className="note risk">{t("Ponle un nombre a la vista.", "Give the view a name.")}</div>}

      <section className="card" id="vistas">
        <b>{t("VISTAS GUARDADAS", "SAVED VIEWS")} · {views.length}</b>
        {views.length === 0 ? <p className="small muted">{t("Aún no hay vistas. Arma un informe abajo y guárdalo.", "No views yet. Build a report below and save it.")}</p> : (
          <ul className="plain small">{views.map((x) => (
            <li key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Link href={`/informes/constructor?v=${x.id}`} className={x.id === view?.id ? "val" : ""}><b>{x.name}</b></Link>
              <span className="muted">{x.shared ? t(`compartida por ${x.owner.name}`, `shared by ${x.owner.name}`) : t("personal", "personal")}</span>
              {x.ownerId === user.id && <form action={deleteView.bind(null, x.id)}><button className="btn ghost small" type="submit">{t("Borrar", "Delete")}</button></form>}
            </li>
          ))}</ul>
        )}
        <p className="src">{t("Una vista guarda la pregunta, no las cifras: cada persona que la abre ve solo lo que tiene permiso de ver.", "A view stores the question, not the figures: each person who opens it sees only what they are allowed to see.")}</p>
      </section>

      <section className="card" id="armar">
        <b>{t("ARMAR", "BUILD")}</b>
        <form method="get" action="/informes/constructor" className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="small">{t("Desde", "From")}<br /><input type="month" name="from" defaultValue={c.from} required /></label>
          <label className="small">{t("Hasta", "To")}<br /><input type="month" name="to" defaultValue={c.to} required /></label>
          <label className="small">{t("Agrupar por", "Group by")}<br /><select name="dim" defaultValue={c.dim}>{DIMS.map((d) => <option key={d} value={d}>{t(DIM_TEXT[d].es, DIM_TEXT[d].en)}</option>)}</select></label>
          <label className="small">{t("Negociador", "Negotiator")}<br /><select name="ownerId" defaultValue={c.ownerId ?? ""}><option value="">{t("Todos los que puedo ver", "Everyone I can see")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="small">{t("Cliente", "Customer")}<br /><select name="accountId" defaultValue={c.accountId ?? ""}><option value="">{t("Todos", "All")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button className="btn" type="submit">{t("Ver informe", "See report")}</button>
        </form>
        <p className="src">{t(`Máximo ${MAX_MONTHS} meses por informe.`, `Up to ${MAX_MONTHS} months per report.`)}</p>
      </section>

      <section className="card" id="resultado">
        <b>{view ? view.name.toUpperCase() : t("RESULTADO", "RESULT")}</b>
        <p className="small"><span className="mono">{c.from} → {c.to}</span> · {t("por", "by")} {t(DIM_TEXT[c.dim].es, DIM_TEXT[c.dim].en).toLowerCase()}{c.ownerId && <> · {people.find((p) => p.id === c.ownerId)?.name ?? t("negociador fuera de tu alcance", "negotiator outside your scope")}</>}{c.accountId && <> · {accounts.find((a) => a.id === c.accountId)?.name ?? ""}</>} · <span className={`sig ${provisional ? "wait" : "ok"}`}>{provisional ? t("Provisional: incluye el mes abierto", "Provisional: includes the open month") : t("Meses cerrados", "Closed months")}</span> · {t("calculado", "as of")} {i.day(now)}</p>
        <div className="tscroll"><table>
          <thead><tr><th>{t(DIM_TEXT[c.dim].es, DIM_TEXT[c.dim].en)}</th><th className="n">{t("Ventas aceptadas", "Accepted sales")}</th><th className="n">{t("Venta USD", "Sales USD")}<span className="block"><HowCalc id="SALES" es={i.es} /></span></th><th className="n">{t("Eságara USD", "Eságara USD")}<span className="block"><HowCalc id="ESAGARA_AMOUNT" es={i.es} /></span></th><th className="n">{t("Eságara %", "Eságara %")}<span className="block"><HowCalc id="ESAGARA_PCT" es={i.es} /></span></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{t("No hay ventas aceptadas con esos filtros.", "No accepted sales with those filters.")}</td></tr>}
            {rows.map((r) => <tr key={r.key}><td>{r.href ? <Link href={r.href}>{r.label}</Link> : c.dim === "MONTH" && scope.all ? <Link href={`/informes/funcion?mes=${r.key}`} className="mono">{r.label}</Link> : <span className="mono">{r.label}</span>}</td><td className="n mono">{r.n || "—"}</td><td className="n mono">{r.n ? i.n2(r.sale) : "—"}</td><td className="n mono">{r.n ? i.n2(r.esagara) : "—"}</td><td className="n mono">{r.esagaraPct != null ? i.pct(r.esagaraPct) : "—"}</td></tr>)}
            <tr><td><b>{t("Total", "Total")}</b></td><td className="n mono"><b>{total.n}</b></td><td className="n mono"><b>{i.n2(total.sale)}</b></td><td className="n mono"><b>{i.n2(total.esagara)}</b></td><td className="n mono"><b>{total.esagaraPct != null ? i.pct(total.esagaraPct) : "—"}</b></td></tr>
          </tbody>
        </table></div>
        <p className="src">{t("Métricas", "Metrics")}: {mv}. {c.dim !== "MONTH" && t("En orden alfabético, no por tamaño: no es un ranking.", "In alphabetical order, not by size: this is not a ranking.")} {!scope.all && t("Ves tus Journeys y los de los equipos que lideras.", "You see your Journeys and those of the teams you lead.")}</p>

        <form action={saveView} className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
          <input type="hidden" name="from" value={c.from} /><input type="hidden" name="to" value={c.to} /><input type="hidden" name="dim" value={c.dim} />
          <input type="hidden" name="ownerId" value={c.ownerId ?? ""} /><input type="hidden" name="accountId" value={c.accountId ?? ""} />
          <label className="small">{t("Guardar esta pregunta como vista", "Save this question as a view")}<br /><input name="name" maxLength={80} placeholder={t("Nombre de la vista", "View name")} required /></label>
          {mayShare && <label className="small"><input type="checkbox" name="shared" value="1" /> {t("Compartir con todos", "Share with everyone")}</label>}
          <button className="btn ghost" type="submit">{t("Guardar vista", "Save view")}</button>
        </form>
        {view && <p className="src"><Link href={`/informes/constructor?${configQuery(c)}`}>{t("Cambiar esta pregunta sin tocar la vista", "Change this question without touching the view")}</Link></p>}
      </section>
    </>
  );
}
