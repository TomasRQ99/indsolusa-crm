import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { FUNCTIONS, asPairs, canPublish, changedFields, inForce, roleClarity, ROLE_PARTS, type FunctionKey } from "@/lib/gerencia-rules";
import { getGerenciaPolicy, identityInForce } from "@/lib/gerencia-store";
import { AUTHORITY, COMMITMENT_KINDS, COMPETENCY_KINDS, DECISION_KINDS, PERFORMANCE_KINDS, RHYTHM_KINDS, ROLE_DATA_FIELDS, authorityMissing, roleMissing } from "@/lib/team-rules";
import { baseAssignments, grantedByRole, roleData, roleVersions, workPeople } from "@/lib/team-store";
import { Lines, Notes, tOf } from "../../ui";
import { RoleForm } from "../RoleForm";

// Módulo 16 §20–21 · one role agreement: the eighteen fields, its version and the date it is in force from, every
// earlier version, and who holds the role today. Open to every person.

export default async function RolePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ ok?: string; err?: string; f?: string; v?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const { key } = await params;
  const sp = await searchParams;
  const T = today();
  const versions = await roleVersions(key);
  if (!versions.length) notFound();
  const [pol, idn, base, people, granted] = await Promise.all([getGerenciaPolicy(), identityInForce(), baseAssignments(), workPeople(), grantedByRole()]);
  const current = inForce(versions, T);
  const shown = (sp.v ? versions.find((x) => String(x.version) === sp.v) : null) ?? current ?? versions[0];
  const p = roleData(shown);
  const may = canPublish(user.role, pol.value);
  const fn = FUNCTIONS[p.functionKey as FunctionKey];
  const holders = [...base.values()].filter((a) => a.roleProfile?.roleKey === key);
  const name = new Map(people.map((x) => [x.id, x.name]));
  const clarity = roleClarity(p), missing = roleMissing(p);
  const authGap = p.soluRole ? authorityMissing(p.authorityDomains, granted.granted[p.soluRole] ?? []) : [];
  const kinded = (rows: { kind: string; text: string }[], kinds: Record<string, { es: string; en: string }>) => rows.length ? <ul className="plain">{rows.map((r, k) => <li key={k}><span className="sig wait">{tx(kinds[r.kind] ?? { es: r.kind, en: r.kind })}</span> {r.text}</li>)}</ul> : <Lines items={[]} i={i} />;
  const FIELD_NAME: Record<string, string> = { title: t("nombre", "name"), functionKey: t("función", "function"), soluRole: t("rol de acceso", "access role"), critical: t("crítico", "critical"), purpose: t("propósito", "purpose"), outcomes: t("resultados", "outcomes"), functions: t("funciones", "functions"), responsibilities: t("responsabilidades", "responsibilities"), decisionRights: t("qué decide", "decision rights"), authorityDomains: t("autoridad en SOLU", "authority in SOLU"), boundaries: t("límites", "boundaries"), inputs: t("qué recibe", "inputs"), outputs: t("qué entrega", "outputs"), customers: t("clientes", "customers"), qualityStandards: t("calidad", "quality"), behaviors: t("conductas", "behaviours"), methodologies: t("metodologías", "methodologies"), performance: t("desempeño", "performance"), competencies: t("competencias", "competencies"), risks: t("riesgos", "risks"), rhythm: t("ritmo", "rhythm"), successSignals: t("señales de éxito", "success signals"), attentionSignals: t("señales de atención", "attention signals"), careerLevels: t("niveles", "levels"), careerExpectations: t("expectativas de carrera", "career expectations"), companyCommitments: t("compromisos de la compañía", "company commitments") };
  const who = pol.value.publishRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.[i.es ? "es" : "en"] ?? r).join(i.es ? " o " : " or ");
  const ok = { publicada: t("Acuerdo publicado como versión nueva. La anterior queda en la historia y quienes tienen el rol verán que hay expectativas por revisar.", "Agreement published as a new version. The earlier one stays in the history and holders will see there are expectations to review."), igual: t("No hubo cambios frente a la última versión: no se publicó nada.", "No changes against the last version: nothing was published.") };
  const err = { autoridad: t(`Solo ${who} publica un acuerdo de rol.`, `Only ${who} publishes a role agreement.`), faltan: t("Falta lo marcado en rojo: propósito, resultados, responsabilidades, lo que puede decidir, límites, desde cuándo rige y por qué. Las conductas se escriben como algo que se observa, nunca como una calificación. No se publicó nada.", "What is marked in red is missing: purpose, outcomes, responsibilities, decision rights, boundaries, the date it is in force from and why. Behaviours are written as something observable, never as a rating. Nothing was published.") };

  return (
    <div className="eq">
      <div className="ph"><div>
        <div className="crumb"><Link href="/equipo/roles">{t("Acuerdos de rol", "Role agreements")}</Link></div>
        <h1>{p.title}</h1>
        <p id="version">{fn ? tx(fn) : p.functionKey} · <b>v{shown.version}</b> · {t("rige desde", "in force since")} {i.date(shown.effectiveFrom)} · {shown.publishedByName}{shown.id !== current?.id ? <span className="sig wait" style={{ marginLeft: 6 }}>{shown.effectiveFrom > T ? t("aún no rige", "not in force yet") : t("versión anterior", "earlier version")}</span> : <span className="sig ok" style={{ marginLeft: 6 }}>{t("vigente", "in force")}</span>}{p.critical ? <span className="sig info" style={{ marginLeft: 6 }}>{t("rol crítico", "critical role")}</span> : null}</p>
        <p className="small muted">{t("Publicado con la identidad", "Published under identity")} v{shown.identityVersion ?? "—"} {t("y la carta de función", "and function charter")} v{shown.charterVersion ?? "—"} · {shown.reason}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />
      {shown.id !== current?.id && current ? <div className="note">{t("Estás leyendo una versión que no es la vigente.", "You are reading a version that is not the one in force.")} <Link href={`/equipo/roles/${key}`}>{t(`Ver la vigente (v${current.version})`, `See the one in force (v${current.version})`)}</Link></div> : null}
      {!clarity.clear && <div className="note risk">{t("Este rol aún no puede llamarse claro. Falta", "This role cannot be called clear yet. Missing")}: {clarity.missing.map((m) => tx(ROLE_PARTS[m])).join(", ")}.</div>}
      {clarity.clear && missing.length > 0 && <div className="note attn">{t(`${missing.length} de 18 campos por completar`, `${missing.length} of 18 fields to complete`)}: {missing.map((f) => `${f.n}. ${tx(f.label)}`).join(" · ")}</div>}

      <section className="card" id="titulares"><b>{t("QUIÉN TIENE HOY ESTE ROL", "WHO HOLDS THIS ROLE TODAY")}</b> · {holders.length}
        {holders.length === 0 ? <p className="small"><span className="sig attn">{t("nadie", "nobody")}</span> {canManageAll(user) ? <Link href="/equipo/claridad">{t("Asignarlo en Claridad de roles", "Assign it in Role clarity")}</Link> : null}</p> : <ul className="plain">{holders.map((h) => <li key={h.id}>{name.get(h.userId) ?? "—"}{h.level ? ` · ${h.level}` : ""} <span className="src">· {t("desde", "since")} {i.day(h.effectiveFrom)} · {t("asignado bajo la", "assigned under")} v{h.roleProfile?.version}{h.reviewedVersion === current?.version ? ` · ${t("expectativas revisadas", "expectations reviewed")}` : ` · ${t("expectativas por revisar", "expectations to review")}`}</span></li>)}</ul>}
        <p className="src"><Link href="/equipo/continuidad">{t("Respaldos y sucesores de este rol", "Backups and successors of this role")}</Link></p>
      </section>

      <section className="card" id="acuerdo">
        <h3 style={{ marginTop: 0 }}>1 · {t("Propósito", "Purpose")}</h3><p style={{ fontSize: 15 }}><b>{p.purpose}</b></p>
        <div className="eq-cols">
          <div><h3>2 · {t("Resultados esperados", "Expected outcomes")}</h3><Lines items={p.outcomes} i={i} /></div>
          <div><h3>3 · {t("Funciones", "Functions")}</h3><Lines items={p.functions} i={i} /></div>
          <div><h3>4 · {t("Responsabilidades", "Responsibilities")}</h3><Lines items={p.responsibilities} i={i} /></div>
          <div><h3>5 · {t("Qué puede decidir", "Decision rights")}</h3>{kinded(p.decisionRights, DECISION_KINDS)}</div>
          <div><h3>6 · {t("Límites", "Boundaries")}</h3><Lines items={p.boundaries} i={i} /></div>
          <div><h3>{t("Autoridad que necesita en SOLU", "Authority it needs in SOLU")}{p.soluRole ? ` · ${tx(ROLE_LABEL[p.soluRole as keyof typeof ROLE_LABEL] ?? { es: p.soluRole, en: p.soluRole })}` : ""}</h3>
            {p.authorityDomains.length ? <ul className="plain">{p.authorityDomains.map((d) => <li key={d}><span className={`sig ${authGap.includes(d) ? "risk" : "ok"}`}>{authGap.includes(d) ? t("las políticas no se la dan", "policies don't grant it") : p.soluRole ? t("concedida", "granted") : "—"}</span> {AUTHORITY[d] ? tx(AUTHORITY[d]) : d}</li>)}</ul> : <p className="small muted">{t("Ninguna en particular.", "None in particular.")}</p>}</div>
          <div><h3>7 · {t("Qué recibe", "What it receives")}</h3><Lines items={p.inputs} i={i} /></div>
          <div><h3>7 · {t("Qué entrega", "What it delivers")}</h3><Lines items={p.outputs} i={i} /></div>
        </div>
        <h3>8 · {t("Clientes internos y externos", "Internal and external customers")}</h3>{p.customers.length ? <ul className="plain">{p.customers.map((c, k) => <li key={k}><span className="sig wait">{c.kind === "EXTERNAL" ? t("externo", "external") : t("interno", "internal")}</span> <b>{c.who}</b>{c.expects ? `: ${c.expects}` : ""}</li>)}</ul> : <Lines items={[]} i={i} />}
        <h3>9 · {t("Estándares de calidad", "Quality standards")}</h3><Lines items={p.qualityStandards} i={i} />
        <h3>10 · {t("Conductas esperadas: principios aplicados al rol", "Expected behaviours: principles applied to the role")}</h3>{p.behaviors.length ? <ul className="plain">{p.behaviors.map((b, k) => <li key={k}><b>{b.principle}:</b> {b.conduct}</li>)}</ul> : <Lines items={[]} i={i} />}
        {p.methodologies.length > 0 && <><h3>{t("Metodologías", "Methodologies")}</h3><Lines items={p.methodologies} i={i} /></>}
        <div className="eq-cols">
          <div><h3>11 · {t("Expectativas de desempeño", "Performance expectations")}</h3>{kinded(p.performance, PERFORMANCE_KINDS)}</div>
          <div><h3>12 · {t("Competencias requeridas", "Required competencies")}</h3>{kinded(p.competencies, COMPETENCY_KINDS)}</div>
          <div><h3>13 · {t("Riesgos del rol", "Role risks")}</h3><Lines items={p.risks} i={i} /></div>
          <div><h3>14 · {t("Ritmo del rol", "Role rhythm")}</h3>{kinded(p.rhythm, RHYTHM_KINDS)}</div>
          <div><h3>15 · {t("Lo estás haciendo bien cuando…", "You are doing well when…")}</h3><Lines items={p.successSignals} i={i} /></div>
          <div><h3>16 · {t("Necesita atención cuando…", "It needs attention when…")}</h3><Lines items={p.attentionSignals} i={i} /></div>
        </div>
        <h3>17 · {t("Expectativas de carrera", "Career expectations")}</h3>
        {p.careerLevels.length > 0 && <div className="tscroll"><table><thead><tr><th>{t("Nivel", "Level")}</th><th>SER</th><th>HACER</th><th>TENER</th></tr></thead><tbody>{p.careerLevels.map((l) => <tr key={l.name}><td><b>{l.name}</b></td><td className="small">{l.ser || "—"}</td><td className="small">{l.hacer || "—"}</td><td className="small">{l.tener || "—"}</td></tr>)}</tbody></table></div>}
        <Lines items={p.careerExpectations} i={i} />
        <h3>18 · {t("Compromisos de la compañía", "Company commitments")}</h3>{kinded(p.companyCommitments, COMMITMENT_KINDS)}
      </section>

      <section className="card" id="historia"><b>{t("VERSIONES", "VERSIONS")}</b> · {versions.length}
        <ul className="plain">{versions.map((x, k) => { const prev = versions[k + 1]; const ch = prev ? changedFields(roleData(prev) as unknown as Record<string, unknown>, roleData(x) as unknown as Record<string, unknown>, ROLE_DATA_FIELDS) : []; return (
          <li key={x.id}><Link href={`/equipo/roles/${key}?v=${x.version}`}><b>v{x.version}</b></Link>{x.id === current?.id ? <span className="sig ok" style={{ marginLeft: 6 }}>{t("vigente", "in force")}</span> : null} · {t("desde", "from")} {i.date(x.effectiveFrom)} · {x.publishedByName} · {x.reason}
            <span className="src block">{t("identidad", "identity")} v{x.identityVersion ?? "—"} · {t("carta de función", "function charter")} v{x.charterVersion ?? "—"}{prev ? ` · ${ch.length ? t(`cambió frente a v${prev.version}: ${ch.map((f) => FIELD_NAME[f] ?? f).join(", ")}`, `changed against v${prev.version}: ${ch.map((f) => FIELD_NAME[f] ?? f).join(", ")}`) : t("sin cambios frente a la anterior", "no changes against the earlier one")}` : ""}</span></li>
        ); })}</ul>
        <p className="src">{t("Publicar una identidad o una carta de función nueva no cambia estas versiones: cada una conserva con cuál se publicó.", "Publishing a new identity or function charter does not change these versions: each keeps the one it was published under.")}</p>
      </section>

      {may && (
        <details className="card" id="publicar" open={sp.err === "faltan"}><summary><b>{t("Publicar una versión nueva de este acuerdo", "Publish a new version of this agreement")}</b></summary>
          <RoleForm i={i} p={roleData(versions[0])} isNew={false} missing={new Set((sp.f ?? "").split(","))} principles={idn ? asPairs(idn.principles, "name", "meaning").map((x) => x.name) : []} />
        </details>
      )}
    </div>
  );
}
