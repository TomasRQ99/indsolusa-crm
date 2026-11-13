import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { closeReport } from "@/lib/closes";
import { getFocusPolicy } from "@/lib/focus";
import { closeBounds, closeState, shiftClose, type CloseKind } from "@/lib/focus-rules";

// Comercial C8c · Periodic closes (v1.3 §62): daily, weekly, monthly. Built from events inside the period, in five
// parts. Own work by default; management can see one person or company totals (never a list of people).

export default async function ClosesPage({ searchParams }: { searchParams: Promise<{ k?: string; d?: string; u?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const kind: CloseKind = sp.k === "week" || sp.k === "month" ? sp.k : "day";
  const now = new Date();
  const ref = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? new Date(`${sp.d}T00:00:00Z`) : now;
  const people = manage ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const scope = manage ? (sp.u === "all" ? null : sp.u && people.some((p) => p.id === sp.u) ? sp.u : user.id) : user.id;
  const { start, end } = closeBounds(kind, ref);
  const pol = await getFocusPolicy();
  const state = closeState(kind, ref, now, pol.value.closeTime);
  const r = await closeReport(scope, start, end);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const href = (k: CloseKind, d: Date) => `/comercial/cierres?k=${k}&d=${day(d)}${scope !== user.id ? `&u=${scope ?? "all"}` : ""}`;
  const label = kind === "day" ? i.date(start) : kind === "week" ? `${i.day(start)} – ${i.date(new Date(end.getTime() - 864e5))}` : new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(start).replace(/^./, (c) => c.toUpperCase());
  const stateTxt = { FINAL: [t("Cierre final", "Final close"), "ok"], DUE: [t(`Hora del cierre (${pol.value.closeTime})`, `Close time (${pol.value.closeTime})`), "attn"], OPEN: [t("Periodo en curso", "Period in progress"), "info"], FUTURE: [t("Aún no empieza", "Not started"), "wait"] } as const;
  const h = r.happened;
  const nextLabel = kind === "day" ? t("mañana", "tomorrow") : kind === "week" ? t("la próxima semana", "next week") : t("el próximo mes", "next month");

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Cierres de gestión", "Management closes")}</h1>
          <p>{t(`Lo que pasó dentro del periodo, no una foto del último día. El cierre diario de gestión es a las ${pol.value.closeTime} (Bogotá); el corte técnico final queda al terminar el día.`, `What happened inside the period, not a snapshot of the last day. The daily management close is at ${pol.value.closeTime} (Bogotá); the final technical cut is when the day ends.`)}</p>
        </div>
      </div>
      <div className="goal-bar-top">
        {(["day", "week", "month"] as CloseKind[]).map((k) => <Link key={k} className={`qa-btn${k === kind ? " on" : ""}`} href={href(k, ref)}>{k === "day" ? t("Diario", "Daily") : k === "week" ? t("Semanal", "Weekly") : t("Mensual", "Monthly")}</Link>)}
        <span className="grow" />
        <Link className="qa-btn" href={href(kind, shiftClose(kind, ref, -1))}>←</Link>
        <b className="goal-month">{label}</b>
        <Link className="qa-btn" href={href(kind, shiftClose(kind, ref, 1))}>→</Link>
        <span className={`sig ${stateTxt[state][1]}`}>{stateTxt[state][0]}</span>
        {manage && (
          <form method="get" className="goal-pick">
            <input type="hidden" name="k" value={kind} /><input type="hidden" name="d" value={day(ref)} />
            <select name="u" defaultValue={scope ?? "all"} aria-label={t("Ver", "View")}><option value="all">{t("Toda la empresa", "Whole company")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button type="submit" className="secondary">{t("Ver", "View")}</button>
          </form>
        )}
      </div>

      <section className="card" id="paso">
        <b>1 · {t("Qué pasó", "What happened")}</b>
        <div className="goal-grid">
          <div className="goal-card"><span className="small muted">{t("Eságara aceptada", "Eságara accepted")}</span><b className="tv">{i.money(h.esagara)}</b><span className="small">{i.pct(h.pct)} {t("de", "of")} {i.money(h.sale)}</span></div>
          <div className="goal-card"><span className="small muted">{t("Decisiones del cliente", "Customer decisions")}</span><b className="tv">{h.accepted + h.declined}</b><span className="small">{t(`${h.accepted} sí · ${h.declined} no`, `${h.accepted} yes · ${h.declined} no`)}</span></div>
          <div className="goal-card"><span className="small muted">{t("Cotizaciones enviadas", "Quotes sent")}</span><b className="tv">{h.presented.length}</b><span className="small">{t(`${h.presented.filter((q) => q.presentations.length).length} presentadas`, `${h.presented.filter((q) => q.presentations.length).length} presented`)}</span></div>
          <div className="goal-card"><span className="small muted">{t("Contactos útiles · visitas", "Useful contacts · visits")}</span><b className="tv">{h.usefulContacts} · {h.visits}</b><span className="small">{t(`${h.needs.length} necesidades nuevas · ${h.pos.length} POs`, `${h.needs.length} new needs · ${h.pos.length} POs`)}</span></div>
          <div className="goal-card"><span className="small muted">{t("Facturado · cobrado", "Invoiced · collected")}</span><b className="tv">{i.money(h.invoiced)}</b><span className="small">{t(`cobrado ${i.money(h.collected)}`, `collected ${i.money(h.collected)}`)}</span></div>
        </div>
        {h.decided.length > 0 && <ul className="mk-ul small">{h.decided.map((q) => <li key={q.id}><span className={`sig ${q.status === "ACCEPTED" ? "ok" : "wait"}`}>{q.status === "ACCEPTED" ? t("Aceptada", "Accepted") : t("Rechazada", "Declined")}</span> <Link href={`/cotizaciones/${q.id}`}>Nº {q.number}{q.rev ? `-R${q.rev}` : ""}</Link> · {q.deal.account.name} · {q.deal.title}{q.protSale && Number(q.protSale) > 0 ? ` · Eságara ${i.money(q.protEsagra)} (${i.pct((Number(q.protEsagra) / Number(q.protSale)) * 100)})` : ""}</li>)}</ul>}
      </section>

      <section className="card" id="aprendimos">
        <b>2 · {t("Qué aprendimos", "What we learned")}</b>
        {r.learned.visits.length + r.learned.presentations.length === 0 ? <p className="small muted">{t("Nada registrado como aprendizaje en el periodo (visitas o presentaciones).", "Nothing recorded as learning in the period (visits or presentations).")} <Link href="/visitas">{t("Abrir Visitas", "Open Visits")} →</Link></p> : (
          <ul className="mk-ul small">
            {r.learned.visits.map((v) => <li key={v.id}><Link href={`/visitas/${v.id}`}>{v.account.name}</Link>: {v.learned}</li>)}
            {r.learned.presentations.map((p) => <li key={p.id}><Link href={`/deals/${p.case.deal.id}/solucion`}>{p.case.deal.account.name}</Link>: {p.valued ? t(`valoró ${p.valued}`, `valued ${p.valued}`) : ""}{p.valued && p.objections ? " · " : ""}{p.objections ? t(`objeción: ${p.objections}`, `objection: ${p.objections}`) : ""}</li>)}
          </ul>
        )}
      </section>

      <section className="card" id="futuro">
        <b>3 · {t("Futuro visible ahora", "Future visible now")}</b>
        {r.future.needs.length + r.future.futures.length + r.future.decisionsNext.length === 0 ? <p className="small muted">{t("Sin necesidades nuevas, futuro capturado ni decisiones próximas.", "No new needs, captured future or upcoming decisions.")} <Link href="/deals">{t("Abrir Necesidades", "Open Necessities")} →</Link></p> : (
          <ul className="mk-ul small">
            {r.future.needs.slice(0, 10).map((d) => <li key={d.id}>{t("Necesidad", "Need")}: <Link href={`/deals/${d.id}`}>{d.code ?? d.title}</Link> · {d.account.name} — {d.desiredResult}</li>)}
            {r.future.needs.length > 10 && <li className="muted">{t(`y ${r.future.needs.length - 10} necesidades más`, `and ${r.future.needs.length - 10} more needs`)}</li>}
            {r.future.futures.map((f) => <li key={f.id}>{t("Futuro", "Future")}: {f.account?.name ?? "—"} · {f.description}{f.expectedAt ? ` · ${i.day(f.expectedAt)}` : ""}</li>)}
            {r.future.decisionsNext.map((q) => <li key={q.id}>{t(`Decide ${nextLabel}`, `Decides ${nextLabel}`)}: <Link href={`/cotizaciones/${q.id}`}>Nº {q.number}{q.rev ? `-R${q.rev}` : ""}</Link> · {q.deal.account.name} · Eságara {i.money(q.protEsagra)}{q.decisionAt ? ` · ${i.day(q.decisionAt)}` : ""}</li>)}
          </ul>
        )}
      </section>

      <section className="card" id="mejora">
        <b>4 · {t("Oportunidades de mejora", "Improvement opportunities")}</b>
        {r.improve.length === 0 ? <p className="small muted"><span className="sig ok">{t("Nada que señalar en este periodo.", "Nothing to flag this period.")}</span></p> : <ul className="mk-ul small">{r.improve.map((x, k) => <li key={k}>{t(x.es, x.en)}</li>)}</ul>}
        {scope && <p className="src"><Link href={`/comercial/mejora${scope !== user.id ? `?u=${scope}` : ""}`}>{t("Ver la comparación con la historia propia", "See the comparison with own history")} →</Link></p>}
      </section>

      <section className="card" id="proximos">
        <b>5 · {t("Próximos movimientos", "Next movements")}</b>
        {r.next.length === 0 ? <p className="small muted">{t("Sin próximos pasos con fecha.", "No dated next steps.")}</p> : <ul className="mk-ul small">{r.next.map((d) => <li key={d.id}><span className={`mono${d.nextMoveDate && d.nextMoveDate < start ? " risk-t" : ""}`}>{i.day(d.nextMoveDate)}</span> · <Link href={`/deals/${d.id}`}>{d.code ?? d.title}</Link> · {d.account.name} → {d.nextMove ?? "—"}</li>)}</ul>}
      </section>
    </>
  );
}
