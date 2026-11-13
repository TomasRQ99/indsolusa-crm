import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEditOps, isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { TRM_SOURCE, trmFor } from "@/lib/fx";
import { LEVELS, STEPS, authStep, type Level, type Step } from "@/lib/auth-levels";
import { getAuthPolicy } from "@/lib/auth-levels-store";
import { recordAuthorization } from "@/app/(app)/profile/autorizaciones/actions";

// Authorisation by level for one Journey: how big the business is in pesos today, which step that needs for the
// person who runs it, and who authorised it.

export default async function DealAuthorizationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const d = await db.deal.findUnique({ where: { id }, select: { id: true, code: true, title: true, amount: true, ownerId: true, owner: { select: { name: true, authLevel: true } }, account: { select: { id: true, name: true } }, quotes: { where: { status: { in: ["ACCEPTED", "PRESENTED"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { protSale: true, status: true } }, authorizations: { orderBy: { createdAt: "desc" } } } });
  if (!d) notFound();
  const [pol, trm] = await Promise.all([getAuthPolicy(), trmFor(today().toISOString().slice(0, 10)).catch(() => null)]);
  const usd = d.quotes[0]?.protSale != null ? Number(d.quotes[0].protSale) : Number(d.amount);
  const level = d.owner.authLevel && LEVELS[d.owner.authLevel as Level] ? (d.owner.authLevel as Level) : null;
  const cop = trm && usd > 0 ? Math.round(usd * trm.rate) : null;
  const r = level && cop != null ? authStep(level, cop, pol.value) : null;
  const editable = canEditOps(user, d.ownerId) || isGerencia(user);
  const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-CO")}`;
  const okMsg: Record<string, string> = { registrada: t("Autorización registrada.", "Authorisation recorded.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso sobre esta Necesidad.", "You don't have permission on this Necessity."), nivel: t("Quien lleva esta Necesidad no tiene nivel asignado. Gerencia lo asigna en Perfil → Configuración → Rangos de autorización.", "This Necessity's owner has no level assigned. Management assigns it in Profile → Settings → Authorisation ranges."), valor: t("Esta Necesidad aún no tiene un valor de venta.", "This Necessity has no sale value yet."), trm: t("SOLU no pudo leer la tasa oficial de hoy: escribe la TRM (pesos por dólar).", "SOLU couldn't read today's official rate: type the TRM (pesos per dollar)."), quien: t("Escribe quién autorizó.", "Write who authorised it."), mentor: t("Este paso exige el mentor informado: escribe a qué mentor se le informó.", "This step requires the mentor to be informed: write which mentor was told.") };

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=execute`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Autorización por nivel", "Authorisation by level")}</span><span className="grow" />
          <Link className="qa-btn" href="/profile/autorizaciones">{t("Ver rangos", "See ranges")}</Link>
        </div>
        <div className="jh-title"><h1>{t("¿Quién debe autorizar este negocio?", "Who must authorise this business?")}</h1>{r && <span className={`sig ${r.step === "PERSONAL" ? "ok" : "attn"}`}>{t(STEPS[r.step].es, STEPS[r.step].en)}</span>}</div>
        <p className="jh-sub">{t("Según los rangos de la empresa por nivel. SOLU lo indica y guarda quién autorizó; no bloquea ningún paso.", "According to the company's ranges by level. SOLU states it and keeps who authorised; it doesn't block any step.")}</p>
      </header>

      <section className="jblock">
        <dl className="qv-dl">
          <dt>{t("Valor del negocio", "Business value")}</dt><dd className="mono">{usd > 0 ? `USD ${i.n2(usd)}` : "—"}<span className="muted small"> · {d.quotes[0] ? t("venta de la cotización", "sale on the quote") : t("valor de la Necesidad", "Necessity value")}</span></dd>
          <dt>{t("En pesos hoy", "In pesos today")}</dt><dd className="mono">{cop != null ? pesos(cop) : "—"}{trm ? <span className="muted small"> · TRM {i.n2(trm.rate)} · {TRM_SOURCE}</span> : <span className="muted small"> · {t("sin tasa oficial disponible ahora", "no official rate available right now")}</span>}</dd>
          <dt>{t("Quien lleva la Necesidad", "Necessity owner")}</dt><dd>{d.owner.name} · {level ? <b>{t(LEVELS[level].es, LEVELS[level].en)}</b> : <span className="sig attn">{t("Sin nivel asignado", "No level assigned")}</span>}</dd>
          <dt>{t("Debe autorizar", "Must authorise")}</dt><dd>{r ? <><b>{t(STEPS[r.step].who.es, STEPS[r.step].who.en)}</b><span className="src block">{r.capCop != null ? t(`Este paso cubre desde ${pesos(r.fromCop)} hasta ${pesos(r.capCop)}.`, `This step covers from ${pesos(r.fromCop)} up to ${pesos(r.capCop)}.`) : t(`Por encima de ${pesos(r.fromCop)}.`, `Above ${pesos(r.fromCop)}.`)} {t("Los socios intervienen si hay riesgo relevante.", "The partners step in if there is relevant risk.")}</span></> : <span className="muted">{t("No se puede calcular todavía", "Can't be worked out yet")}</span>}</dd>
        </dl>
        {r && <ul className="plain small">{r.caps.map((c) => <li key={c.step} className={c.step === r.step ? undefined : "muted"}>{c.step === r.step ? "→ " : ""}{t(STEPS[c.step as Step].es, STEPS[c.step as Step].en)}: {t("hasta", "up to")} <span className="mono">{pesos(c.cop)}</span></li>)}<li className={r.step === "GERENCIA" ? undefined : "muted"}>{r.step === "GERENCIA" ? "→ " : ""}{t("Gerencia: por encima", "Management: above")}</li></ul>}
        <p className="src">{t(`Rangos versión ${pol.version}${pol.version === 0 ? " (tabla de 2025, por confirmar)" : ""}, en salarios mínimos de ${pesos(pol.value.smlvCop)}.`, `Ranges version ${pol.version}${pol.version === 0 ? " (2025 table, to be confirmed)" : ""}, in minimum wages of ${pesos(pol.value.smlvCop)}.`)}</p>
      </section>

      <section className="jblock" id="registro">
        <div className="jbh"><b>{t("AUTORIZACIONES REGISTRADAS", "RECORDED AUTHORISATIONS")}</b></div>
        {d.authorizations.length === 0 ? <p className="quiet-p">{t("Aún no se ha registrado quién autorizó.", "Who authorised hasn't been recorded yet.")}</p> : (
          <ul className="plain small">{d.authorizations.map((a) => <li key={a.id}><span className="mono">{i.day(a.createdAt)}</span> · <b>{t(STEPS[a.step as Step]?.es ?? a.step, STEPS[a.step as Step]?.en ?? a.step)}</b> · {t("autorizó", "authorised by")} {a.authorizedBy}{a.mentorInformed ? ` · ${t("mentor informado", "mentor informed")}: ${a.mentorInformed}` : ""}{a.partnersNote ? ` · ${t("socios", "partners")}: ${a.partnersNote}` : ""}<span className="src block">USD {i.n2(Number(a.amountUsd))} = {pesos(Number(a.amountCop))} · TRM {i.n2(Number(a.trm))} ({a.trmSource}) · {t(LEVELS[a.level as Level]?.es ?? a.level, LEVELS[a.level as Level]?.en ?? a.level)} · {t("rangos", "ranges")} v{a.policyVersion} · {a.recordedByName}{a.note ? ` · ${a.note}` : ""}</span></li>)}</ul>
        )}
        {editable && level && usd > 0 && (
          <details className="qa" style={{ marginTop: 8 }} open={d.authorizations.length === 0}><summary className="qa-btn">{t("+ Registrar autorización", "+ Record authorisation")}</summary>
            <form action={recordAuthorization.bind(null, d.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
              <label>{t("Quién autorizó (nombre y cargo)", "Who authorised (name and position)")}<input name="authorizedBy" required maxLength={200} defaultValue={r?.step === "PERSONAL" ? d.owner.name : ""} /></label>
              <div className="qa-row">
                <label>{t("Mentor informado", "Mentor informed")}<input name="mentorInformed" maxLength={120} /></label>
                {!trm && <label style={{ flex: "0 0 200px" }}>{t("TRM de hoy (pesos por dólar)", "Today's TRM (pesos per dollar)")}<input name="trm" inputMode="decimal" required /></label>}
              </div>
              <label>{t("Socios (solo si hay riesgo relevante: qué riesgo y quién lo vio)", "Partners (only if there is relevant risk: which risk and who saw it)")}<input name="partnersNote" maxLength={300} /></label>
              <label>{t("Nota", "Note")}<input name="note" maxLength={300} /></label>
              <button type="submit">{t("Registrar autorización", "Record authorisation")}</button>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
