import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { ensureValueCatalog } from "@/lib/solution";
import { ATTR_STATUS } from "@/lib/proposal-rules";
import { saveAttribute } from "./actions";

// Comercial C5 §17 · Industry Solutions value attributes (decision C-14: 8 drafts, evidence per case).
export default async function ValuePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  await ensureValueCatalog();
  const attrs = await db.valueAttribute.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { claims: true } } } });
  const used = await db.valueClaim.groupBy({ by: ["attributeId"], where: { hidden: false, evidence: { not: null } }, _count: { _all: true } });
  const withEv = new Map(used.map((u) => [u.attributeId, u._count._all]));
  const manage = canManageAll(user);
  const okMsg: Record<string, string> = { guardado: t("Atributo guardado.", "Attribute saved.") };
  const errMsg: Record<string, string> = {
    permiso: t("Solo Gerencia o la Dirección Comercial editan el catálogo.", "Only Management or the Commercial Director edit the catalog."),
    campos: t("Nombre y definición en los dos idiomas son obligatorios.", "Name and definition in both languages are required."),
    atributo: t("Ese atributo no existe.", "That attribute doesn't exist."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Atributos de valor", "Value attributes")}</h1>
          <p>{t("Lo que Industry Solutions puede aportar. No se muestran por defecto: cada Journey elige los que puede probar con evidencia de ese caso. Los ocho vienen en borrador para que la dirección los revise.", "What Industry Solutions can bring. They're not shown by default: each Journey picks the ones it can prove with evidence from that case. All eight start as drafts for management to review.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <div className="val-grid">
        {attrs.map((a) => {
          const s = ATTR_STATUS[a.status];
          return (
            <section key={a.id} id={`a-${a.id}`} className="jblock">
              <div className="jbh"><b>{t(a.nameEs, a.nameEn)}</b><span className="grow" /><span className={`sig ${s.tone}`}>{t(s.es, s.en)}</span></div>
              <p className="small">{t(a.definitionEs, a.definitionEn)}</p>
              <dl className="qv-dl tight">
                {a.appliesWhen && <><dt>{t("Cuándo aplica", "When it applies")}</dt><dd>{a.appliesWhen}</dd></>}
                {a.restrictions && <><dt>{t("Límites", "Limits")}</dt><dd>{a.restrictions}</dd></>}
                {a.evidenceHint && <><dt>{t("Evidencia", "Evidence")}</dt><dd>{a.evidenceHint}</dd></>}
              </dl>
              <p className="src">{t(`v${a.version} · ${a.updatedByName ?? "—"} · usado en ${a._count.claims} caso(s), ${withEv.get(a.id) ?? 0} con evidencia`, `v${a.version} · ${a.updatedByName ?? "—"} · used in ${a._count.claims} case(s), ${withEv.get(a.id) ?? 0} with evidence`)}</p>
              {manage && (
                <details className="scp-add" open={sp.err === "campos"}><summary className="qa-btn">{t("Editar", "Edit")}</summary>
                  <form action={saveAttribute.bind(null, a.id)} className="qa-form">
                    <div className="qa-row"><label>Nombre (ES)<input name="nameEs" required maxLength={80} defaultValue={a.nameEs} /></label><label>Name (EN)<input name="nameEn" required maxLength={80} defaultValue={a.nameEn} /></label></div>
                    <label>Definición (ES)<textarea name="definitionEs" rows={2} required maxLength={600} defaultValue={a.definitionEs} /></label>
                    <label>Definition (EN)<textarea name="definitionEn" rows={2} required maxLength={600} defaultValue={a.definitionEn} /></label>
                    <label>{t("Cuándo aplica", "When it applies")}<input name="appliesWhen" maxLength={400} defaultValue={a.appliesWhen ?? ""} /></label>
                    <label>{t("Límites / restricciones", "Limits / restrictions")}<input name="restrictions" maxLength={400} defaultValue={a.restrictions ?? ""} /></label>
                    <label>{t("Qué evidencia lo prueba", "What evidence proves it")}<input name="evidenceHint" maxLength={400} defaultValue={a.evidenceHint ?? ""} /></label>
                    <label>{t("Estado", "Status")}<select name="status" defaultValue={a.status}>{Object.entries(ATTR_STATUS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                    <button type="submit">{t("Guardar", "Save")}</button>
                  </form>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
