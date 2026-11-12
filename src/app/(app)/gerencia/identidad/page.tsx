import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { asPairs, asStrings, canPublish, changedFields, inForce, pairsText } from "@/lib/gerencia-rules";
import { getGerenciaPolicy, identityVersions } from "@/lib/gerencia-store";
import { ROLE_LABEL } from "@/lib/permissions";
import { Notes } from "../ui";
import { publishIdentity } from "../gobierno-actions";

// Módulo 15 §22 · Who the company says it is. Every person reads the identity in force. Only the configured
// authority publishes a new version, with its date, its reason and who approved it (§26); earlier versions stay
// readable and can be compared with the current one.

const FIELDS = ["purpose", "slogan", "valueProposition", "attributes", "principles", "methodologies"] as const;

export default async function IdentityPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; f?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const T = today();
  const [all, pol] = await Promise.all([identityVersions(), getGerenciaPolicy()]);
  const cur = inForce(all, T);
  const may = canPublish(user.role, pol.value);
  const upcoming = all.filter((v) => v.effectiveFrom > T);
  const NAME: Record<string, string> = { purpose: t("propósito", "purpose"), slogan: t("lema", "slogan"), valueProposition: t("propuesta de valor", "value proposition"), attributes: t("atributos", "attributes"), principles: t("principios y valores", "principles and values"), methodologies: t("metodologías", "methodologies") };
  const miss = new Set((sp.f ?? "").split(","));
  const need = (k: string) => (miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const ok = { publicada: t("Versión publicada. La anterior queda en la historia.", "Version published. The earlier one stays in the history."), igual: t("No hubo cambios frente a la última versión: no se publicó nada.", "No changes against the last version: nothing was published.") };
  const err = { autoridad: t(`Solo ${pol.value.publishRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.es ?? r).join(" o ")} publica la identidad.`, `Only ${pol.value.publishRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.en ?? r).join(" or ")} publishes the identity.`), faltan: t("Falta lo marcado en rojo: propósito, lema, propuesta de valor, al menos un atributo y un principio, desde cuándo rige y por qué cambia. No se publicó nada.", "What is marked in red is missing: purpose, slogan, value proposition, at least one attribute and one principle, since when it is in force and why it changes. Nothing was published.") };
  const principles = cur ? asPairs(cur.principles, "name", "meaning") : [], methods = cur ? asPairs(cur.methodologies, "name", "description") : [];

  return (
    <>
      <div className="ph"><div><h1>{t("Identidad de la compañía", "Company identity")}</h1><p>{t("Para qué existimos, qué ofrecemos y cómo nos comportamos. Es el punto de partida de cada función y de cada rol.", "Why we exist, what we offer and how we behave. It is the starting point of every function and every role.")}</p></div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {!cur ? <div className="card"><p className="small muted">{t("Aún no hay una identidad vigente.", "No identity is in force yet.")} <a href="#publicar">{t("Publicar la identidad", "Publish the identity")} →</a></p></div> : (
        <section className="card gm-idn" id="vigente">
          <span className="small muted">{t("Propósito", "Purpose")}</span>
          <h2>{cur.purpose}</h2>
          <p><b>{cur.slogan}</b></p>
          <dl className="qv-dl" style={{ marginTop: 10 }}>
            <dt>{t("Propuesta de valor", "Value proposition")}</dt><dd className="gm-pre">{cur.valueProposition}</dd>
            <dt>{t("Atributos", "Attributes")}</dt><dd><div className="gm-chips">{asStrings(cur.attributes).map((a) => <span key={a}>{a}</span>)}</div></dd>
            <dt>{t("Principios y valores", "Principles and values")}</dt><dd><ul className="plain">{principles.map((p) => <li key={p.name}><b>{p.name}</b>{p.detail ? `: ${p.detail}` : ""}</li>)}</ul>{principles.some((p) => !p.detail) ? <span className="src block">{t("Los que no tienen texto al lado todavía no dicen qué conducta se espera. Se muestran como conductas por rol, nunca como una calificación de la persona.", "Those with no text beside them don't yet say which conduct is expected. They are shown as conduct per role, never as a rating of the person.")}</span> : null}</dd>
            <dt>{t("Metodologías", "Methodologies")}</dt><dd>{methods.length ? <ul className="plain">{methods.map((m) => <li key={m.name}><b>{m.name}</b>{m.detail ? `: ${m.detail}` : ""}</li>)}</ul> : <span className="muted">{t("Ninguna publicada todavía", "None published yet")}</span>}</dd>
          </dl>
          <p className="src" style={{ marginTop: 10 }}>{t(`Versión ${cur.version} · rige desde el ${i.date(cur.effectiveFrom)} · aprobó ${cur.approvedByName}`, `Version ${cur.version} · in force since ${i.date(cur.effectiveFrom)} · approved by ${cur.approvedByName}`)} · {cur.reason}</p>
        </section>
      )}
      {upcoming.map((v) => <div key={v.id} className="note attn">{t(`La versión ${v.version} ya está publicada y empieza a regir el ${i.date(v.effectiveFrom)}.`, `Version ${v.version} is already published and comes into force on ${i.date(v.effectiveFrom)}.`)}</div>)}

      {all.length > 1 && (
        <section className="card" id="historia"><b>{t("HISTORIA: VIGENTE FRENTE A ANTERIORES", "HISTORY: CURRENT AGAINST EARLIER")}</b>
          <ul className="plain">{all.map((v, k) => { const prev = all[k + 1]; const ch = prev ? changedFields(prev as unknown as Record<string, unknown>, v as unknown as Record<string, unknown>, FIELDS) : []; return (
            <li key={v.id} style={{ marginBottom: 8 }}><b>v{v.version}</b>{cur?.id === v.id ? <span className="sig ok" style={{ marginLeft: 6 }}>{t("vigente", "in force")}</span> : null} · {t("desde", "from")} {i.date(v.effectiveFrom)} · {v.approvedByName} · {v.reason}
              {prev ? <span className="src block">{ch.length ? t(`Cambió frente a v${prev.version}: ${ch.map((c) => NAME[c]).join(", ")}`, `Changed against v${prev.version}: ${ch.map((c) => NAME[c]).join(", ")}`) : t("Sin cambios de texto frente a la anterior", "No text changes against the earlier one")}</span> : null}
              {cur?.id !== v.id && <details><summary className="small">{t("Leer esta versión", "Read this version")}</summary><dl className="qv-dl"><dt>{NAME.purpose}</dt><dd>{v.purpose}</dd><dt>{NAME.slogan}</dt><dd>{v.slogan}</dd><dt>{NAME.valueProposition}</dt><dd className="gm-pre">{v.valueProposition}</dd><dt>{NAME.attributes}</dt><dd>{asStrings(v.attributes).join(" · ")}</dd><dt>{NAME.principles}</dt><dd className="gm-pre">{pairsText(asPairs(v.principles, "name", "meaning"))}</dd><dt>{NAME.methodologies}</dt><dd className="gm-pre">{pairsText(asPairs(v.methodologies, "name", "description")) || "—"}</dd></dl></details>}
            </li>
          ); })}</ul>
        </section>
      )}

      {may && (
        <section className="card" id="publicar"><b>{t("PUBLICAR UNA VERSIÓN NUEVA", "PUBLISH A NEW VERSION")}</b>
          <p className="small muted">{t("Parte del texto vigente. Al publicar no se borra nada: la versión actual queda en la historia.", "It starts from the text in force. Publishing deletes nothing: the current version stays in the history.")}</p>
          <form action={publishIdentity} className="qa-form">
            <label>{t("Propósito", "Purpose")}<input name="purpose" required maxLength={300} defaultValue={cur?.purpose ?? ""} {...need("purpose")} /></label>
            <label>{t("Lema", "Slogan")}<input name="slogan" required maxLength={300} defaultValue={cur?.slogan ?? ""} {...need("slogan")} /></label>
            <label>{t("Propuesta de valor", "Value proposition")}<textarea name="valueProposition" required rows={3} maxLength={2000} defaultValue={cur?.valueProposition ?? ""} {...need("valueProposition")} /></label>
            <label>{t("Atributos, uno por línea", "Attributes, one per line")}<textarea name="attributes" required rows={5} maxLength={3000} defaultValue={cur ? asStrings(cur.attributes).join("\n") : ""} {...need("attributes")} /></label>
            <label>{t("Principios y valores, uno por línea (Nombre: la conducta que se espera)", "Principles and values, one per line (Name: the conduct expected)")}<textarea name="principles" required rows={6} maxLength={4000} defaultValue={pairsText(principles)} {...need("principles")} /></label>
            <label>{t("Metodologías corporativas, una por línea (Nombre: para qué se usa)", "Corporate methodologies, one per line (Name: what it is used for)")}<textarea name="methodologies" rows={3} maxLength={4000} defaultValue={pairsText(methods)} /></label>
            <div className="qa-row">
              <label style={{ flex: "1 1 170px" }}>{t("Rige desde", "In force from")}<input type="date" name="effectiveFrom" required defaultValue={dayInput(T)} {...need("effectiveFrom")} /></label>
              <label style={{ flex: "3 1 320px" }}>{t("Por qué cambia", "Why it changes")}<input name="reason" required maxLength={1000} {...need("reason")} /></label>
            </div>
            <div><button type="submit">{t("Publicar como versión nueva", "Publish as a new version")}</button></div>
          </form>
        </section>
      )}
    </>
  );
}
