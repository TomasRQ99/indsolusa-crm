import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { CATEGORIES } from "@/lib/part-lexicon";
import { ensureCatalogFresh, evidenceFor, partKey, searchParts, type PartHit } from "@/lib/parts";
import { today } from "@/lib/domain";
import { freshness } from "@/lib/x360";
import { aiConfigured, aiSpentThisMonth, monthlyCap } from "@/lib/ai";
import type { PhotoReading } from "@/lib/part-vision";
import { PhotoSearch } from "@/components/PhotoSearch";
import { whyText, LIFE } from "./labels";
import { createPart, syncCatalog } from "./actions";

const EXAMPLES = ["6SL3210-1KE21-7UF1", "rodamiento 6205", "Siemens", "bomba dosificadora Grundfos", "servomotr siemens", "VFD urgente"];

/** The photo reading travels in the URL (nothing is stored); accept only the expected shape. */
function parseReading(raw?: string): PhotoReading | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (!r || !Array.isArray(r.partNumbers) || typeof r.partType !== "string") return null;
    const s = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    return {
      partNumbers: r.partNumbers.map((x: unknown) => s(x, 60)).filter(Boolean).slice(0, 5) as string[],
      brand: s(r.brand, 60), model: s(r.model, 80), partType: s(r.partType, 80) ?? "", partTypeEn: s(r.partTypeEn, 80) ?? "",
      category: s(r.category, 30), specs: Array.isArray(r.specs) ? (r.specs.map((x: unknown) => s(x, 40)).filter(Boolean).slice(0, 6) as string[]) : [],
      source: ["NAMEPLATE", "MARKINGS", "APPEARANCE", "UNCLEAR"].includes(r.source) ? r.source : "UNCLEAR", note: s(r.note, 300) ?? "",
    };
  } catch { return null; }
}

export default async function LocalizarPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; c?: string; a?: string; foto?: string; deal?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 200);
  const photo = parseReading(sp.foto);
  await ensureCatalogFresh();
  const [res, total, recent, spent] = await Promise.all([
    q ? searchParts(q) : null,
    db.part.count({ where: { mergedIntoId: null } }),
    q ? [] : db.part.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, mpn: true, brand: true, name: true, category: true, lifecycle: true, _count: { select: { aliases: true } } } }),
    aiSpentThisMonth(),
  ]);
  const [ev, ctxDeal] = await Promise.all([
    evidenceFor((res?.hits ?? []).map((h) => h.id)),
    sp.deal ? db.deal.findUnique({ where: { id: sp.deal }, select: { id: true, code: true, title: true, account: { select: { name: true } } } }) : null,
  ]);
  const dq = ctxDeal ? `?deal=${ctxDeal.id}` : "";
  const now = today();
  const cap = monthlyCap();
  const aiState = !aiConfigured() ? "OFF" : spent.usd + 0.1 > cap ? "CAP" : "ON";
  // Equal match: the part we actually bought (we know a source and a real cost) goes first, then the one we quoted more.
  const hits = [...(res?.hits ?? [])].sort((a, b) => b.score - a.score || (ev.get(b.id)?.buys ?? 0) - (ev.get(a.id)?.buys ?? 0) || (ev.get(b.id)?.quoted ?? 0) - (ev.get(a.id)?.quoted ?? 0));
  const best = hits[0] && hits[0].score >= 60 ? hits[0] : null;
  const rest = best ? hits.slice(1) : hits;
  const codeLike = q && /\d/.test(q) && partKey(q).length >= 3 && !q.includes(" ");
  const manager = canManageAll(user);
  const SRC: Record<PhotoReading["source"], string> = {
    NAMEPLATE: t("leído de la placa", "read from the nameplate"),
    MARKINGS: t("leído de las marcas de la pieza", "read from the part's markings"),
    APPEARANCE: t("reconocido solo por su forma (sin texto legible)", "recognized by shape only (no legible text)"),
    UNCLEAR: t("lectura dudosa", "uncertain reading"),
  };
  const newMpn = photo?.partNumbers[0] ?? (codeLike ? q : "");
  const newName = photo ? [photo.partType, photo.model, ...photo.specs.slice(0, 2)].filter(Boolean).join(" ") : codeLike ? "" : q;

  const intentNote = res && {
    URGENT: t("Parece urgente: abre la parte para ver a quién se la compramos antes, cuándo y a qué costo, y responder hoy.", "Looks urgent: open the part to see whom we bought it from before, when and at what cost, and answer today."),
    PRICE: t("Buscas precio: el detalle de cada parte muestra el último costo real y si está viejo.", "You're after price: each part's detail shows the last actual cost and whether it's stale."),
    COMPAT: t("Buscas compatibilidad: revisa los modelos compatibles y los reemplazos de cada parte.", "You're after compatibility: check each part's compatible models and replacements."),
    FIND: null,
  }[res.intent];

  // What we already know about each result: real purchases (cost, supplier, how old) and how often we quoted it.
  const Evid = ({ id }: { id: string }) => {
    const e = ev.get(id);
    if (!e) return null;
    const f = e.lastCost ? freshness(i, e.lastCost.at, 180, now) : null;
    return (
      <p className="loc-ev">
        {e.lastCost ? (
          <>
            <b>{t(`Comprada ${e.buys} vez(es)`, `Bought ${e.buys} time(s)`)}</b>
            {" · "}{t("último costo", "last cost")} <span className="mono">{e.lastCost.cur} {i.n2(e.lastCost.amount)}</span> {t("a", "from")} <Link href={`/suppliers/${e.lastCost.supplierId}`}>{e.lastCost.supplier}</Link>
            {e.suppliers > 1 ? t(` (+${e.suppliers - 1} proveedor(es) más)`, ` (+${e.suppliers - 1} more supplier(s))`) : ""}
            {" "}<span className={`fresh${f!.stale ? " stale" : ""}`}>{f!.label}{f!.stale ? ` · ${t("confirmar precio", "re-confirm price")}` : ""}</span>
          </>
        ) : <span className="src">{t("Nunca la compramos", "Never purchased")}</span>}
        {e.quoted > 0 && <>{" · "}{t(`cotizada/vendida ${e.quoted} vez(es) a ${e.customers} cliente(s)`, `quoted/sold ${e.quoted} time(s) to ${e.customers} customer(s)`)}</>}
        {e.offer && <><br /><b>{t(`Oferta vigente`, `Valid offer`)}</b>{": "}<span className="mono">{e.offer.cur} {i.n2(e.offer.amount)}</span> {t("de", "from")} {e.offer.supplier}{e.offer.validUntil ? t(` · válida hasta ${i.day(e.offer.validUntil)}`, ` · valid until ${i.day(e.offer.validUntil)}`) : ""}{e.offers > 1 ? t(` · ${e.offers} ofertas vigentes`, ` · ${e.offers} valid offers`) : ""}</>}
      </p>
    );
  };

  const Hit = ({ h, big }: { h: PartHit; big?: boolean }) => (
    <div className={`loc-hit${big ? " best" : ""}`}>
      <div className="loc-hit-top">
        <Link href={`/localizar/${h.id}${dq}`} className="val mono">{h.mpn}</Link>
        {h.brand && <span className="loc-chip">{h.brand}</span>}
        {h.category && <span className="src">{t(CATEGORIES[h.category]?.es ?? h.category, CATEGORIES[h.category]?.en ?? h.category)}</span>}
        {h.lifecycle && h.lifecycle !== "ACTIVE" && <span className="loc-chip warn">{t(LIFE[h.lifecycle].es, LIFE[h.lifecycle].en)}</span>}
        <span className="grow" />
        <span className="loc-score" title={t("Qué tan bien coincide con lo que escribiste (no es una calificación del proveedor)", "How well it matches what you typed (not a supplier rating)")}>{h.score}%</span>
      </div>
      <div className="loc-name">{user.lang === "EN" && h.nameEn ? h.nameEn : h.name}</div>
      <ul className="loc-why">{h.why.map((w, n) => <li key={n}>{whyText(w, t)}</li>)}</ul>
      <Evid id={h.id} />
      {ctxDeal && <Link className="link small" href={`/localizar/${h.id}${dq}`}>{t(`Usar en ${ctxDeal.code ?? "el Journey"} →`, `Use on ${ctxDeal.code ?? "the Journey"} →`)}</Link>}
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
        <span className="grow" />
        <div><Link className="btn secondary" href="/localizar/ofertas/nueva">{t("Registrar cotización o proforma de proveedor", "Record a supplier quote or proforma")}</Link></div>
      </div>
      {sp.ok === "docborrado" &&<p className="note">{t("Documento borrado junto con sus ofertas.", "Document deleted along with its offers.")}</p>}
      {sp.ok === "sync" &&<p className="note">{t(`Catálogo actualizado: ${sp.c ?? 0} parte(s) nueva(s) desde el historial y ${sp.a ?? 0} nombre(s) alterno(s) desde Productos.`, `Catalog updated: ${sp.c ?? 0} new part(s) from history and ${sp.a ?? 0} alternate name(s) from Products.`)}</p>}
      {sp.err === "falta" && <p className="note attn">{t("Para agregar una parte necesito el número de parte y una descripción.", "To add a part I need the part number and a description.")}</p>}
      {sp.err === "permiso" && <p className="note attn">{t("Solo Gerencia o el Director Comercial pueden hacer eso.", "Only Management or the Commercial Director can do that.")}</p>}

      {ctxDeal && (
        <div className="loc-ctx">
          <span>{t(`Buscando para el Journey ${ctxDeal.code ?? ""} · ${ctxDeal.title} (${ctxDeal.account.name})`, `Sourcing for Journey ${ctxDeal.code ?? ""} · ${ctxDeal.title} (${ctxDeal.account.name})`)}</span>
          <span className="grow" />
          <Link className="link small" href={`/deals/${ctxDeal.id}?tab=source`}>{t("Volver al Journey", "Back to Journey")}</Link>
        </div>
      )}
      <form className="loc-search" role="search">
        {ctxDeal && <input type="hidden" name="deal" value={ctxDeal.id} />}
        <input name="q" defaultValue={q} autoFocus placeholder={t("Ej.: 6205-2RS, rodamiento SKF, variador 7.5 kW…", "E.g.: 6205-2RS, SKF bearing, 7.5 kW drive…")} aria-label={t("Buscar repuesto", "Search part")} />
        <button type="submit">{t("Buscar", "Search")}</button>
      </form>
      <PhotoSearch lang={user.lang === "EN" ? "EN" : "ES"} state={aiState} cap={cap} />
      {photo && (
        <section className="loc-read" aria-label={t("Lo que SOLU leyó en la foto", "What SOLU read in the photo")}>
          <div className="jbh"><b>{t("LO QUE SOLU LEYÓ EN LA FOTO", "WHAT SOLU READ IN THE PHOTO")}</b><span className="grow" /><span className="loc-chip warn">{t("sin confirmar", "unconfirmed")}</span></div>
          <dl className="filedl">
            <dt>{t("Número(s)", "Number(s)")}</dt><dd className="mono">{photo.partNumbers.length ? photo.partNumbers.join(" · ") : <span className="src">{t("ninguno legible", "none legible")}</span>}</dd>
            <dt>{t("Marca", "Brand")}</dt><dd>{photo.brand ?? "—"}{photo.model ? ` · ${photo.model}` : ""}</dd>
            <dt>{t("Qué es", "What it is")}</dt><dd>{user.lang === "EN" ? photo.partTypeEn || photo.partType : photo.partType}</dd>
            {photo.specs.length > 0 && <><dt>{t("Datos", "Ratings")}</dt><dd>{photo.specs.join(" · ")}</dd></>}
          </dl>
          <p className="src">{SRC[photo.source]}{photo.note ? ` · ${photo.note}` : ""}</p>
          <p className="src">{t("Compara con la foto antes de cotizar: la IA puede confundir dígitos. Puedes corregir la búsqueda arriba.", "Compare with the photo before quoting: the AI can misread digits. You can correct the search above.")}</p>
        </section>
      )}
      {!q && !photo && (
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
              <label>{t("Número de parte", "Part number")}<input name="mpn" required defaultValue={newMpn} /></label>
              <label>{t("Descripción", "Description")}<input name="name" required defaultValue={newName} /></label>
              <label>{t("Marca", "Brand")}<input name="brand" defaultValue={photo?.brand ?? res.brand ?? ""} /></label>
              <label>{t("Línea", "Line")}<select name="category" defaultValue={photo?.category && CATEGORIES[photo.category] ? photo.category : ""}><option value="">{t("— que SOLU la deduzca —", "— let SOLU infer it —")}</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
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
            {manager && <span className="src" title={t("Búsquedas por foto este mes", "Photo searches this month")}>{t(`IA este mes: USD ${i.n2(spent.usd)} de ${cap} · ${spent.calls} uso(s)`, `AI this month: USD ${i.n2(spent.usd)} of ${cap} · ${spent.calls} use(s)`)}</span>}
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
