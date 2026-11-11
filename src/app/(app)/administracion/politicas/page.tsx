import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { getAdminPolicy } from "@/lib/admin-store";
import { POLICY_REGISTER } from "@/lib/policy-register";
import { saveAdminPolicy } from "./actions";

// Módulo 14 §2L · Políticas: one place to see every rule SOLU applies with numbers — which version is in force,
// since when, who set it and why — and where each one is changed. Nothing here is fixed in code.


export default async function PoliciesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  // Everyone sees which version is in force and who set it; the raw values of each version are for the money roles.
  const fin = canFinance(user);
  const [versions, commission, admin] = await Promise.all([
    // Only the policies in the register are read: other settings (such as the worker key) never reach this page.
    db.marketSetting.findMany({ where: { key: { in: POLICY_REGISTER.map((r) => r.key) } }, orderBy: [{ key: "asc" }, { version: "desc" }], select: { key: true, version: true, updatedByName: true, reason: true, createdAt: true, value: true } }),
    db.commissionPolicy.findMany({ orderBy: { version: "desc" }, take: 8, select: { version: true, effectiveFrom: true } }),
    getAdminPolicy(),
  ]);
  const P = admin.value;
  const okMsg: Record<string, string> = { guardada: t("Guardada como una versión nueva, vigente desde ahora. Lo ya decidido conserva la versión con la que se decidió.", "Saved as a new version, in force from now. What was already decided keeps the version it was decided with."), igual: t("No hubo cambios.", "No changes.") };
  const errMsg: Record<string, string> = { gerencia: t("Solo Gerencia cambia esta política.", "Only Management changes this policy."), valores: t("Revisa los valores: días entre 1 y 365, valores en USD de cero o más. No se guardó nada.", "Check the values: days between 1 and 365, USD amounts of zero or more. Nothing was saved."), motivo: t("Escribe por qué se cambia. No se guardó nada.", "Write why it is changed. Nothing was saved.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Políticas", "Policies")}</h1><p>{t("Las reglas con números que SOLU aplica: qué versión rige, desde cuándo, quién la definió y dónde se cambia. Un cambio nunca recalcula lo que ya se decidió.", "The rules with numbers that SOLU applies: which version is in force, since when, who set it and where it is changed. A change never recalculates what was already decided.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="registro"><b>{t("REGISTRO DE POLÍTICAS", "POLICY POLICY_REGISTER")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Política", "Policy")}</th><th>{t("Versión vigente", "Version in force")}</th><th>{t("Desde", "Since")}</th><th>{t("Quién la definió", "Set by")}</th><th>{t("Quién la cambia", "Who changes it")}</th></tr></thead>
          <tbody>
            {POLICY_REGISTER.map((r) => {
              const vs = versions.filter((v) => v.key === r.key);
              const cur = vs[0];
              return (
                <tr key={r.key}><td><Link href={r.href}>{t(r.es, r.en)}</Link>
                  {vs.length > 0 && <details><summary className="small">{t(`Historia (${vs.length})`, `History (${vs.length})`)}</summary><ul className="plain small">{vs.map((v, k) => <li key={v.version}><b>v{v.version}</b> · {i.date(v.createdAt)} → {k === 0 ? t("vigente", "in force") : i.date(vs[k - 1].createdAt)} · {v.updatedByName}{v.reason ? ` · ${v.reason}` : ""}{fin ? <span className="src block mono" style={{ wordBreak: "break-all" }}>{JSON.stringify(v.value).slice(0, 400)}</span> : null}</li>)}</ul></details>}</td>
                  <td>{cur ? <b>v{cur.version}</b> : <span className="sig attn">{t("valores iniciales, sin confirmar", "starting values, not confirmed")}</span>}</td>
                  <td className="small">{cur ? i.date(cur.createdAt) : "—"}</td><td className="small">{cur?.updatedByName ?? "—"}{cur?.reason ? <span className="src block">{cur.reason}</span> : null}</td>
                  <td className="small">{t(r.whoEs, r.whoEn)}</td></tr>
              );
            })}
            <tr><td><Link href="/profile/rentabilidad">{t("Comisiones y reparto Comercial / Operativo", "Commissions and Commercial / Operational split")}</Link>
              {commission.length > 0 && <details><summary className="small">{t(`Historia (${commission.length})`, `History (${commission.length})`)}</summary><ul className="plain small">{commission.map((c) => <li key={c.version}><b>v{c.version}</b> · {t("vigente desde", "in force from")} {i.date(c.effectiveFrom)}</li>)}</ul></details>}</td>
              <td>{commission[0] ? <b>v{commission[0].version}</b> : "—"}</td><td className="small">{commission[0] ? i.date(commission[0].effectiveFrom) : "—"}</td><td className="small">—</td><td className="small">{t("Propuesta + Gerencia", "Proposal + Management")}</td></tr>
          </tbody>
        </table></div>
        <p className="src">{t("Cada versión rige desde el momento en que se guarda hasta que la siguiente la reemplaza. Las aprobaciones, cierres y liquidaciones guardan la versión con la que se hicieron. El motivo se pide desde este módulo: las versiones anteriores pueden no tenerlo.", "Each version is in force from the moment it is saved until the next one replaces it. Approvals, closes and settlements keep the version they were made with. The reason is asked for since this module: earlier versions may not have one.")}</p>
      </section>

      <section className="card" id="admin"><b>{t("POLÍTICA DE ADMINISTRACIÓN", "ADMINISTRATION POLICY")}</b> <span className="small muted">{admin.version ? `v${admin.version} · ${admin.by} · ${admin.at ? i.day(admin.at) : ""}` : t("valores iniciales, sin confirmar por Gerencia", "starting values, not confirmed by Management")}</span>
        <form action={saveAdminPolicy} className="qa-form">
          <div className="qa-row">
            <label>{t("Pedir la decisión de un contrato estos días antes de su fecha de aviso", "Ask for a contract's decision this many days before its notice date")}<input name="obligationLeadDays" inputMode="numeric" required defaultValue={P.obligationLeadDays} disabled={!ger} /></label>
            <label>{t("Materialidad: valor al año (USD) desde el que una obligación interrumpe sola. 0 = todas", "Materiality: yearly amount (USD) from which an obligation interrupts by itself. 0 = all")}<input name="materialityUsd" inputMode="decimal" required defaultValue={P.materialityUsd} disabled={!ger} /></label>
          </div>
          <div className="qa-row">
            <label>{t("Diferencia (USD) entre orden, recibo y factura que se acepta sin excepción", "Difference (USD) between order, receipt and invoice accepted without an exception")}<input name="apToleranceUsd" inputMode="decimal" required defaultValue={P.apToleranceUsd} disabled={!ger} /></label>
            <label>{t("Máximo de días de una autoridad prestada, por versión", "Longest time for a lent authority, per version")}<input name="delegationMaxDays" inputMode="numeric" required defaultValue={P.delegationMaxDays} disabled={!ger} /></label>
          </div>
          {ger ? <><label>{t("Por qué se cambia", "Why it is changed")}<input name="reason" required maxLength={300} /></label><div><button type="submit">{t("Guardar como versión nueva", "Save as a new version")}</button></div></> : <span className="src">{t("Solo Gerencia la cambia.", "Only Management changes it.")}</span>}
        </form>
      </section>
    </>
  );
}
