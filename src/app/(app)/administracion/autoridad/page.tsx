import { requireUser } from "@/lib/auth";
import { canFinance, isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, dayInput, today } from "@/lib/domain";
import { DOMAINS, holdsAuthority } from "@/lib/admin-rules";
import { getAdminPolicy } from "@/lib/admin-store";
import { getPurchasePolicy } from "@/lib/pr-auth";
import { extendAuthority, grantAuthority, revokeAuthority } from "./actions";

// Módulo 14 §16, §24 · Autoridad prestada: who may act for whom, in what, up to how much and until when.

export default async function AuthorityPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; m?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user), all = canFinance(user);
  const [rows, pol, purchase, people] = await Promise.all([
    db.delegatedAuthority.findMany({ where: all ? {} : { OR: [{ fromUserId: user.id }, { toUserId: user.id }] }, orderBy: { endsAt: "desc" }, take: 80, include: { fromUser: { select: { name: true, role: true, active: true } }, toUser: { select: { name: true } } } }),
    getAdminPolicy(), getPurchasePolicy(),
    ger ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }) : [],
  ]);
  const now = new Date(), T = today();
  const state = (d: (typeof rows)[number]) => (d.revokedAt ? "REVOKED" : !d.fromUser.active ? "LENDER_GONE" : now < d.startsAt ? "FUTURE" : now < d.endsAt ? "ACTIVE" : "ENDED");
  const extended = new Set(rows.map((r) => r.previousId).filter(Boolean));
  const live = rows.filter((d) => state(d) === "ACTIVE" || state(d) === "FUTURE");
  const past = rows.filter((d) => !live.includes(d));
  const lastDay = (d: Date) => addDays(d, -1);
  const okMsg: Record<string, string> = { prestada: t("Autoridad prestada. Termina sola en la fecha indicada.", "Authority lent. It ends by itself on the stated date."), extendida: t("Creada una versión nueva con más tiempo. La anterior queda como estaba.", "A new version with more time was created. The earlier one stays as it was."), retirada: t("Autoridad retirada.", "Authority revoked.") };
  const errMsg: Record<string, string> = { gerencia: t("Solo Gerencia presta o extiende autoridad; la puede retirar Gerencia o quien la prestó.", "Only Management lends or extends authority; Management or the lender can revoke it."), datos: t("Faltan datos: de quién, a quién, qué autoridad, fechas y motivo.", "Missing data: from whom, to whom, which authority, dates and reason."), regla: sp.m ?? "", retirar: t("Escribe por qué se retira.", "Write why it is revoked."), "ya-extendida": t("Esa autoridad ya tiene una versión siguiente.", "That authority already has a next version.") };
  const line = (d: (typeof rows)[number]) => {
    const s = state(d);
    return (
      <li key={d.id}>
        <span className={`sig ${s === "ACTIVE" ? "ok" : s === "FUTURE" ? "wait" : s === "ENDED" ? "wait" : "risk"}`}>{s === "ACTIVE" ? t("Vigente", "In force") : s === "FUTURE" ? t("Empieza después", "Starts later") : s === "ENDED" ? t("Terminó sola", "Ended by itself") : s === "REVOKED" ? t("Retirada", "Revoked") : t("Quien prestó ya no está activo", "The lender is no longer active")}</span>{" "}
        <b>{d.fromUser.name}</b> → <b>{d.toUser.name}</b> · {DOMAINS[d.domain] ? t(DOMAINS[d.domain].es, DOMAINS[d.domain].en) : d.domain}{d.limitUsd != null ? ` · ${t("hasta", "up to")} USD ${i.n2(d.limitUsd)}` : ` · ${t("con el límite del rol de quien presta", "with the lender's role limit")}`}
        {" · "}{i.day(d.startsAt)} – {i.date(lastDay(d.endsAt))}{d.version > 1 ? ` · v${d.version}` : ""}
        <span className="src block">{d.reason}{d.scopeNote ? ` · ${d.scopeNote}` : ""} · {t("aprobó", "approved by")} {d.approvedByName}{d.revokedAt ? ` · ${t("retirada por", "revoked by")} ${d.revokedByName}: ${d.revokeReason}` : ""}</span>
        {(s === "ACTIVE" || s === "FUTURE") && (ger || d.fromUserId === user.id) && <form action={revokeAuthority.bind(null, d.id)} className="qa-row" style={{ alignItems: "center", marginTop: 4 }}><input name="reason" required placeholder={t("Por qué se retira", "Why it is revoked")} aria-label={t("Motivo", "Reason")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Retirar", "Revoke")}</button></form>}
        {ger && (s === "ACTIVE" || s === "ENDED") && !extended.has(d.id) && <details><summary className="small">{t("Dar más tiempo (crea una versión nueva)", "Give more time (creates a new version)")}</summary>
          <form action={extendAuthority.bind(null, d.id)} className="qa-row" style={{ alignItems: "flex-end" }}><label>{t("Nueva fecha final", "New end date")}<input type="date" name="endsOn" required min={dayInput(T)} /></label><label style={{ flex: 2 }}>{t("Motivo", "Reason")}<input name="reason" required maxLength={400} /></label><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Crear versión", "Create version")}</button></form>
        </details>}
      </li>
    );
  };

  return (
    <>
      <div className="ph"><div><h1>{t("Autoridad prestada", "Delegated authority")}</h1><p>{t("Cuando alguien que aprueba va a estar ausente, puede prestar esa autoridad a otra persona por un tiempo. Tiene dominio, tope, fechas y motivo, la aprueba Gerencia y termina sola.", "When someone who approves will be away, that authority can be lent to another person for a time. It has a domain, a cap, dates and a reason, Management approves it and it ends by itself.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card"><b>{t("VIGENTES Y PRÓXIMAS", "IN FORCE AND UPCOMING")} · {live.length}</b>
        {live.length === 0 ? <p className="small muted">{t("Ninguna.", "None.")} <a href="#nueva">{t("Ir al formulario para prestar autoridad", "Go to the form to lend authority")} →</a></p> : <ul className="plain small">{live.map(line)}</ul>}
      </section>
      {past.length > 0 && <section className="card"><b>{t("ANTERIORES", "EARLIER")} · {past.length}</b><ul className="plain small">{past.map(line)}</ul></section>}

      {ger && <section className="card" id="nueva">
        <b>{t("PRESTAR AUTORIDAD", "LEND AUTHORITY")}</b>
        <form action={grantAuthority} className="qa-form">
          <div className="qa-row">
            <label>{t("Qué autoridad", "Which authority")}<select name="domain">{Object.entries(DOMAINS).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label>{t("De quién (la tiene por su rol)", "From whom (holds it by role)")}<select name="fromUserId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...people.filter((p) => Object.keys(DOMAINS).some((d) => holdsAuthority(p.role, d, purchase.value))).map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE_LABEL[p.role]?.[i.es ? "es" : "en"]}</option>)]}</select></label>
            <label>{t("A quién", "To whom")}<select name="toUserId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE_LABEL[p.role]?.[i.es ? "es" : "en"]}</option>)]}</select></label>
          </div>
          <div className="qa-row">
            <label>{t("Desde", "From")}<input type="date" name="startsOn" required defaultValue={dayInput(T)} /></label>
            <label>{t("Hasta (incluido)", "To (inclusive)")}<input type="date" name="endsOn" required /></label>
            <label>{t("Tope en USD (opcional)", "Cap in USD (optional)")}<input name="limitUsd" inputMode="decimal" /></label>
          </div>
          <label>{t("Sobre qué (opcional: un cliente, un tipo de compra…)", "Over what (optional: a customer, a kind of purchase…)")}<input name="scopeNote" maxLength={300} /></label>
          <label>{t("Motivo", "Reason")}<input name="reason" required maxLength={400} placeholder={t("Ej.: vacaciones del 2 al 16 de diciembre", "E.g. vacation from 2 to 16 December")} /></label>
          <div><button type="submit">{t("Prestar", "Lend")}</button></div>
        </form>
        <p className="src">{t(`Máximo ${pol.value.delegationMaxDays} días por versión. Quien recibe actúa con el nivel del rol de quien presta, nunca sobre lo que pidió quien presta ni sobre lo que pidió él mismo. Cada decisión tomada así dice de quién era la autoridad. El campo «sobre qué» es una nota para las personas: SOLU aplica el dominio, el tope y las fechas.`, `At most ${pol.value.delegationMaxDays} days per version. The receiver acts with the level of the lender's role, never on what the lender requested nor on their own requests. Every decision made this way says whose authority it was. The "over what" field is a note for people: SOLU enforces the domain, the cap and the dates.`)}</p>
      </section>}
      <p className="src">{t("Esto no cambia el rol de nadie en SOLU ni cubre los Journeys de un ausente: eso es Cobertura.", "This changes nobody's role in SOLU and doesn't cover an absent person's Journeys: that is Coverage.")}</p>
    </>
  );
}
