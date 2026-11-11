import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { gerenciaHome, WATCHED_TEXT } from "@/lib/gerencia-home";
import { DECISION_STAGE } from "@/lib/gerencia-rules";
import { NeededCard, TileCard } from "./ui";

// Módulo 15 §2 · Gerencia Home. Read in under a minute (AC1): what waits for a decision comes first — also the
// first thing on a phone (AC17) — then the pulse of the present, the pulse of the future and where resources are
// exposed. Normal operation is not here (AC2): only matters whose outcome a management decision can change.

type Txt = { es: string; en: string };

export default async function GerenciaHomePage() {
  const user = await requireUser();
  // The Home reads across the company: Gerencia, and Dirección for the context it needs (§13). Everyone else lands
  // on Decisions, where they can ask Gerencia for one and follow theirs.
  if (!canManageAll(user)) redirect("/gerencia/decisiones");
  const i = makeI18n(user.lang);
  const { t } = i;
  const tt = (x: Txt) => t(x.es, x.en);
  const ger = isGerencia(user);
  const h = await gerenciaHome(user);
  const T = today();
  const n = h.needed;
  const quiet = n.shown.length === 0 && h.queue.length === 0 && n.reviewDue.length === 0;

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Gerencia: el presente y la dirección", "Management: the present and the direction")}</h1>
        <p>{quiet ? t("Hoy nada espera una decisión tuya. Lo normal se mueve en silencio.", "Nothing waits for your decision today. What is normal moves silently.") : t(`${n.shown.length + n.later.length} decisión(es) esperan, ${h.queue.length} excepción(es) material(es) y ${n.reviewDue.length} decisión(es) por revisar contra lo que pasó.`, `${n.shown.length + n.later.length} decision(s) waiting, ${h.queue.length} material exception(s) and ${n.reviewDue.length} decision(s) to review against what happened.`)}</p>
        <p className="small">{t("calculado", "as of")} {i.date(h.asOf)} · {t("mes", "month")} <span className="mono">{h.period}</span> ({t("en curso: provisional", "in progress: provisional")}) · <Link href="/gerencia/cierre">{t("Cierre ejecutivo de hoy", "Today's executive close")}</Link></p>
      </div></div>

      <h2 className="gm-h2" id="decisiones">{t("Decisiones que te esperan", "Decisions waiting for you")} <span className="src">{t("solo donde tu autoridad o tu dirección cambia el resultado", "only where your authority or direction changes the outcome")}</span></h2>
      {n.shown.length === 0 ? <div className="card"><span className="sig ok">{t("Nada espera decisión", "Nothing awaits a decision")}</span></div> : n.shown.map((x) => <NeededCard key={x.key} x={x} i={i} now={T} />)}
      {(n.later.length > 0 || n.belowMateriality > 0) && <p className="src">{n.later.length > 0 && <>{t(`Hay ${n.later.length} más en la fila. `, `${n.later.length} more in line. `)}</>}{n.belowMateriality > 0 && <>{t(`${n.belowMateriality} asunto(s) por debajo de USD ${i.n2(n.policy.value.decisionMaterialUsd)} no se muestran aquí: se deciden en su módulo. `, `${n.belowMateriality} matter(s) under USD ${i.n2(n.policy.value.decisionMaterialUsd)} are not shown here: they are decided in their module. `)}</>}<Link href="/gerencia/decisiones">{t("Ver todas", "See all")}</Link></p>}

      {n.reviewDue.length > 0 && (
        <section className="card" id="revisar"><b>{t("DECISIONES POR REVISAR CONTRA LO QUE PASÓ", "DECISIONS TO REVIEW AGAINST WHAT HAPPENED")}</b>
          <ul className="rp-list">{n.reviewDue.map(({ d, s }) => <li key={d.id}><span><b className="mono">{d.code}</b> {d.question}<span className="src block">{t("Se esperaba", "Expected")}: {d.expectedConsequence} · {t("revisar desde", "review from")} {i.date(s.reviewOn)}</span></span><Link href={`/gerencia/decisiones/${d.id}#revision`}>{tt(DECISION_STAGE.REVIEW_DUE)}</Link></li>)}</ul>
        </section>
      )}

      {h.queue.length > 0 && (
        <section className="card" id="excepciones"><b>{t("EXCEPCIONES MATERIALES", "MATERIAL EXCEPTIONS")}</b> <span className="small muted">{t("promesa al cliente, dinero y riesgo: cada una con su impacto y dónde se resuelve", "customer promise, money and risk: each with its impact and where it is resolved")}</span>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Qué pasa", "What is happening")}</th><th className="n">{t("Cuánto pesa", "Impact")}</th><th>{t("Quién lo lleva", "Owner")}</th><th>{t("Qué decidir", "What to decide")}</th></tr></thead>
            <tbody>{h.queue.map((q) => <tr key={q.key}><td><span className="sig attn">{tt(q.kind)}</span> {q.headline}</td><td className="n mono">{q.impact ?? "—"}</td><td className="small">{q.owner ?? "—"}</td><td><Link href={q.href}>{tt(q.decision)}</Link></td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      {h.changes.length > 0 && (
        <div className="note attn" id="cambios"><div><b>{t(`Cambió desde la foto del ${h.since}`, `Changed since the picture of ${h.since}`)}:</b> {h.changes.map((c, k) => <span key={c.key}>{k ? " · " : " "}{tt(WATCHED_TEXT[c.key])} {i.n(c.from)} → {i.n(c.to)}{c.pct != null ? ` (${c.pct > 0 ? "+" : ""}${i.n2(c.pct)} %)` : ""}</span>)}<span className="src block">{t(`Solo se listan cambios de ${i.n2(h.policy.value.changePct)} % o más entre dos fotos diarias.`, `Only changes of ${i.n2(h.policy.value.changePct)} % or more between two daily pictures are listed.`)}</span></div></div>
      )}

      <h2 className="gm-h2" id="presente">{t("Pulso del negocio", "Business pulse")} <span className="src">{t("resultado, caja, cumplimiento, excepciones, recursos y personas: nunca en un solo número", "result, cash, fulfilment, exceptions, resources and people: never in one number")}</span></h2>
      <div className="gm-tiles">{h.business.filter((x) => ger || x.key !== "people").map((x) => <TileCard key={x.key} tile={x} i={i} />)}</div>

      <h2 className="gm-h2" id="futuro">{t("Pulso del futuro", "Future pulse")} <span className="src">{t("conteos y valores en su estado real; sin probabilidades", "counts and amounts in their real state; no probabilities")}</span></h2>
      <div className="gm-tiles">{h.future.map((x) => <TileCard key={x.key} tile={x} i={i} />)}</div>

      <section className="card" id="exposicion"><b>{t("RECURSOS Y RIESGO EXPUESTOS", "RESOURCES AND RISK EXPOSED")}</b> <span className="small muted">{t("siete miradas separadas; SOLU no las suma en una calificación", "seven separate views; SOLU does not add them into a rating")}</span>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Dónde", "Where")}</th><th className="n">{t("Cuánto", "How much")}</th><th>{t("Qué hay detrás", "What is behind it")}</th></tr></thead>
          <tbody>{h.exposure.filter((e) => ger || e.key !== "people").map((e) => <tr key={e.key}><td><Link href={e.href}><b>{tt(e.title)}</b></Link></td><td className="n mono"><span className={e.tone === "risk" ? "risk-t" : e.tone === "attn" ? "attn-t" : ""}>{e.value}</span></td><td className="small">{tt(e.detail)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <p className="src">{t("Cada cifra abre el lugar donde está su evidencia y es la misma que ve el equipo en su módulo. «Hoy» es una foto del momento; lo demás cuenta lo ocurrido en el mes.", "Each figure opens the place where its evidence lives and is the same the team sees in its module. \"Today\" is a snapshot of the moment; the rest counts what happened in the month.")}</p>
    </>
  );
}
