import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isGerencia, ROLE_LABEL, WORK_ROLES as ROLES } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { policyOversight } from "@/lib/gerencia-views";
import { Notes } from "../ui";
import { saveGerenciaPolicy } from "../gobierno-actions";

// Módulo 15 §8 · Policy & authority oversight. Gerencia sees which version of each policy is in force, the
// exceptions waiting, the approvals only the highest level could give, and the exceptions that repeat so often that
// the policy itself deserves a second look (AC12). Operating numbers are not edited from here: each policy is
// changed in its own place, with its reason.

export default async function OversightPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  const o = await policyOversight();
  const P = o.policy.value;
  const ok = { guardada: t("Guardada como una versión nueva, vigente desde ahora.", "Saved as a new version, in force from now."), igual: t("No hubo cambios.", "No changes.") };
  const err = { gerencia: t("Solo Gerencia cambia esta política.", "Only Management changes this policy."), valores: t("Revisa los valores: filas entre 3 y 30, porcentajes mayores que cero, repeticiones de 2 o más, días dentro de lo permitido, y Gerencia siempre entre quienes publican. No se guardó nada.", "Check the values: rows between 3 and 30, percentages above zero, repetitions of 2 or more, days within range, and Management always among those who publish. Nothing was saved."), motivo: t("Escribe por qué se cambia. No se guardó nada.", "Write why it is changed. Nothing was saved.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Políticas y autoridad", "Policies and authority")}</h1><p>{t("Qué reglas rigen, qué excepciones esperan, qué aprobó el nivel más alto y qué excepciones se repiten tanto que la regla merece revisarse.", "Which rules are in force, which exceptions wait, what the highest level approved and which exceptions repeat so often that the rule deserves a review.")}</p><p className="small">{t("calculado", "as of")} {i.date(o.asOf)}</p></div></div>
      <Notes sp={sp} ok={ok} err={err} />

      <section className="card" id="patrones"><b>{t("EXCEPCIONES QUE SE REPITEN", "EXCEPTIONS THAT REPEAT")}</b> <span className="small muted">{t(`la misma excepción ${P.patternCount} veces o más en ${P.patternDays} días`, `the same exception ${P.patternCount} times or more in ${P.patternDays} days`)}</span>
        {o.patterns.length === 0 ? <p className="small"><span className="sig ok">{t("Ninguna excepción se repite lo suficiente para cuestionar una política", "No exception repeats enough to question a policy")}</span> <span className="muted">· {t(`${o.counted} excepción(es) revisadas`, `${o.counted} exception(s) examined`)}</span></p> : (
          <ul className="plain">{o.patterns.map((p) => (
            <li key={`${p.policy}|${p.group}`} style={{ marginBottom: 10 }}><span className="sig attn">{t(`${p.n} veces`, `${p.n} times`)}</span> <b>{p.label}</b>{p.usd ? <span className="mono"> · {i.money(p.usd)}</span> : null} <span className="src">· {i.day(p.first)} – {i.day(p.last)}</span>
              <span className="src block">{t("Pregunta para Gerencia: si esta excepción es lo normal, ¿la política sigue siendo la correcta?", "Question for Management: if this exception is the norm, is the policy still the right one?")} {p.policyName ? <Link href={p.policyName.href}>{t("Ver la política", "See the policy")}: {t(p.policyName.es, p.policyName.en)}</Link> : null}</span>
              <details><summary className="small">{t("Ver los casos", "See the cases")}</summary><ul className="plain small">{p.rows.map((r, k) => <li key={k}><Link href={r.href}>{i.date(r.at)}</Link>{r.usd ? ` · ${i.money(r.usd)}` : ""}</li>)}</ul></details>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="card" id="pendientes"><b>{t("EXCEPCIONES QUE ESPERAN", "EXCEPTIONS WAITING")}</b> · {o.pending.length}
        {o.pending.length === 0 ? <p className="small"><span className="sig ok">{t("Ninguna espera decisión", "None awaits a decision")}</span></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Política", "Policy")}</th><th>{t("Qué", "What")}</th><th className="n">{t("Valor", "Amount")}</th><th>{t("Quién pidió", "Asked by")}</th><th>{t("Desde", "Since")}</th></tr></thead>
            <tbody>{o.pending.map((p) => <tr key={p.key}><td>{t(p.policy.es, p.policy.en)}</td><td><Link href={p.href}>{p.what}</Link></td><td className="n mono">{p.usd != null ? i.money(p.usd) : "—"}</td><td className="small">{p.who}</td><td className="small">{i.date(p.since)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="aprobaciones"><b>{t("APROBACIONES DEL NIVEL MÁS ALTO, 90 DÍAS", "HIGHEST-LEVEL APPROVALS, 90 DAYS")}</b>
        {o.approvals.length === 0 ? <p className="small muted">{t("Ninguna en 90 días.", "None in 90 days.")} <a href="#pendientes">{t("Ver las que esperan decisión", "See those awaiting a decision")} →</a></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cuándo", "When")}</th><th>{t("Qué", "What")}</th><th className="n">{t("Valor", "Amount")}</th><th>{t("Quién aprobó", "Approved by")}</th></tr></thead>
            <tbody>{o.approvals.map((a) => <tr key={a.key}><td className="small">{i.date(a.at)}</td><td><Link href={a.href}>{t(a.what.es, a.what.en)}</Link></td><td className="n mono">{a.usd != null ? i.money(a.usd) : "—"}</td><td className="small">{a.by}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="versiones"><b>{t("POLÍTICAS VIGENTES", "POLICIES IN FORCE")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Política", "Policy")}</th><th>{t("Versión", "Version")}</th><th>{t("Desde", "Since")}</th><th>{t("Quién la definió", "Set by")}</th><th>{t("Quién la cambia", "Who changes it")}</th></tr></thead>
          <tbody>{o.versions.map((v) => <tr key={v.key}><td><Link href={v.href}>{t(v.es, v.en)}</Link>{v.changesInWindow > 1 ? <span className="src block">{t(`cambió ${v.changesInWindow} veces en ${P.patternDays} días`, `changed ${v.changesInWindow} times in ${P.patternDays} days`)}</span> : null}</td><td>{v.version ? <b>v{v.version}</b> : <span className="sig attn">{t("valores iniciales, sin confirmar", "starting values, not confirmed")}</span>}</td><td className="small">{v.since ? i.date(v.since) : "—"}</td><td className="small">{v.by ?? "—"}{v.reason ? <span className="src block">{v.reason}</span> : null}</td><td className="small">{t(v.whoEs, v.whoEn)}</td></tr>)}</tbody>
        </table></div>
        <p className="src">{t("Cada política se cambia en su propia pantalla, como una versión nueva con su motivo. Desde aquí no se editan números de operación.", "Each policy is changed on its own screen, as a new version with its reason. Operating numbers are not edited from here.")} <Link href="/administracion/politicas">{t("Historia completa de versiones", "Full version history")}</Link></p>
      </section>

      <section className="card" id="gerencia"><b>{t("POLÍTICA DE GERENCIA", "MANAGEMENT POLICY")}</b> <span className="small muted">{o.policy.version ? `v${o.policy.version} · ${o.policy.by} · ${o.policy.at ? i.day(o.policy.at) : ""}` : t("valores iniciales, sin confirmar por Gerencia", "starting values, not confirmed by Management")}</span>
        <form action={saveGerenciaPolicy} className="qa-form">
          <div className="qa-row">
            <label style={{ flex: "1 1 280px" }}>{t("Un asunto automático entra a «Decisiones que te esperan» desde este valor en USD. 0 = todos", "An automatic matter enters \"Decisions waiting for you\" from this USD amount. 0 = all")}<input name="decisionMaterialUsd" inputMode="decimal" required defaultValue={P.decisionMaterialUsd} disabled={!ger} /></label>
            <label style={{ flex: "1 1 220px" }}>{t("Máximo de decisiones a la vista en Inicio", "Most decisions shown at once on Home")}<input name="queueMax" inputMode="numeric" required defaultValue={P.queueMax} disabled={!ger} /></label>
          </div>
          <div className="qa-row">
            <label style={{ flex: "1 1 240px" }}>{t("Hay concentración cuando uno solo llega a este %", "There is concentration when a single one reaches this %")}<input name="concentrationPct" inputMode="decimal" required defaultValue={P.concentrationPct} disabled={!ger} /></label>
            <label style={{ flex: "1 1 240px" }}>{t("Un cambio entre dos fotos diarias es material desde este %", "A change between two daily pictures is material from this %")}<input name="changePct" inputMode="decimal" required defaultValue={P.changePct} disabled={!ger} /></label>
          </div>
          <div className="qa-row">
            <label style={{ flex: "1 1 200px" }}>{t("Una excepción se repite si ocurre estas veces", "An exception repeats when it happens this many times")}<input name="patternCount" inputMode="numeric" required defaultValue={P.patternCount} disabled={!ger} /></label>
            <label style={{ flex: "1 1 200px" }}>{t("…dentro de estos días", "…within this many days")}<input name="patternDays" inputMode="numeric" required defaultValue={P.patternDays} disabled={!ger} /></label>
            <label style={{ flex: "1 1 240px" }}>{t("Una carta de función pide revisión a estos días", "A function charter asks for a review after this many days")}<input name="charterReviewDays" inputMode="numeric" required defaultValue={P.charterReviewDays} disabled={!ger} /></label>
          </div>
          <label style={{ maxWidth: 520 }}>{t("Correo a Gerencia cuando el cierre ejecutivo está listo (sin cifras ni nombres, solo conteos y el enlace)", "Email to Management when the executive close is ready (no figures or names, only counts and the link)")}
            <select name="closeEmail" defaultValue={P.closeEmail} disabled={!ger}>
              <option value="WEEKLY">{t("Los lunes: el cierre de la semana que terminó", "On Mondays: the close of the week that ended")}</option>
              <option value="DAILY">{t("Cada día hábil, solo si algo espera (y el lunes el de la semana)", "Every working day, only when something waits (and the week's on Monday)")}</option>
              <option value="OFF">{t("Nunca", "Never")}</option>
            </select></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small">{t("Quién publica la identidad de la compañía y las cartas de función", "Who publishes the company identity and the function charters")}</legend>
            <div className="qa-row">{ROLES.map((r) => <label key={r} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><input type="checkbox" name="publishRoles" value={r} defaultChecked={P.publishRoles.includes(r)} disabled={!ger} style={{ width: "auto" }} />{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</label>)}</div>
          </fieldset>
          {ger ? <><label>{t("Por qué se cambia", "Why it is changed")}<input name="reason" required maxLength={300} /></label><div><button type="submit">{t("Guardar como versión nueva", "Save as a new version")}</button></div></> : <span className="src">{t("Solo Gerencia la cambia.", "Only Management changes it.")}</span>}
        </form>
      </section>
    </>
  );
}
