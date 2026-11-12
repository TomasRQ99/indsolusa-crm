import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { AREAS, DECISION_KINDS, DECISION_STAGE, decisionStage } from "@/lib/gerencia-rules";
import { decisionInclude, decisionScope, decisionsNeeded } from "@/lib/gerencia-store";
import { NeededCard, Notes } from "../ui";
import { requestDecision } from "./actions";

// Módulo 15 §2C, §4 · Decisions. For Gerencia: everything that waits for its authority, and the record of what was
// decided. For everyone: asking Gerencia for a decision with what it needs to decide well, and following the answer.

type SP = { ok?: string; err?: string; f?: string; ver?: string; pregunta?: string; href?: string; label?: string; area?: string; escenario?: string };

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manager = canManageAll(user), ger = isGerencia(user);
  const T = today();
  const all = sp.ver === "todas";
  const [needed, rows, scenario] = await Promise.all([
    decisionsNeeded(user),
    db.managementDecision.findMany({ where: { ...decisionScope(user), ...(all ? {} : { supersededAt: null, status: { not: "WITHDRAWN" } }) }, orderBy: [{ requestedAt: "desc" }], include: decisionInclude, take: 200 }),
    sp.escenario ? db.scenario.findFirst({ where: { id: sp.escenario, status: "OPEN" }, select: { id: true, title: true, question: true, facts: true, options: true } }) : null,
  ]);
  const staged = rows.map((d) => ({ d, s: decisionStage(d, T) }));
  const mine = staged.filter((x) => x.d.requestedById === user.id && x.d.status === "REQUESTED" && !x.d.supersededAt);
  const register = staged.filter((x) => x.d.status !== "REQUESTED");
  const queue = [...needed.shown, ...needed.later];
  const miss = new Set((sp.f ?? "").split(","));
  const need = (k: string) => (miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const scenOptions = scenario ? (Array.isArray(scenario.options) ? (scenario.options as { name?: string; description?: string }[]) : []).map((o) => `${o.name ?? ""}${o.description ? `: ${o.description}` : ""}`).join("\n") : "";
  const ok = { pedida: t("Decisión pedida. Gerencia la ve en su Inicio.", "Decision requested. Management sees it on its Home.") };
  const err = { faltan: t("Falta lo marcado en rojo. Para decidir bien, Gerencia necesita la pregunta, el contexto, cuánto pesa, los hechos y al menos dos opciones (no hacer nada cuenta como una). No se guardó nada.", "What is marked in red is missing. To decide well, Management needs the question, the context, the impact, the facts and at least two options (doing nothing counts as one). Nothing was saved."), "no-existe": t("Esa decisión no existe.", "That decision doesn't exist.") };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Decisiones", "Decisions")}</h1>
        <p>{manager ? t("Lo que espera una decisión de dirección, y el registro de lo decidido: qué se decidió, por qué, con qué autoridad, qué se esperaba y qué pasó de verdad.", "What awaits a direction decision, and the record of what was decided: what, why, under which authority, what was expected and what really happened.") : t("Pide a Gerencia una decisión cuando algo supera lo que tú puedes resolver, y sigue aquí la respuesta.", "Ask Management for a decision when something is beyond what you can resolve, and follow the answer here.")}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {manager && (
        <>
          <h2 className="gm-h2" id="esperan">{t("Esperan decisión", "Awaiting a decision")} · {queue.length}</h2>
          {queue.length === 0 ? <div className="card"><span className="sig ok">{t("Nada espera decisión", "Nothing awaits a decision")}</span></div> : queue.map((x) => <NeededCard key={x.key} x={x} i={i} now={T} />)}
          {needed.belowMateriality > 0 && <p className="src">{t(`${needed.belowMateriality} asunto(s) por debajo de USD ${i.n2(needed.policy.value.decisionMaterialUsd)} se deciden en su módulo y no aparecen aquí.`, `${needed.belowMateriality} matter(s) under USD ${i.n2(needed.policy.value.decisionMaterialUsd)} are decided in their module and don't appear here.`)} <Link href="/gerencia/politicas#gerencia">{t("Cambiar ese valor", "Change that amount")}</Link></p>}
        </>
      )}

      {mine.length > 0 && (
        <section className="card" id="mias"><b>{t("LO QUE PEDISTE Y SIGUE ESPERANDO", "WHAT YOU ASKED FOR AND STILL WAITS")}</b>
          <ul className="rp-list">{mine.map(({ d, s }) => <li key={d.id}><span><b className="mono">{d.code}</b> {d.question}<span className="src block">{t("pedida el", "asked on")} {i.day(d.requestedAt)}{d.deadline ? ` · ${t("se necesita antes del", "needed before")} ${i.date(d.deadline)}` : ""}</span></span><Link href={`/gerencia/decisiones/${d.id}`}><span className={`sig ${DECISION_STAGE[s.stage].tone}`}>{t(DECISION_STAGE[s.stage].es, DECISION_STAGE[s.stage].en)}</span></Link></li>)}</ul>
        </section>
      )}

      <section className="card" id="registro"><b>{t("REGISTRO DE DECISIONES", "DECISION RECORD")}</b> <span className="small muted">{manager ? "" : t("las que pediste o quedaron a tu cargo", "those you asked for or were left in your care")}</span>
        {register.length === 0 ? <p className="small muted">{t("Aún no hay decisiones registradas.", "No decisions recorded yet.")} <a href="#pedir">{t("Pedir una decisión", "Ask for a decision")} →</a></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Decisión", "Decision")}</th><th>{t("Qué se decidió", "What was decided")}</th><th>{t("Autoridad", "Authority")}</th><th>{t("Seguimiento", "Follow-up")}</th><th>{t("Estado", "State")}</th></tr></thead>
            <tbody>{register.map(({ d, s }) => (
              <tr key={d.id}>
                <td><Link href={`/gerencia/decisiones/${d.id}`}><b className="mono">{d.code}</b>{d.version > 1 ? ` v${d.version}` : ""}</Link> <span className="sig wait">{t(AREAS[d.area]?.es ?? d.area, AREAS[d.area]?.en ?? d.area)}</span><span className="block">{d.question}</span></td>
                <td className="small">{d.status === "WITHDRAWN" ? d.withdrawnNote : d.decision}</td>
                <td className="small">{d.decidedByName ?? "—"}{d.authority ? <span className="src block">{d.authority}</span> : null}{d.decidedAt ? <span className="src block">{i.day(d.decidedAt)}</span> : null}</td>
                <td className="small">{d.ownerAfter?.name ?? "—"}{s.reviewOn ? <span className="src block">{t("revisar el", "review on")} {i.date(s.reviewOn)}</span> : null}</td>
                <td><span className={`sig ${DECISION_STAGE[s.stage].tone}`}>{t(DECISION_STAGE[s.stage].es, DECISION_STAGE[s.stage].en)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small">{all ? <Link href="/gerencia/decisiones">{t("Ocultar versiones reemplazadas y retiradas", "Hide replaced versions and withdrawn ones")}</Link> : <Link href="/gerencia/decisiones?ver=todas">{t("Ver también versiones reemplazadas y retiradas", "Also show replaced versions and withdrawn ones")}</Link>}</p>
        <p className="src">{t("Una decisión tomada no se edita ni se borra. Si cambia, se escribe una versión nueva con su motivo y la anterior queda a la vista.", "A decision made is never edited or deleted. If it changes, a new version is written with its reason and the earlier one stays visible.")}</p>
      </section>

      <section className="card" id="pedir">
        <b>{ger ? t("ABRIR UNA DECISIÓN", "OPEN A DECISION") : t("PEDIR UNA DECISIÓN A GERENCIA", "ASK MANAGEMENT FOR A DECISION")}</b>
        <p className="small muted">{t("Escribe lo que Gerencia necesita para decidir sin tener que preguntarte. Lo que sabes va en Hechos; lo que crees, en Supuestos.", "Write what Management needs to decide without having to ask you. What you know goes in Facts; what you believe, in Assumptions.")}</p>
        <form action={requestDecision} className="qa-form">
          {scenario && <><input type="hidden" name="scenarioId" value={scenario.id} /><p className="small"><span className="sig info">{t("Sale del escenario", "From scenario")}</span> <Link href={`/gerencia/escenarios#s-${scenario.id}`}>{scenario.title}</Link></p></>}
          <div className="qa-row">
            <label style={{ flex: "1 1 180px" }}>{t("Función", "Function")}<select name="area" required defaultValue={sp.area && sp.area in AREAS ? sp.area : ""} {...need("area")}><option value="" disabled>{t("Elegir", "Choose")}</option>{Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
            <label style={{ flex: "1 1 220px" }}>{t("Tipo", "Kind")}<select name="kind" defaultValue="GENERAL">{Object.entries(DECISION_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
            <label style={{ flex: "1 1 160px" }}>{t("Se necesita antes del", "Needed before")}<input type="date" name="deadline" /></label>
          </div>
          <label>{t("La pregunta, en una frase", "The question, in one sentence")}<input name="question" required maxLength={300} defaultValue={sp.pregunta ?? scenario?.question ?? ""} {...need("question")} /></label>
          <label>{t("Contexto: qué está pasando", "Context: what is happening")}<textarea name="context" required rows={3} maxLength={2000} {...need("context")} /></label>
          <label>{t("Por qué ahora", "Why now")}<input name="whyNow" maxLength={500} /></label>
          <div className="qa-row">
            <label style={{ flex: "3 1 320px" }}>{t("Cuánto pesa: en dinero, para el cliente o para la dirección de la empresa", "Impact: in money, for the customer or for the company's direction")}<input name="impact" required maxLength={500} {...need("impact")} /></label>
            <label style={{ flex: "1 1 140px" }}>{t("Valor en USD, si lo hay", "USD amount, if any")}<input name="impactUsd" inputMode="decimal" /></label>
          </div>
          <label>{t("Opciones consideradas, una por línea (Nombre: detalle). Mínimo dos", "Options considered, one per line (Name: detail). At least two")}<textarea name="alternatives" required rows={4} maxLength={4000} defaultValue={scenOptions} placeholder={t("Aceptar: …\nNo aceptar: …", "Accept: …\nDon't accept: …")} {...need("alternatives")} /></label>
          <div className="qa-row" style={{ alignItems: "flex-start" }}>
            <label style={{ flex: "1 1 280px" }}>{t("Hechos y evidencia (lo que se sabe)", "Facts and evidence (what is known)")}<textarea name="facts" required rows={4} maxLength={3000} defaultValue={scenario?.facts ?? ""} {...need("facts")} /></label>
            <label style={{ flex: "1 1 280px" }}>{t("Supuestos (lo que se cree)", "Assumptions (what is believed)")}<textarea name="assumptions" rows={4} maxLength={2000} /></label>
          </div>
          <div className="qa-row" style={{ alignItems: "flex-start" }}>
            <label style={{ flex: "1 1 280px" }}>{t("Riesgos y lo que se sacrifica con cada opción", "Risks and what each option gives up")}<textarea name="risks" rows={3} maxLength={2000} /></label>
            <label style={{ flex: "1 1 280px" }}>{t("Tu recomendación, si tienes una", "Your recommendation, if you have one")}<textarea name="recommendation" rows={3} maxLength={1000} /></label>
          </div>
          <div className="qa-row">
            <label style={{ flex: "1 1 240px" }}>{t("Registro de SOLU del que trata (dirección que empieza por /)", "SOLU record it is about (address starting with /)")}<input name="sourceHref" maxLength={300} defaultValue={sp.href ?? ""} placeholder="/deals/…" /></label>
            <label style={{ flex: "1 1 200px" }}>{t("Nombre de ese registro", "Name of that record")}<input name="sourceLabel" maxLength={160} defaultValue={sp.label ?? ""} /></label>
          </div>
          <div><button type="submit">{ger ? t("Abrir la decisión", "Open the decision") : t("Pedir la decisión", "Ask for the decision")}</button></div>
        </form>
      </section>
    </>
  );
}
