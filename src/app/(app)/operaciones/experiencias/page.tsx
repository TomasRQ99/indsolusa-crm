import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { AVAILABILITY_NOTE, ELIGIBILITY, REVIEW, REVIEW_KEYS, draftWarnings, readiness } from "@/lib/experience-rules";
import { saveExperience, toggleReview } from "./actions";

// Operaciones O10 · product experience base (module 11 §36–37): what we learned supplying a product, and which of
// it could become public content after a person reviews it. SOLU publishes nothing by itself.

export default async function ExperiencesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const canReview = canManageAll(user) || user.role === "MARKETING";
  const rows = await db.productExperience.findMany({
    where: q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { manufacturer: { contains: q, mode: "insensitive" } }, { application: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { updatedAt: "desc" }, take: 60,
    include: { deal: { select: { id: true, code: true, account: { select: { name: true } }, supplierPos: { select: { supplier: { select: { name: true } } } } } } },
  });
  const okMsg: Record<string, string> = { creada: t("Experiencia guardada.", "Experience saved."), guardada: t("Cambios guardados.", "Changes saved."), "guardada-revisar": t("Cambios guardados. Como cambió el texto público o su tipo, la revisión empieza de nuevo.", "Changes saved. Since the public text or its type changed, the review starts again."), revision: t("Revisión actualizada.", "Review updated.") };
  const errMsg: Record<string, string> = { datos: t("Indica un título y qué se aprendió.", "Give a title and what was learned."), journey: t("Ese código de Journey no existe.", "That Journey code doesn't exist."), permiso: t("La revisión de confidencialidad la hacen Gerencia, Dirección Comercial o Mercadeo.", "The confidentiality review is done by Management, Sales Direction or Marketing."), revision: t("Una experiencia solo interna no se revisa para publicar.", "An internal-only experience isn't reviewed for publishing.") };
  const Fields = ({ e }: { e?: (typeof rows)[number] }) => (
    <>
      <div className="qa-row">
        <label>{t("Título", "Title")}<input name="title" required maxLength={160} defaultValue={e?.title ?? ""} placeholder={t("Ej.: Servomotor 1FK7 para envasadora", "E.g.: 1FK7 servomotor for a filling machine")} /></label>
        <label style={{ flex: "0 0 180px" }}>{t("Referencia", "Part number")}<input name="code" maxLength={80} defaultValue={e?.code ?? ""} /></label>
        <label style={{ flex: "0 0 180px" }}>{t("Fabricante", "Manufacturer")}<input name="manufacturer" maxLength={120} defaultValue={e?.manufacturer ?? ""} /></label>
      </div>
      <div className="qa-row">
        <label>{t("Aplicación", "Application")}<input name="application" maxLength={200} defaultValue={e?.application ?? ""} /></label>
        <label style={{ flex: "0 0 200px" }}>{t("Industria", "Industry")}<input name="industry" maxLength={120} defaultValue={e?.industry ?? ""} /></label>
        <label style={{ flex: "0 0 160px" }}>{t("Journey (código)", "Journey (code)")}<input name="dealCode" maxLength={40} defaultValue={e?.deal?.code ?? ""} /></label>
      </div>
      <label>{t("Qué aprendimos (interno: compatibilidad, problemas, empaque, importación)", "What we learned (internal: compatibility, issues, packaging, import)")}<textarea name="summary" rows={3} required maxLength={1200} defaultValue={e?.summary ?? ""} /></label>
      <div className="qa-row">
        <label style={{ flex: "0 0 320px" }}>{t("¿Podría publicarse?", "Could it be published?")}<select name="eligibility" defaultValue={e?.eligibility ?? "INTERNAL_ONLY"}>{Object.entries(ELIGIBILITY).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
        <label>{t("Si el cliente aprobó: quién y cuándo", "If the customer approved: who and when")}<input name="customerApproval" maxLength={200} defaultValue={e?.customerApproval ?? ""} /></label>
      </div>
      <label>{t("Borrador del texto público (opcional)", "Draft of the public text (optional)")}<textarea name="draft" rows={4} maxLength={3000} defaultValue={e?.draft ?? ""} /></label>
    </>
  );

  return (
    <>
      <div className="ph"><div><h1>{t("Experiencias de producto", "Product experiences")}</h1><p>{t("Lo que aprendimos al suministrar un producto, para que el equipo no lo redescubra. Algunas pueden volverse contenido público, pero solo después de que una persona revise cada punto de confidencialidad. SOLU no publica nada por su cuenta.", "What we learned supplying a product, so the team doesn't rediscover it. Some can become public content, but only after a person reviews every confidentiality point. SOLU publishes nothing by itself.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card">
        <form action="/operaciones/experiencias" className="qa-row"><input name="q" defaultValue={q} placeholder={t("Buscar por referencia, fabricante o aplicación", "Search by part number, manufacturer or application")} aria-label={t("Buscar", "Search")} /><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Buscar", "Search")}</button></form>
        <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Registrar experiencia", "+ Record experience")}</summary>
          <form action={saveExperience.bind(null, null)} className="qa-form" style={{ marginTop: 8, maxWidth: 760 }}><Fields /><button type="submit">{t("Guardar experiencia", "Save experience")}</button></form>
        </details>
      </section>

      {rows.length === 0 && <section className="card"><p className="small muted">{q ? t("Nada con esa búsqueda.", "Nothing for that search.") : t("Aún no hay experiencias registradas.", "No experiences recorded yet.")}</p></section>}
      {rows.map((e) => {
        const checks = (e.checks ?? {}) as Record<string, { by: string; at: string }>;
        const rd = readiness({ eligibility: e.eligibility, draft: e.draft, checks, customerApproval: e.customerApproval });
        const warns = e.draft && e.eligibility !== "INTERNAL_ONLY" ? draftWarnings(e.draft, { customerName: e.deal?.account.name, supplierNames: [...new Set(e.deal?.supplierPos.map((p) => p.supplier.name) ?? [])], anonymized: e.eligibility === "PUBLISHABLE_ANONYMIZED" }) : [];
        return (
          <section className="card" key={e.id} id={`e-${e.id}`}>
            <header className="exc-head"><span className={`sig ${e.eligibility === "INTERNAL_ONLY" ? "wait" : rd.ready ? "ok" : "attn"}`}>{e.eligibility === "INTERNAL_ONLY" ? t("Solo interno", "Internal only") : rd.ready ? t("Revisada: lista para que alguien la publique", "Reviewed: ready for someone to publish") : t("Falta revisión", "Review pending")}</span> <b>{e.title}</b><span className="grow" /><span className="small muted">{e.updatedByName ?? e.createdByName} · {i.day(e.updatedAt)}</span></header>
            <p className="small">{[e.manufacturer, e.code].filter(Boolean).join(" · ")}{e.application ? ` · ${e.application}` : ""}{e.industry ? ` · ${e.industry}` : ""}{e.deal && <> · <Link href={`/deals/${e.deal.id}`}>{e.deal.code}</Link></>}</p>
            <p className="small pre">{e.summary}</p>
            {e.eligibility !== "INTERNAL_ONLY" && (
              <>
                <div className="note" style={{ marginTop: 6 }}>
                  <span className="k">{t("BORRADOR PÚBLICO", "PUBLIC DRAFT")} · {t(ELIGIBILITY[e.eligibility].es, ELIGIBILITY[e.eligibility].en)}</span>
                  {e.draft ? <p className="small pre">{e.draft}</p> : <p className="small muted">{t("Sin texto todavía.", "No text yet.")}</p>}
                  <p className="src">{t(AVAILABILITY_NOTE.es, AVAILABILITY_NOTE.en)}</p>
                </div>
                {warns.length > 0 && <ul className="plain small">{warns.map((w, k) => <li key={k} className="risk-t">⚠ {t(w.es, w.en)}</li>)}</ul>}
                <ul className="qv-checks">{REVIEW_KEYS.map((k) => { const c = checks[k]; return (
                  <li key={k} className={c ? "ok" : "no"}><span className="ic" aria-hidden>{c ? "✓" : "!"}</span><span>{t(REVIEW[k].es, REVIEW[k].en)}{c && <span className="muted small"> · {c.by} · {i.day(new Date(c.at))}</span>}{canReview && <form action={toggleReview.bind(null, e.id, k)} className="inline-f"><button type="submit" className="linkb">{c ? t("desmarcar", "untick") : t("revisado", "reviewed")}</button></form>}</span></li>
                ); })}</ul>
              </>
            )}
            <details className="qa" style={{ marginTop: 6 }}><summary className="qa-btn">{t("Editar", "Edit")}</summary>
              <form action={saveExperience.bind(null, e.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 760 }}><Fields e={e} /><button type="submit">{t("Guardar cambios", "Save changes")}</button></form>
            </details>
          </section>
        );
      })}
    </>
  );
}
