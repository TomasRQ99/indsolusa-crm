import { db } from "@/lib/db";
import { CONFIDENCE } from "@/lib/market-rules";
import { CTX_GROUPS, impactSentence, inheritedContext, needSuggestions, type CtxGroup } from "@/lib/need-handoff";
import { confirmNeed, dismissNeed } from "./need-actions";

type T = (es: string, en: string) => string;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** M6 (§12.2): "This looks like a concrete need. Do you want to create a Necessity?" — a person confirms. */
export default async function NeedSuggestions({ scope, back, t, day, user, sp }: { scope: { accountIds?: string[]; contactId?: string }; back: string; t: T; day: (d: Date) => string; user: { id: string; role: string }; sp?: { ok?: string; err?: string } }) {
  const list = (await needSuggestions(scope)).slice(0, 3);
  const notice = sp?.ok === "descartada" ? t("Entendido. SOLU no lo volverá a sugerir; la evidencia queda donde se anotó.", "Understood. SOLU won't suggest it again; the evidence stays where it was recorded.")
    : sp?.err === "need" ? t("Para crear la necesidad hace falta un título.", "A title is needed to create the need.")
    : sp?.err === "owner" ? t("Elige quién la trabajará comercialmente.", "Choose who will work it commercially.")
    : sp?.err === "ya" ? t("Esta Necesidad ya fue creada.", "This Necessity was already created.") : null;
  if (!list.length) return notice ? <p className="note okn" id="necesidad">{notice}</p> : null;
  const owners = await db.user.findMany({ where: { active: true, role: { not: "MARKETING" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const defOwner = user.role === "MARKETING" ? (owners[0]?.id ?? "") : user.id;
  const ctxs = await Promise.all(list.map((s) => inheritedContext({ accountId: s.accountId, plantId: s.plantId, contactId: s.contactId, explorationId: s.explorationId, originRef: s.ref, evidence: s.evidence })));

  return (
    <section className="mk-sec" id="necesidad">
      {notice && <p className="note attn">{notice}</p>}
      {list.map((s, k) => {
        const ctx = ctxs[k];
        const groups = [...new Set(ctx.items.map((x) => x.group))].filter((g) => g !== "WHAT") as CtxGroup[];
        const conf = CONFIDENCE[s.confidence];
        return (
          <div key={s.ref} className="card">
            <b>{t("Esto parece una necesidad concreta. ¿Quieres crear una Necesidad?", "This looks like a concrete need. Do you want to create a Necessity?")}</b>
            <p className="small">{t(s.why.es, s.why.en)}</p>
            <p className="small">«{s.evidence}»<span className="src block"><span className={`sig ${conf?.cls ?? "info"}`}>{conf ? t(conf.es, conf.en) : s.confidence}</span> {s.accountName}{s.contactName ? ` · ${s.contactName}` : ""}{s.plantName ? ` · ${s.plantName}` : ""}{s.sourceRef ? ` · ${s.sourceRef}` : ""} · {day(s.observedAt)}</span></p>
            <p className="small">{t("Al confirmar, la Necesidad nace con:", "When confirmed, the Necessity is born with:")} {groups.map((g) => t(CTX_GROUPS[g].es, CTX_GROUPS[g].en)).join(" · ") || t("solo la evidencia (aún sabemos poco)", "the evidence only (we still know little)")}. {t("Nada se vuelve a escribir.", "Nothing is retyped.")}</p>
            <details>
              <summary className="small">{t("Revisar y confirmar", "Review and confirm")}</summary>
              <form action={confirmNeed} className="stack">
                {[["accountId", s.accountId], ["contactId", s.contactId], ["plantId", s.plantId], ["explorationId", s.explorationId], ["originRef", s.ref], ["evidence", s.evidence], ["back", back]].map(([n, v]) => v ? <input key={n} type="hidden" name={n!} value={v} /> : null)}
                <label>{t("Necesidad (en palabras del cliente)", "Need (in the customer's words)")}<input name="title" maxLength={200} defaultValue={s.title} required /></label>
                <label>{t("Resultado deseado: ¿qué tiene que pasar para que esté resuelto?", "Desired result: what has to happen for it to be solved?")}<input name="desiredResult" maxLength={300} defaultValue={s.desiredResult} /></label>
                <label>{t("No resolverlo cuesta", "Not solving it costs")}<input name="impactIfNot" maxLength={400} defaultValue={impactSentence(ctx) ?? ""} placeholder={t("Aún no lo sabemos: conviene preguntarlo", "We don't know yet: worth asking")} /></label>
                <div className="row">
                  <label>{t("Lo necesitan para", "Needed by")}<input type="date" name="neededBy" defaultValue={iso(s.neededBy)} /></label>
                  <label style={{ flex: 1 }}>{t("Quién lo trabaja", "Who works it")}<select name="ownerId" defaultValue={defOwner}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                </div>
                <div className="row">
                  <label style={{ flex: 1 }}>{t("Siguiente movimiento útil", "Next useful move")}<input name="nextMove" maxLength={200} defaultValue={s.nextMove ?? ""} placeholder={t("Ej.: confirmar con Jorge el modelo exacto y la fecha de la parada", "E.g.: confirm the exact model and shutdown date with Jorge")} /></label>
                  <label>{t("Para cuándo", "By when")}<input type="date" name="nextMoveDate" /></label>
                </div>
                <details><summary className="small">{t(`Ver los ${ctx.items.length} datos que se heredan, con su fuente`, `See the ${ctx.items.length} inherited facts, with their source`)}</summary>
                  <ul className="mk-ul">{ctx.items.map((x, j) => <li key={j} className="small"><span className="mk-chip">{t(CTX_GROUPS[x.group].es, CTX_GROUPS[x.group].en)}</span> {x.text}</li>)}</ul>
                </details>
                <div><button type="submit">{t("Confirmar y crear la Necesidad", "Confirm and create the Necessity")}</button></div>
              </form>
            </details>
            <form action={dismissNeed} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="originRef" value={s.ref} /><input type="hidden" name="accountId" value={s.accountId} /><input type="hidden" name="back" value={back} />
              <input name="note" maxLength={300} placeholder={t("Por qué no (opcional)", "Why not (optional)")} style={{ flex: 1 }} />
              <button type="submit" className="link small">{t("No es una necesidad", "Not a need")}</button>
            </form>
          </div>
        );
      })}
    </section>
  );
}
