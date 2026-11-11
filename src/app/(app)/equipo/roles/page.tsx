import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { FUNCTIONS, FUNCTION_KEYS, asPairs, canPublish, roleClarity } from "@/lib/gerencia-rules";
import { getGerenciaPolicy, identityInForce } from "@/lib/gerencia-store";
import { roleMissing } from "@/lib/team-rules";
import { baseAssignments, roleData, roleVersions, rolesInForce } from "@/lib/team-store";
import { Notes, tOf } from "../ui";
import { RoleForm } from "./RoleForm";

// Módulo 16 §20 · Role agreements. Every person can read every agreement: what a role exists for, what it answers
// for, what it decides and what the company owes it. Only the authority named in the Gerencia policy publishes.

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; f?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const T = today();
  const [all, base, pol, idn] = await Promise.all([roleVersions(), baseAssignments(), getGerenciaPolicy(), identityInForce()]);
  const cur = rolesInForce(all, T);
  const future = [...new Set(all.map((r) => r.roleKey))].filter((k) => !cur.some((r) => r.roleKey === k));
  const may = canPublish(user.role, pol.value);
  const holders = (key: string) => [...base.values()].filter((a) => a.roleProfile?.roleKey === key).length;
  const who = pol.value.publishRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.[i.es ? "es" : "en"] ?? r).join(i.es ? " o " : " or ");
  const ok = {};
  const err = {
    autoridad: t(`Solo ${who} publica un acuerdo de rol.`, `Only ${who} publishes a role agreement.`),
    faltan: t("Falta lo marcado en rojo. Un rol queda claro con su propósito, resultados, responsabilidades, lo que puede decidir y sus límites; además, desde cuándo rige y por qué. Las conductas se escriben como algo que se observa, nunca como una calificación. No se publicó nada.", "What is marked in red is missing. A role is clear with its purpose, outcomes, responsibilities, what it may decide and its boundaries; plus the date it is in force from and why. Behaviours are written as something observable, never as a rating. Nothing was published."),
    existe: t("Ya existe un acuerdo de rol con ese nombre: ábrelo y publica una versión nueva.", "A role agreement with that name already exists: open it and publish a new version."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Acuerdos de rol", "Role agreements")}</h1>
        <p>{t("No es una lista de tareas: es lo que la compañía espera de cada rol y lo que el rol puede esperar de la compañía.", "Not a task list: it is what the company expects of each role and what the role can expect of the company.")}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {cur.length === 0 && <div className="note attn">{t("Aún no hay acuerdos de rol publicados. Mientras tanto, toda persona activa aparece como brecha de claridad de rol.", "No role agreements have been published yet. Meanwhile, every active person shows as a role clarity gap.")} <Link href="/equipo/claridad">{t("Claridad de roles", "Role clarity")}</Link></div>}

      {FUNCTION_KEYS.map((fk) => {
        const rows = cur.filter((r) => r.functionKey === fk);
        if (!rows.length) return null;
        return (
          <section className="card" key={fk} id={`f-${fk}`}><b>{tx(FUNCTIONS[fk]).toUpperCase()}</b> <span className="small muted">{FUNCTIONS[fk].purpose}</span>
            <div className="tscroll"><table>
              <thead><tr><th>{t("Rol", "Role")}</th><th>{t("Versión vigente", "Version in force")}</th><th className="n">{t("Personas", "People")}</th><th>{t("Estado", "State")}</th></tr></thead>
              <tbody>{rows.map((r) => { const d = roleData(r), n = holders(r.roleKey), miss = roleMissing(d).length, clear = roleClarity(d).clear; return (
                <tr key={r.id}><td><Link href={`/equipo/roles/${r.roleKey}`}><b>{r.title}</b></Link>{d.critical ? <span className="sig info" style={{ marginLeft: 6 }}>{t("crítico", "critical")}</span> : null}<span className="src block">{d.purpose}</span></td>
                  <td className="small">v{r.version} · {t("desde", "since")} {i.day(r.effectiveFrom)}</td>
                  <td className="n mono">{n === 0 ? <b className="attn-t">0</b> : n}</td>
                  <td>{!clear ? <span className="sig risk">{t("no está claro", "not clear")}</span> : miss ? <span className="sig attn">{t(`${miss} de 18 por completar`, `${miss} of 18 to complete`)}</span> : <span className="sig ok">{t("completo", "complete")}</span>}</td></tr>
              ); })}</tbody>
            </table></div>
          </section>
        );
      })}
      {future.length > 0 && <p className="small muted">{t("Publicados con fecha futura", "Published with a future date")}: {future.map((k) => <Link key={k} href={`/equipo/roles/${k}`} style={{ marginRight: 10 }}>{all.find((r) => r.roleKey === k)?.title}</Link>)}</p>}

      {may ? (
        <details className="card" id="publicar" open={sp.err === "faltan" || sp.err === "existe" || cur.length === 0}><summary><b>{t("Crear un acuerdo de rol", "Create a role agreement")}</b></summary>
          <RoleForm i={i} p={null} isNew missing={new Set((sp.f ?? "").split(","))} principles={idn ? asPairs(idn.principles, "name", "meaning").map((x) => x.name) : []} />
        </details>
      ) : <p className="src">{t(`Los acuerdos de rol los publica ${who}.`, `Role agreements are published by ${who}.`)}</p>}
    </div>
  );
}
