import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";
import { LEVELS, LEVEL_KEYS, STEPS, type Level } from "@/lib/auth-levels";
import { getAuthPolicy } from "@/lib/auth-levels-store";
import { saveAuthPolicy, setUserLevel } from "./actions";

// Perfil → Configuración → Rangos de autorización. The company's ranges by level and each person's level.
// Everyone can read them; Gerencia changes them, and every change is kept as a version.

export default async function AuthRangesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const edit = isGerencia(user);
  const [pol, people] = await Promise.all([getAuthPolicy(), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, authLevel: true } })]);
  const P = pol.value;
  const cop = (n: number | null) => (n == null ? "—" : `$ ${Math.round(n * P.smlvCop).toLocaleString("es-CO")}`);
  const okMsg: Record<string, string> = { rangos: t("Rangos guardados como una versión nueva. Las autorizaciones ya registradas no cambian.", "Ranges saved as a new version. Authorisations already recorded don't change."), igual: t("No hubo cambios.", "No changes."), nivel: t("Nivel guardado.", "Level saved.") };
  const errMsg: Record<string, string> = { permiso: t("Solo Gerencia cambia los rangos y los niveles.", "Only Management changes the ranges and the levels."), valores: t("Revisa los valores: dentro de cada nivel los topes deben crecer de un paso al siguiente, y el salario mínimo debe ser mayor que cero. No se guardó nada.", "Check the values: within each level the caps must grow from one step to the next, and the minimum wage must be above zero. Nothing was saved.") };

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/profile">{t("Mi perfil", "My profile")}</Link> · {t("Configuración", "Settings")}</div>
        <h1>{t("Rangos de autorización por nivel", "Authorisation ranges by level")}</h1>
        <p>{t("Hasta qué valor de negocio puede autorizar cada persona sola, y quién debe autorizar por encima. Se guardan en salarios mínimos, para que cada año baste con actualizar el salario.", "Up to what business value each person can authorise alone, and who must authorise above it. They are kept in minimum wages, so each year only the wage needs updating.")}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {pol.version === 0 && <div className="note attn">{t("Estos son los rangos de la tabla de 2025. Sirven para empezar; Gerencia debe revisarlos y actualizarlos.", "These are the ranges from the 2025 table. They are a starting point; Management should review and update them.")}</div>}

      <section className="card" id="rangos">
        <b>{t("RANGOS", "RANGES")}</b> <span className="small muted">{pol.version ? t(`versión ${pol.version} · ${pol.by} · ${pol.at ? i.day(pol.at) : ""}`, `version ${pol.version} · ${pol.by} · ${pol.at ? i.day(pol.at) : ""}`) : t("tabla de 2025, sin confirmar", "2025 table, not confirmed")}</span>
        <form action={saveAuthPolicy} className="qa-form" style={{ marginTop: 8 }}>
          <label style={{ maxWidth: 320 }}>{t("Salario mínimo mensual (pesos)", "Monthly minimum wage (pesos)")}<input name="smlvCop" required defaultValue={P.smlvCop.toLocaleString("es-CO")} disabled={!edit} /></label>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Nivel", "Level")}</th><th>{t("Personal hasta", "Personal up to")}</th><th>{t("Compañero de nivel hasta", "Peer up to")}<span className="src block">{t("mentor informado", "mentor informed")}</span></th><th>{t("Compañero superior hasta", "Senior peer up to")}<span className="src block">{t("mentor informado", "mentor informed")}</span></th><th>{t("MMS y mentor hasta", "MMS and mentor up to")}</th><th>{t("Gerencia", "Management")}</th></tr></thead>
            <tbody>{LEVEL_KEYS.map((lv) => { const l = P.ladder[lv]; const cell = (k: "personal" | "peer" | "seniorPeer" | "mmsMentor") => (
              <td key={k}><input name={`${lv}_${k}`} inputMode="decimal" defaultValue={l[k] ?? ""} disabled={!edit} required={k !== "seniorPeer"} aria-label={`${LEVELS[lv].es} ${k}`} style={{ width: 80 }} /> <span className="small muted">SMLV</span><span className="src block mono">{cop(l[k])}</span></td>
            ); return (
              <tr key={lv}><td><b>{t(LEVELS[lv].es, LEVELS[lv].en)}</b></td>{cell("personal")}{cell("peer")}{cell("seniorPeer")}{cell("mmsMentor")}<td className="small">{t("por encima de", "above")} <span className="mono">{cop(l.mmsMentor)}</span></td></tr>
            ); })}</tbody>
          </table></div>
          <span className="src">{t("Socios: cuando hay riesgo relevante, sin importar el valor. Deja vacío «Compañero superior» si ese paso no existe para el nivel.", "Partners: when there is relevant risk, whatever the value. Leave \"Senior peer\" empty if that step doesn't exist for the level.")}</span>
          {edit ? <button type="submit">{t("Guardar rangos", "Save ranges")}</button> : <span className="src">{t("Solo Gerencia los cambia.", "Only Management changes them.")}</span>}
        </form>
      </section>

      <section className="card" id="personas">
        <b>{t("NIVEL DE CADA PERSONA", "EACH PERSON'S LEVEL")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Rol en SOLU", "Role in SOLU")}</th><th>{t("Nivel", "Level")}</th></tr></thead>
          <tbody>{people.map((p) => (
            <tr key={p.id}><td><b>{p.name}</b></td><td className="small">{ROLE_LABEL[p.role]?.[i.es ? "es" : "en"] ?? p.role}</td>
              <td>{edit ? (
                <form action={setUserLevel.bind(null, p.id)} className="qa-row" style={{ alignItems: "center" }}>
                  <select name="authLevel" defaultValue={p.authLevel ?? ""} aria-label={t("Nivel", "Level")}><option value="">{t("Sin nivel", "No level")}</option>{LEVEL_KEYS.map((lv) => <option key={lv} value={lv}>{t(LEVELS[lv].es, LEVELS[lv].en)}</option>)}</select>
                  <button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Guardar", "Save")}</button>
                </form>
              ) : p.authLevel && LEVELS[p.authLevel as Level] ? t(LEVELS[p.authLevel as Level].es, LEVELS[p.authLevel as Level].en) : <span className="muted">{t("Sin nivel", "No level")}</span>}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="src">{t("Quién es mentor o MMS de cada persona no se guarda todavía: al registrar una autorización se escribe el nombre.", "Who is each person's mentor or MMS isn't stored yet: the name is typed when an authorisation is recorded.")} {Object.values(STEPS).map((s) => t(s.es, s.en)).join(" → ")}</p>
      </section>
    </>
  );
}
