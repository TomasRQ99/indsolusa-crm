import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia, ROLE_LABEL, ROLES } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { FUNCTIONS, FUNCTION_KEYS, GAP_TEXT, ROLE_PARTS, asPairs, asStrings, canPublish, changedFields, charterGaps, roleClarity, type FunctionKey } from "@/lib/gerencia-rules";
import { charterVersions, charterView, chartersInForce, getGerenciaPolicy } from "@/lib/gerencia-store";
import { Notes } from "../ui";
import { publishCharter } from "../gobierno-actions";

// Módulo 15 §23–25 · Function and role governance. Every person reads what each function exists for, what it
// delivers and decides, and who answers for it. Gerencia sees where the structure has a hole: a function with no
// owner, a responsibility written twice, an interface only one side names, responsibility without authority or
// without resources. Role profiles themselves belong to the Team module and are not invented here.

const FIELDS = ["contribution", "outputs", "responsibilities", "decisionRights", "interfaces", "resources", "ownerId"] as const;
/** Which function each SOLU role works in (the access role, until role profiles exist). */
const ROLE_FUNCTION: Record<string, FunctionKey> = { GERENCIA: "GERENCIA", DIRECTOR_COMERCIAL: "COMERCIAL", NEGOCIADOR_COMERCIAL: "COMERCIAL", NEGOCIADOR_OPERATIVO: "OPERACIONES", FINANZAS: "ADMINISTRACION", ADMINISTRACION: "ADMINISTRACION", MARKETING: "MERCADEO" };

export default async function FunctionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; f?: string; fn?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const T = today();
  const manager = canManageAll(user), ger = isGerencia(user);
  const [all, pol, people, assigned] = await Promise.all([
    charterVersions(), getGerenciaPolicy(),
    manager ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }) : [],
    manager ? db.personRoleAssignment.findMany({ where: { effectiveTo: null }, select: { userId: true } }) : [],
  ]);
  const cur = chartersInForce(all, T);
  const may = canPublish(user.role, pol.value);
  const gaps = charterGaps(cur.map(charterView), T, pol.value.charterReviewDays);
  const fname = (k: string) => (k in FUNCTIONS ? t(FUNCTIONS[k as FunctionKey].es, FUNCTIONS[k as FunctionKey].en) : k);
  const NAME: Record<string, string> = { contribution: t("contribución al propósito", "contribution to the purpose"), outputs: t("qué entrega", "what it delivers"), responsibilities: t("responsabilidades", "responsibilities"), decisionRights: t("qué decide", "what it decides"), interfaces: t("interfaces", "interfaces"), resources: t("recursos", "resources"), ownerId: t("dueño", "owner") };
  const miss = new Set((sp.f ?? "").split(","));
  const need = (fn: string, k: string) => (sp.fn === fn && miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const ok = { publicada: t("Carta publicada como versión nueva. La anterior queda en la historia.", "Charter published as a new version. The earlier one stays in the history."), igual: t("No hubo cambios frente a la última versión: no se publicó nada.", "No changes against the last version: nothing was published.") };
  const err = { autoridad: t(`Solo ${pol.value.publishRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.es ?? r).join(" o ")} publica una carta de función.`, `Only ${pol.value.publishRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.en ?? r).join(" or ")} publishes a function charter.`), faltan: t("Falta lo marcado en rojo: desde cuándo rige y por qué cambia. Las interfaces deben nombrar otra de las cinco funciones (Mercadeo, Comercial, Operaciones, Administración, Gerencia). No se publicó nada.", "What is marked in red is missing: since when it is in force and why it changes. Interfaces must name another of the five functions (Marketing, Commercial, Operations, Administration, Management). Nothing was published.") };
  const hasAssign = new Set(assigned.map((a) => a.userId));
  const noFormal = people.filter((p) => !hasAssign.has(p.id));
  // No role profile exists yet (they arrive with the Team module): by the rule of §26 no role can be called clear.
  const clarity = roleClarity(null);

  return (
    <>
      <div className="ph"><div><h1>{t("Funciones y roles", "Functions and roles")}</h1><p>{t("Para qué existe cada función, qué entrega, qué decide por sí misma, qué le entrega a las otras y quién responde por ella.", "What each function exists for, what it delivers, what it decides by itself, what it hands to the others and who answers for it.")}</p></div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {manager && (
        <section className="card" id="huecos"><b>{t("DÓNDE LA ESTRUCTURA TIENE UN HUECO", "WHERE THE STRUCTURE HAS A HOLE")}</b> · {gaps.length}
          {gaps.length === 0 ? <p className="small"><span className="sig ok">{t("Cada función tiene dueño, entregables, autoridad, recursos e interfaces acordadas", "Every function has an owner, deliverables, authority, resources and agreed interfaces")}</span></p> : (
            <ul className="plain">{gaps.map((g, k) => <li key={k}><span className={`sig ${GAP_TEXT[g.kind].tone}`}>{t(GAP_TEXT[g.kind].es, GAP_TEXT[g.kind].en)}</span> <a href={`#f-${g.functionKey}`}><b>{fname(g.functionKey)}</b></a>{g.other ? <> ↔ <a href={`#f-${g.other}`}>{fname(g.other)}</a></> : null}{g.detail ? <span className="src"> · «{g.detail}»</span> : null}</li>)}</ul>
          )}
          <p className="src">{t(`Una carta pide revisión a los ${pol.value.charterReviewDays} días de publicada.`, `A charter asks for a review ${pol.value.charterReviewDays} days after it is published.`)} <Link href="/gerencia/politicas#gerencia">{t("Cambiar", "Change")}</Link></p>
        </section>
      )}

      {FUNCTION_KEYS.map((key) => {
        const c = cur.find((x) => x.functionKey === key);
        const versions = all.filter((x) => x.functionKey === key);
        const v = c ? charterView(c) : null;
        return (
          <section key={key} id={`f-${key}`} className="card">
            <div><b style={{ fontSize: 15 }}>{fname(key)}</b> {c ? <span className="small muted">· v{c.version} · {t("rige desde", "in force since")} {i.date(c.effectiveFrom)} · {c.publishedByName}</span> : <span className="sig risk">{t("sin carta publicada", "no charter published")}</span>}</div>
            <p style={{ margin: "6px 0", fontSize: 15 }}><b>{FUNCTIONS[key].purpose}</b> <span className="src">{t("propósito congelado en los documentos oficiales", "purpose frozen by the official documents")}</span></p>
            {v && c && (
              <dl className="qv-dl">
                <dt>{t("Responde", "Owner")}</dt><dd>{c.owner ? <>{c.owner.name}{!c.owner.active ? <span className="sig risk" style={{ marginLeft: 6 }}>{t("inactivo", "inactive")}</span> : null}</> : <b className="risk-t">{t("Sin dueño", "No owner")}</b>}</dd>
                <dt>{t("Cómo contribuye al propósito", "How it contributes to the purpose")}</dt><dd className="gm-pre">{c.contribution ?? <span className="muted">—</span>}</dd>
                <dt>{t("Qué entrega", "What it delivers")}</dt><dd>{v.outputs.length ? <ul className="plain">{v.outputs.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="muted">{t("Sin definir", "Not defined")}</span>}</dd>
                <dt>{t("Por qué responde", "What it answers for")}</dt><dd>{v.responsibilities.length ? <ul className="plain">{v.responsibilities.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="muted">{t("Sin definir", "Not defined")}</span>}</dd>
                <dt>{t("Qué decide por sí misma", "What it decides by itself")}</dt><dd>{v.decisionRights.length ? <ul className="plain">{v.decisionRights.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="muted">{t("Sin definir", "Not defined")}</span>}</dd>
                <dt>{t("Interfaces", "Interfaces")}</dt><dd>{v.interfaces.length ? <ul className="plain">{v.interfaces.map((x) => <li key={x.name}><b>{fname(x.name)}</b>{x.detail ? `: ${x.detail}` : ""}</li>)}</ul> : <span className="muted">{t("Sin definir", "Not defined")}</span>}</dd>
                <dt>{t("Con qué cuenta", "What it counts on")}</dt><dd className="gm-pre">{c.resources ?? <span className="muted">{t("Sin definir", "Not defined")}</span>}</dd>
              </dl>
            )}
            {versions.length > 1 && <details><summary className="small">{t(`Historia (${versions.length} versiones)`, `History (${versions.length} versions)`)}</summary><ul className="plain small">{versions.map((x, k) => { const prev = versions[k + 1]; const ch = prev ? changedFields(prev as unknown as Record<string, unknown>, x as unknown as Record<string, unknown>, FIELDS) : []; return <li key={x.id}><b>v{x.version}</b> · {t("desde", "from")} {i.date(x.effectiveFrom)} · {x.publishedByName} · {x.reason}{prev ? <span className="src block">{ch.length ? t(`Cambió frente a v${prev.version}: ${ch.map((f) => NAME[f]).join(", ")}`, `Changed against v${prev.version}: ${ch.map((f) => NAME[f]).join(", ")}`) : t("Sin cambios frente a la anterior", "No changes against the earlier one")}</span> : null}</li>; })}</ul></details>}
            {may && (
              <details open={sp.fn === key && sp.err === "faltan"}><summary className="small">{t("Publicar una versión nueva de esta carta", "Publish a new version of this charter")}</summary>
                <form action={publishCharter} className="qa-form">
                  <input type="hidden" name="functionKey" value={key} />
                  <div className="qa-row">
                    <label style={{ flex: "1 1 220px" }}>{t("Quién responde por la función", "Who answers for the function")}<select name="ownerId" defaultValue={c?.ownerId ?? ""}><option value="">{t("Sin dueño", "No owner")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label style={{ flex: "1 1 170px" }}>{t("Rige desde", "In force from")}<input type="date" name="effectiveFrom" required defaultValue={dayInput(T)} {...need(key, "effectiveFrom")} /></label>
                  </div>
                  <label>{t("Cómo contribuye al propósito de la compañía", "How it contributes to the company's purpose")}<input name="contribution" maxLength={1000} defaultValue={c?.contribution ?? ""} /></label>
                  <div className="qa-row" style={{ alignItems: "flex-start" }}>
                    <label style={{ flex: "1 1 280px" }}>{t("Qué entrega, una cosa por línea", "What it delivers, one per line")}<textarea name="outputs" rows={4} maxLength={3000} defaultValue={v?.outputs.join("\n") ?? ""} /></label>
                    <label style={{ flex: "1 1 280px" }}>{t("Por qué responde, una por línea", "What it answers for, one per line")}<textarea name="responsibilities" rows={4} maxLength={4000} defaultValue={v?.responsibilities.join("\n") ?? ""} /></label>
                  </div>
                  <div className="qa-row" style={{ alignItems: "flex-start" }}>
                    <label style={{ flex: "1 1 280px" }}>{t("Qué decide por sí misma, una por línea", "What it decides by itself, one per line")}<textarea name="decisionRights" rows={4} maxLength={4000} defaultValue={v?.decisionRights.join("\n") ?? ""} /></label>
                    <label style={{ flex: "1 1 280px" }}>{t("Interfaces, una por línea (Función: qué se entrega o se necesita)", "Interfaces, one per line (Function: what is handed over or needed)")}<textarea name="interfaces" rows={4} maxLength={3000} placeholder={t("Operaciones: recibe la orden aceptada con su promesa", "Operations: receives the accepted order with its promise")} defaultValue={v ? v.interfaces.map((x) => `${FUNCTIONS[x.name as FunctionKey]?.es ?? x.name}${x.detail ? `: ${x.detail}` : ""}`).join("\n") : ""} {...need(key, "interfaces")} /></label>
                  </div>
                  <label>{t("Con qué cuenta: personas, herramientas, presupuesto", "What it counts on: people, tools, budget")}<textarea name="resources" rows={2} maxLength={1500} defaultValue={c?.resources ?? ""} /></label>
                  <label>{t("Por qué cambia", "Why it changes")}<input name="reason" required maxLength={1000} {...need(key, "reason")} /></label>
                  <div><button type="submit" className="secondary">{t("Publicar como versión nueva", "Publish as a new version")}</button></div>
                </form>
              </details>
            )}
          </section>
        );
      })}

      {manager && (
        <section className="card" id="roles"><b>{t("ROLES: COBERTURA Y CLARIDAD", "ROLES: COVERAGE AND CLARITY")}</b>
          <p className="small"><b>{t("¿Cada persona entiende cómo su rol contribuye a la dirección elegida, y tiene la autoridad, la capacidad y los recursos para cumplirlo?", "Does each person understand how their role contributes to the chosen direction, and have the authority, capacity and resources to fulfil it?")}</b></p>
          <p className="small muted">{t("Hoy SOLU puede responder solo una parte. Un rol se considera claro cuando tiene", "Today SOLU can answer only part of it. A role counts as clear when it has")} {clarity.missing.map((m) => t(ROLE_PARTS[m].es, ROLE_PARTS[m].en)).join(", ")}. {t("Esos perfiles de rol se escriben en el módulo de Equipo, que aún no está construido: por eso ningún rol aparece como claro.", "Those role profiles are written in the Team module, not built yet: that is why no role shows as clear.")}</p>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Rol en SOLU", "Role in SOLU")}</th><th>{t("Función", "Function")}</th><th className="n">{t("Personas", "People")}</th><th>{t("Perfil de rol vigente", "Role profile in force")}</th><th>{t("Conecta con lo que la función entrega", "Connects to what the function delivers")}</th></tr></thead>
            <tbody>{ROLES.map((r) => { const fn = ROLE_FUNCTION[r]; const ch = cur.find((x) => x.functionKey === fn); const n = people.filter((p) => p.role === r).length; return (
              <tr key={r}><td>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</td><td><a href={`#f-${fn}`}>{fname(fn)}</a></td><td className="n mono">{n === 1 ? <b className="attn-t">1</b> : n}</td><td><span className="sig attn">{t("no existe", "none")}</span></td><td>{ch && asStrings(ch.outputs).length ? <span className="sig ok">{t("sí", "yes")}</span> : <span className="sig attn">{t("la función aún no dice qué entrega", "the function doesn't yet say what it delivers")}</span>}</td></tr>
            ); })}</tbody>
          </table></div>
          <ul className="plain small" style={{ marginTop: 8 }}>
            <li>{noFormal.length ? <><span className="sig attn">{t(`${noFormal.length} persona(s) sin cargo formal registrado`, `${noFormal.length} person(s) with no formal position recorded`)}</span> {noFormal.slice(0, 8).map((p) => p.name).join(", ")}{noFormal.length > 8 ? "…" : ""} · <Link href="/administracion/personas">{t("Registrarlo en Administración → Personas", "Record it in Administration → People")}</Link></> : <span className="sig ok">{t("Toda persona activa tiene un cargo formal registrado", "Every active person has a formal position recorded")}</span>}</li>
            <li>{t("Responsabilidades duplicadas y conflictos de quién decide: se detectan hoy entre funciones (arriba). Entre roles, con el módulo de Equipo.", "Duplicated responsibilities and conflicts over who decides: detected today between functions (above). Between roles, with the Team module.")}</li>
            {ger && <li>{t("Posiciones críticas sin respaldo o sucesor:", "Critical positions with no backup or successor:")} <Link href="/gerencia/personas#roles">{t("Personas y capacidad", "People and capacity")}</Link></li>}
            <li>{t("Los principios y valores se mostrarán como conductas esperadas por rol, nunca como una calificación cultural automática.", "Principles and values will be shown as conduct expected per role, never as an automatic culture rating.")} <Link href="/gerencia/identidad">{t("Identidad", "Identity")}</Link></li>
          </ul>
        </section>
      )}
    </>
  );
}
