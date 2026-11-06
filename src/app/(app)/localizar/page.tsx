import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { CATEGORIES } from "@/lib/part-lexicon";
import { ensureCatalogFresh, partKey, searchParts, type PartHit } from "@/lib/parts";
import { whyText, LIFE } from "./labels";
import { createPart, syncCatalog } from "./actions";

const EXAMPLES = ["6SL3210-1KE21-7UF1", "rodamiento 6205", "bomba dosificadora Grundfos", "servomotr siemens", "VFD urgente"];

export default async function LocalizarPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; c?: string; a?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 200);
  await ensureCatalogFresh();
  const [res, total, recent] = await Promise.all([
    q ? searchParts(q) : null,
    db.part.count({ where: { mergedIntoId: null } }),
    q ? [] : db.part.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, mpn: true, brand: true, name: true, category: true, lifecycle: true, _count: { select: { aliases: true } } } }),
  ]);
  const hits = res?.hits ?? [];
  const best = hits[0] && hits[0].score >= 60 ? hits[0] : null;
  const rest = best ? hits.slice(1) : hits;
  const codeLike = q && /\d/.test(q) && partKey(q).length >= 3 && !q.includes(" ");
  const manager = canManageAll(user);

  const intentNote = res && {
    URGENT: t("Parece urgente: abre la parte para ver a quién se la compramos antes, cuándo y a qué costo, y responder hoy.", "Looks urgent: open the part to see whom we bought it from before, when and at what cost, and answer today."),
    PRICE: t("Buscas precio: el detalle de cada parte muestra el último costo real y si está viejo.", "You're after price: each part's detail shows the last actual cost and whether it's stale."),
    COMPAT: t("Buscas compatibilidad: revisa los modelos compatibles y los reemplazos de cada parte.", "You're after compatibility: check each part's compatible models and replacements."),
    FIND: null,
  }[res.intent];

  const Hit = ({ h, big }: { h: PartHit; big?: boolean }) => (
    <div className={`loc-hit${big ? " best" : ""}`}>
      <div className="loc-hit-top">
        <Link href={`/localizar/${h.id}`} className="val mono">{h.mpn}</Link>
        {h.brand && <span className="loc-chip">{h.brand}</span>}
        {h.category && <span className="src">{t(CATEGORIES[h.category]?.es ?? h.category, CATEGORIES[h.category]?.en ?? h.category)}</span>}
        {h.lifecycle && h.lifecycle !== "ACTIVE" && <span className="loc-chip warn">{t(LIFE[h.lifecycle].es, LIFE[h.lifecycle].en)}</span>}
        <span className="grow" />
        <span className="loc-score" title={t("Qué tan bien coincide con lo que escribiste (no es una calificación del proveedor)", "How well it matches what you typed (not a supplier rating)")}>{h.score}%</span>
      </div>
      <div className="loc-name">{user.lang === "EN" && h.nameEn ? h.nameEn : h.name}</div>
      <ul className="loc-why">{h.why.map((w, n) => <li key={n}>{whyText(w, t)}</li>)}</ul>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mercado", "Market")}</div>
          <h1>{t("Localizar repuestos", "Find parts")}</h1>
          <p>{t("Escribe el número de parte, el nombre (en español o inglés) o la marca. SOLU entiende errores de escritura y te dice por qué cree que es esa parte.", "Type the part number, the name (Spanish or English) or the brand. SOLU tolerates typos and tells you why it thinks it's that part.")}</p>
        </div>
      </div>
      {sp.ok === "sync" && <p className="note">{t(`Catálogo actualizado: ${sp.c ?? 0} parte(s) nueva(s) desde el historial y ${sp.a ?? 0} nombre(s) alterno(s) desde Productos.`, `Catalog updated: ${sp.c ?? 0} new part(s) from history and ${sp.a ?? 0} alternate name(s) from Products.`)}</p>}
      {sp.err === "falta" && <p className="note attn">{t("Para agregar una parte necesito el número de parte y una descripción.", "To add a part I need the part number and a description.")}</p>}
      {sp.err === "permiso" && <p className="note attn">{t("Solo gerencia o administración puede hacer eso.", "Only management or admins can do that.")}</p>}

      <form className="loc-search" role="search">
        <input name="q" defaultValue={q} autoFocus placeholder={t("Ej.: 6205-2RS, rodamiento SKF, variador 7.5 kW…", "E.g.: 6205-2RS, SKF bearing, 7.5 kW drive…")} aria-label={t("Buscar repuesto", "Search part")} />
        <button type="submit">{t("Buscar", "Search")}</button>
      </form>
      {!q && (
        <p className="loc-ex">{t("Prueba:", "Try:")} {EXAMPLES.map((e) => <Link key={e} href={`/localizar?q=${encodeURIComponent(e)}`} className="loc-chip">{e}</Link>)}</p>
      )}

      {res && (
        <>
          {intentNote && <p className="note ai">{intentNote}</p>}
          {best && (
            <section className="jblock loc-sec">
              <div className="jbh"><b>{t("LA MEJOR COINCIDENCIA", "BEST MATCH")}</b></div>
              <Hit h={best} big />
            </section>
          )}
          {rest.length > 0 && (
            <section className="jblock loc-sec">
              <div className="jbh"><b>{best ? t("OTRAS POSIBILIDADES", "OTHER POSSIBILITIES") : t("POSIBLES COINCIDENCIAS", "POSSIBLE MATCHES")}</b><span className="grow" /><span className="src">{t(`${rest.length} resultado(s)`, `${rest.length} result(s)`)}</span></div>
              <div className="loc-list">{rest.map((h) => <Hit key={h.id} h={h} />)}</div>
            </section>
          )}
          {hits.length === 0 && (
            <div className="card">
              <p><b>{t(`“${q}” no está en nuestro catálogo todavía.`, `“${q}” isn't in our catalog yet.`)}</b></p>
              <p className="src">{t("El catálogo se arma con lo que ya cotizamos, vendimos y compramos. Si es una parte nueva, agrégala y la próxima vez aparecerá. (La búsqueda en internet llega en la siguiente fase.)", "The catalog is built from what we already quoted, sold and bought. If it's a new part, add it and it'll show up next time. (Web search comes in the next phase.)")}</p>
            </div>
          )}
          <details className="qa" open={hits.length === 0}>
            <summary className="qa-btn">{t("Agregar una parte nueva al catálogo", "Add a new part to the catalog")}</summary>
            <form action={createPart} className="inline loc-new">
              <label>{t("Número de parte", "Part number")}<input name="mpn" required defaultValue={codeLike ? q : ""} /></label>
              <label>{t("Descripción", "Description")}<input name="name" required defaultValue={codeLike ? "" : q} /></label>
              <label>{t("Marca", "Brand")}<input name="brand" defaultValue={res.brand ?? ""} /></label>
              <label>{t("Línea", "Line")}<select name="category" defaultValue=""><option value="">{t("— que SOLU la deduzca —", "— let SOLU infer it —")}</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <button type="submit">{t("Agregar", "Add")}</button>
            </form>
          </details>
        </>
      )}

      {!q && (
        <section className="jblock loc-sec">
          <div className="jbh">
            <b>{t("EL CATÁLOGO", "THE CATALOG")}</b><span className="grow" />
            <span className="src">{t(`${total} parte(s) · se actualiza solo con cada cotización y PO`, `${total} part(s) · updates itself with every quote and PO`)}</span>
            {manager && <form action={syncCatalog}><button className="link small" type="submit">{t("Actualizar ahora", "Update now")}</button></form>}
          </div>
          <div className="card flush">
            <table>
              <thead><tr><th>{t("Parte", "Part")}</th><th>{t("Marca", "Brand")}</th><th>{t("Línea", "Line")}</th><th className="n">{t("Otros números/nombres", "Other numbers/names")}</th></tr></thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/localizar/${p.id}`} className="val mono">{p.mpn}</Link><span className="src">{p.name}</span></td>
                    <td>{p.brand ?? <span className="src">—</span>}</td>
                    <td>{p.category ? t(CATEGORIES[p.category]?.es ?? p.category, CATEGORIES[p.category]?.en ?? p.category) : <span className="src">—</span>}</td>
                    <td className="n mono">{p._count.aliases}</td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td colSpan={4} className="empty"><b>{t("El catálogo está vacío", "The catalog is empty")}</b><br /><span className="src">{t("Se llena solo cuando hay cotizaciones o POs con código de producto.", "It fills itself once quotes or POs have product codes.")}</span></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
