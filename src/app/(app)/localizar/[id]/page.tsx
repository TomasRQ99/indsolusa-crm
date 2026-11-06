import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { today } from "@/lib/domain";
import { freshness } from "@/lib/x360";
import { CATEGORIES } from "@/lib/part-lexicon";
import { partHistory, partKeys } from "@/lib/parts";
import { Popovers } from "@/components/Popovers";
import { ALIAS_KIND, CONDITION, LIFE } from "../labels";
import { addAlias, addToQuote, mergeInto, partReminder, removeAlias, updatePart, useInJourney } from "../actions";
import { addOffer, removeOffer } from "../ofertas/actions";
import { readPage, removeWebSource, searchSources } from "../fuentes/actions";
import { digikeyConfigured, mouserConfigured } from "@/lib/web-sources";
import { partConfirmations, supplierEvidence } from "@/lib/supplier-evidence";
import { SupplierEvidenceLine } from "@/components/SupplierEvidenceLine";
type Sp = { ok?: string; err?: string; otro?: string; n?: string; deal?: string; m?: string; p?: string; st?: string };

export default async function PartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Sp> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const now = today();
  const p = await db.part.findUnique({ where: { id }, include: { aliases: { orderBy: { createdAt: "asc" } }, merged: { select: { id: true, mpn: true } } } });
  if (!p) notFound();
  if (p.mergedIntoId) redirect(`/localizar/${p.mergedIntoId}`);
  const manager = canManageAll(user);
  const keys = await partKeys(p.id);
  const mine = manager ? {} : { ownerId: user.id };
  const [h, other, legacy, ctxDeal, accounts, openDeals, draftQuotes, suppliers] = await Promise.all([
    partHistory(keys),
    sp.otro ? db.part.findUnique({ where: { id: sp.otro }, select: { id: true, mpn: true, name: true } }) : null,
    db.productFact.count({ where: { code: { in: [p.mpn.trim().toUpperCase()] } } }),
    sp.deal ? db.deal.findUnique({ where: { id: sp.deal }, select: { id: true, code: true, title: true, ownerId: true, account: { select: { id: true, name: true } } } }) : null,
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    db.deal.findMany({ where: { ...mine, stage: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, take: 60, select: { id: true, code: true, title: true, account: { select: { name: true } } } }),
    db.quote.findMany({ where: { status: "DRAFT", deal: mine }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, number: true, rev: true, deal: { select: { code: true, account: { select: { name: true } } } } } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 300 }),
  ]);
  const offers = await db.supplierOffer.findMany({
    where: { partId: p.id },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, codeAsQuoted: true, qty: true, unitPrice: true, currency: true, leadText: true, incoterm: true, validUntil: true, source: true, recordedByName: true, createdAt: true, supplier: { select: { id: true, name: true } }, doc: { select: { id: true, kind: true, reference: true } } },
  });
  const [web, sitesWithWeb] = await Promise.all([
    db.webSource.findMany({ where: { partId: p.id }, orderBy: [{ matched: "desc" }, { fetchedAt: "desc" }], take: 30 }),
    db.supplier.count({ where: { website: { not: null } } }),
  ]);
  const apis = { mouser: mouserConfigured(), digikey: digikeyConfigured() };
  const [sev, conf] = await Promise.all([
    supplierEvidence(offers.map((o) => o.supplier.id), { partKeys: keys }),
    partConfirmations(p.id, h.buys.length),
  ]);
  const nowTs = new Date();
  const canEditCtx = !!ctxDeal && (manager || ctxDeal.ownerId === user.id);
  // Suggested price: the most recent price we quoted or put on a Journey for this part.
  const priced = [...h.quotes.map((x) => ({ at: x.quote!.createdAt, v: Number(x.unitPrice) })), ...h.items.map((x) => ({ at: new Date(0), v: Number(x.unitPrice) }))].filter((x) => x.v > 0).sort((a, b) => +b.at - +a.at);
  const suggested = priced[0]?.v ?? null;

  const buys = h.buys.map((b) => ({ ...b, at: b.po!.releasedAt ?? b.po!.createdAt })).sort((a, b) => +b.at - +a.at);
  const last = buys[0];
  const lastF = freshness(i, last?.at ?? null, 180, now);
  const pastSuppliers = [...new Map(buys.map((b) => [b.po!.supplier.id, b.po!.supplier])).values()];
  const customers = [...new Map([...h.items.map((x) => x.deal!.account), ...h.quotes.map((x) => x.quote!.deal.account)].map((a) => [a.id, a])).values()];
  const has360 = h.items.length + h.buys.length + h.quotes.length + legacy > 0;
  const specs = Array.isArray(p.specs) ? (p.specs as { k: string; v: string }[]) : [];
  const L = (m: Record<string, { es: string; en: string }>, k: string | null) => (k && m[k] ? t(m[k].es, m[k].en) : "—");

  const notes: Record<string, string> = {
    creado: t("Parte agregada al catálogo.", "Part added to the catalog."),
    guardado: t("Cambios guardados.", "Changes saved."),
    alias: t("Listo: ahora también la encuentras por ese número o nombre.", "Done: you'll now also find it by that number or name."),
    quitado: t("Número o nombre quitado.", "Number or name removed."),
    ya: t("Ese ya es su número de parte.", "That's already its part number."),
    oferta: t("Oferta guardada.", "Offer saved."),
    ofertaquitada: t("Oferta quitada.", "Offer removed."),
    rfq: t("Listo: el pendiente de pedir precio quedó en tu lista (Mi Día → Pendientes).", "Done: the ask-for-price to-do is on your list (My Day → To-dos)."),
    seguimiento: t("Listo: el recordatorio quedó en tu lista (Mi Día → Pendientes).", "Done: the reminder is on your list (My Day → To-dos)."),
    web: t("Página leída: muestra este número de parte. Quedó en Fuentes en internet.", "Page read: it shows this part number. It's now under Web sources."),
    webnomatch: t("Página leída, pero no muestra este número de parte exacto. Revísala antes de confiar en ella.", "Page read, but it doesn't show this exact part number. Check it before relying on it."),
    fuentes: t(`Búsqueda terminada: ${sp.n ?? 0} resultado(s), ${sp.m ?? 0} con este número de parte exacto.`, `Search done: ${sp.n ?? 0} result(s), ${sp.m ?? 0} with this exact part number.`),
    fusionado: t(`Fusionado: buscar ${sp.n ?? "el duplicado"} ahora trae esta parte.`, `Merged: searching ${sp.n ?? "the duplicate"} now brings up this part.`),
  };
  const errs: Record<string, string> = {
    existe: t("Esa parte ya estaba en el catálogo: es esta.", "That part was already in the catalog: it's this one."),
    falta: t("Falta el número de parte.", "The part number is missing."),
    numero: t("Ese número ya es de otra parte del catálogo.", "That number already belongs to another catalog part."),
    enotro: t("Ese número ya está registrado en otra parte. Si son la misma, fusiónalas.", "That number is already on another part. If they're the same, merge them."),
    alias: t("Escribe el número o nombre.", "Type the number or name."),
    dup: t("No encontré ese duplicado (o ya estaba fusionado).", "I couldn't find that duplicate (or it was already merged)."),
    permiso: t("No tienes permiso para eso (solo el dueño del Journey o gerencia).", "You don't have permission for that (only the Journey owner or management)."),
    cliente: t("Elige el cliente.", "Pick the customer."),
    oferta: t("Para guardar la oferta necesito el proveedor y el precio.", "To save the offer I need the supplier and the price."),
    cotizacion: t("Esa cotización ya no está en borrador.", "That quote is no longer a draft."),
    web_SCHEME: t("Pega una dirección web completa, como https://www.proveedor.com/producto.", "Paste a full web address, like https://www.supplier.com/product."),
    web_PRIVATE: t("Esa dirección no es una página pública de internet.", "That address isn't a public internet page."),
    web_BLOCKED: t("Ese sitio no permite lectura automática (o lo consultamos por su sistema oficial). Ábrelo tú y registra la oferta a mano.", "That site doesn't allow automated reading (or we use its official system). Open it yourself and record the offer by hand."),
    web_ROBOTS: t("Las reglas de ese sitio (robots.txt) no permiten que SOLU lea esa página. Ábrela tú y registra la oferta a mano.", "That site's rules (robots.txt) don't let SOLU read that page. Open it yourself and record the offer by hand."),
    web_HTTP: t(`El sitio respondió con un error${sp.st ? ` (${sp.st})` : ""}: la página no existe o no está disponible.`, `The site answered with an error${sp.st ? ` (${sp.st})` : ""}: the page doesn't exist or isn't available.`),
    web_TIMEOUT: t("El sitio tardó demasiado en responder. Intenta más tarde.", "The site took too long to answer. Try later."),
    web_NETWORK: t("No pude conectar con ese sitio.", "I couldn't connect to that site."),
    web_SIZE: t("La página es demasiado grande para leerla.", "The page is too large to read."),
    web_TYPE: t("Esa dirección no es una página web (quizá es un PDF: súbelo como cotización).", "That address isn't a web page (maybe it's a PDF: upload it as a quote)."),
    web_REDIRECTS: t("La página redirige demasiadas veces.", "The page redirects too many times."),
  };
  const problemText: Record<string, string> = {
    mouser_AUTH: t("Mouser rechazó la clave", "Mouser rejected the key"), mouser_LIMIT: t("Mouser: límite diario alcanzado", "Mouser: daily limit reached"), mouser_DOWN: t("Mouser no respondió", "Mouser didn't answer"),
    digikey_AUTH: t("Digi-Key rechazó las credenciales", "Digi-Key rejected the credentials"), digikey_LIMIT: t("Digi-Key: límite alcanzado", "Digi-Key: limit reached"), digikey_DOWN: t("Digi-Key no respondió", "Digi-Key didn't answer"),
    tiempo: t("se acabó el tiempo antes de revisar todos los sitios", "time ran out before checking every site"),
  };
  const KIND: Record<string, string> = { MOUSER: "Mouser (API oficial)", DIGIKEY: "Digi-Key (API oficial)", SITEMAP: t("Sitio del proveedor", "Supplier site"), PAGE: t("Página web", "Web page") };
  const AVAIL: Record<string, string> = { IN_STOCK: t("en existencia", "in stock"), LIMITED: t("pocas unidades", "limited"), OUT_OF_STOCK: t("agotado", "out of stock"), BACKORDER: t("bajo pedido", "backorder"), PREORDER: t("preventa", "pre-order"), DISCONTINUED: t("descontinuado", "discontinued"), MADE_TO_ORDER: t("fabricación a pedido", "made to order") };

  return (
    <div className="jw x3">
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/localizar">{t("Localizar repuestos", "Find parts")}</Link></p>
          <span className="jid mono">{p.mpn}</span>
          <span className="grow" />
          {has360 && <Link className="link small" href={`/productos/${encodeURIComponent(p.mpn.trim().toUpperCase())}`}>{t("Ver Producto 360", "Open Product 360")}</Link>}
        </div>
        <div className="jh-title"><h1>{user.lang === "EN" && p.nameEn ? p.nameEn : p.name}</h1></div>
        <p className="jh-sub">{[p.brand, p.category ? L(CATEGORIES, p.category) : null, p.lifecycle && p.lifecycle !== "ACTIVE" ? L(LIFE, p.lifecycle) : null, p.createdByName ? t(`agregada por ${p.createdByName}`, `added by ${p.createdByName}`) : null].filter(Boolean).join(" · ")}</p>
      </header>

      {sp.ok && notes[sp.ok] && <p className="note">{notes[sp.ok]}{sp.ok === "fuentes" && sp.p ? ` ${t("Ojo", "Note")}: ${sp.p.split(",").map((x) => problemText[x] ?? x).join("; ")}.` : ""}</p>}
      {sp.err && errs[sp.err] && <p className="note attn">{errs[sp.err]}{other && <> <Link href={`/localizar/${other.id}`}><b className="mono">{other.mpn}</b> · {other.name}</Link></>}</p>}
      {p.lifecycle && p.lifecycle !== "ACTIVE" && <p className="note attn">{t("El fabricante ya no la produce normalmente. Antes de cotizar, confirma existencias o un reemplazo (agrégalo abajo como número anterior/equivalente).", "The manufacturer no longer makes it normally. Before quoting, confirm stock or a replacement (add it below as superseded/equivalent).")}</p>}

      <section className="x3-facts" aria-label={t("Lo que sabemos", "What we know")}>
        <div className="x3-f">
          <span className="k">{t("ÚLTIMO COSTO REAL", "LAST ACTUAL COST")}</span>
          <b>{last ? `${last.po!.currency} ${i.n2(last.unitCost)}` : t("Nunca la compramos", "Never purchased")}</b>
          <span className="src">{last ? t(`a ${last.po!.supplier.name} · ${last.po!.code}`, `from ${last.po!.supplier.name} · ${last.po!.code}`) : t("pide precio a un proveedor", "ask a supplier for a price")}</span>
          {last && <span className={`fresh${lastF.stale ? " stale" : ""}`}>{lastF.label}{lastF.stale ? ` · ${t("confirmar precio", "re-confirm price")}` : ""}</span>}
        </div>
        <div className="x3-f">
          <span className="k">{t("SE LA COMPRAMOS A", "WE BOUGHT IT FROM")}</span>
          <b>{pastSuppliers.length ? t(`${pastSuppliers.length} proveedor(es)`, `${pastSuppliers.length} supplier(s)`) : "—"}</b>
          <span className="src">{pastSuppliers.map((s, n) => <span key={s.id}>{n ? ", " : ""}<Link href={`/suppliers/${s.id}`}>{s.name}</Link></span>)}{!pastSuppliers.length && t("sin compras registradas", "no recorded purchases")}</span>
        </div>
        <div className="x3-f">
          <span className="k">{t("CLIENTES QUE LA USAN", "CUSTOMERS USING IT")}</span>
          <b>{customers.length || "—"}</b>
          <span className="src">{customers.slice(0, 4).map((c, n) => <span key={c.id}>{n ? ", " : ""}<Link href={`/accounts/${c.id}`}>{c.name}</Link></span>)}{customers.length > 4 ? ` +${customers.length - 4}` : ""}{!customers.length && t("aún sin Journeys", "no Journeys yet")}</span>
        </div>
        <div className="x3-f">
          <span className="k">{t("FUENTES QUE LA CONFIRMAN", "SOURCES CONFIRMING IT")}</span>
          <b>{conf.total ? t(`${conf.total} fuente(s) independiente(s)`, `${conf.total} independent source(s)`) : t("Ninguna todavía", "None yet")}</b>
          <span className="src">{[
            conf.buys ? t(`compras reales (${conf.buys})`, `actual purchases (${conf.buys})`) : null,
            conf.offerSuppliers ? t(`${conf.offerSuppliers} proveedor(es) la cotizaron`, `${conf.offerSuppliers} supplier(s) quoted it`) : null,
            conf.webHosts.length ? t(`en internet: ${conf.webHosts.join(", ")}`, `online: ${conf.webHosts.join(", ")}`) : null,
          ].filter(Boolean).join(" · ") || t("pide precio o busca en fuentes oficiales", "ask for a price or search official sources")}</span>
          {conf.total === 1 && <span className="fresh stale">{t("una sola fuente · confirmar", "single source · confirm")}</span>}
        </div>
      </section>

      {ctxDeal && (
        <div className="loc-ctx">
          <span>{t(`Buscando para el Journey ${ctxDeal.code ?? ""} · ${ctxDeal.title} (${ctxDeal.account.name})`, `Sourcing for Journey ${ctxDeal.code ?? ""} · ${ctxDeal.title} (${ctxDeal.account.name})`)}</span>
          <span className="grow" />
          {canEditCtx && (
            <form action={useInJourney.bind(null, p.id)}>
              <input type="hidden" name="dealId" value={ctxDeal.id} />
              <input type="hidden" name="qty" value="1" />
              <input type="hidden" name="unitPrice" value={suggested ?? 0} />
              <button type="submit">{t(`Agregar a ${ctxDeal.code ?? "este Journey"}`, `Add to ${ctxDeal.code ?? "this Journey"}`)}</button>
            </form>
          )}
          <Link className="link small" href={`/deals/${ctxDeal.id}?tab=source`}>{t("Volver al Journey", "Back to Journey")}</Link>
        </div>
      )}

      <section className="loc-actions" aria-label={t("Qué hacer con esta parte", "What to do with this part")}>
        <details className="qa"><summary className="qa-btn primary">{t("Nueva necesidad (Journey)", "New need (Journey)")}</summary><div className="qa-pop wide">
          <form action={useInJourney.bind(null, p.id)} className="qa-form">
            <label>{t("Cliente", "Customer")}<select name="accountId" required defaultValue={ctxDeal?.account.id ?? ""}><option value="" disabled>{t("— elige —", "— choose —")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <div className="qa-row">
              <label>{t("Cantidad", "Qty")}<input name="qty" type="number" min="1" defaultValue={1} /></label>
              <label>{t("Precio unit. (opcional)", "Unit price (optional)")}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={suggested ?? ""} /></label>
            </div>
            {suggested != null && <p className="src">{t(`Precio sugerido: el último que cotizamos (${i.n2(suggested)})`, `Suggested price: the last one we quoted (${i.n2(suggested)})`)}</p>}
            <button type="submit">{t("Crear Journey y abrir", "Create Journey and open")}</button>
          </form>
        </div></details>

        <details className="qa"><summary className="qa-btn">{t("Agregar a un Journey", "Add to a Journey")}</summary><div className="qa-pop wide">
          {openDeals.length === 0 ? <p className="src">{t("No tienes Journeys abiertos.", "You have no open Journeys.")}</p> : (
            <form action={useInJourney.bind(null, p.id)} className="qa-form">
              <label>Journey<select name="dealId" required defaultValue={ctxDeal?.id ?? ""}><option value="" disabled>{t("— elige —", "— choose —")}</option>{openDeals.map((d) => <option key={d.id} value={d.id}>{d.code ?? ""} · {d.account.name} · {d.title.slice(0, 50)}</option>)}</select></label>
              <div className="qa-row">
                <label>{t("Cantidad", "Qty")}<input name="qty" type="number" min="1" defaultValue={1} /></label>
                <label>{t("Precio unit.", "Unit price")}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={suggested ?? ""} /></label>
              </div>
              <button type="submit">{t("Agregar", "Add")}</button>
            </form>
          )}
        </div></details>

        <details className="qa"><summary className="qa-btn">{t("Agregar a una cotización", "Add to a quote")}</summary><div className="qa-pop wide">
          {draftQuotes.length === 0 ? <p className="src">{t("No hay cotizaciones en borrador que puedas editar. Créala desde su Journey (pestaña Cotización).", "There are no draft quotes you can edit. Create one from its Journey (Quote tab).")}</p> : (
            <form action={addToQuote.bind(null, p.id)} className="qa-form">
              <label>{t("Cotización en borrador", "Draft quote")}<select name="quoteId" required>{draftQuotes.map((q) => <option key={q.id} value={q.id}>{q.number}{q.rev ? ` R${q.rev}` : ""} · {q.deal.account.name} · {q.deal.code ?? ""}</option>)}</select></label>
              <div className="qa-row">
                <label>{t("Cantidad", "Qty")}<input name="qty" type="number" min="1" defaultValue={1} /></label>
                <label>{t("Precio unit.", "Unit price")}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={suggested ?? ""} /></label>
              </div>
              <button type="submit">{t("Agregar línea y abrir", "Add line and open")}</button>
            </form>
          )}
        </div></details>

        <details className="qa"><summary className="qa-btn">{t("Pedir precio a proveedor", "Ask a supplier for a price")}</summary><div className="qa-pop wide">
          <p><Link className="btn" href={`/localizar/rfq/nueva?part=${p.id}${ctxDeal ? `&deal=${ctxDeal.id}` : ""}`}>{t("Enviar correo a uno o varios proveedores", "Email one or several suppliers")}</Link></p>
          <p className="src">{t("Sale desde sales@, un correo por proveedor. O, si lo vas a pedir por teléfono o WhatsApp, crea solo un pendiente:", "Sent from sales@, one email per supplier. Or, if you'll ask by phone or WhatsApp, just create a to-do:")}</p>
          <form action={partReminder.bind(null, p.id)} className="qa-form">
            <input type="hidden" name="kind" value="PRICE" />
            {ctxDeal && <input type="hidden" name="dealId" value={ctxDeal.id} />}
            <label>{t("Proveedor", "Supplier")}<select name="supplierId" defaultValue={pastSuppliers[0]?.id ?? ""}>
              <option value="">{t("— por definir —", "— to be decided —")}</option>
              {pastSuppliers.length > 0 && <optgroup label={t("Ya nos la vendieron", "Sold it to us before")}>{pastSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
              <optgroup label={t("Otros proveedores", "Other suppliers")}>{suppliers.filter((s) => !pastSuppliers.some((x) => x.id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            </select></label>
            <div className="qa-row">
              <label>{t("Cantidad", "Qty")}<input name="qty" type="number" min="1" defaultValue={1} /></label>
              <label>{t("Para cuándo", "By when")}<input name="dueDate" type="date" /></label>
            </div>
            <button type="submit" className="secondary">{t("Solo crear pendiente", "Just create a to-do")}</button>
          </form>
        </div></details>

        <details className="qa"><summary className="qa-btn">{t("Recordar seguimiento", "Follow-up reminder")}</summary><div className="qa-pop wide">
          <form action={partReminder.bind(null, p.id)} className="qa-form">
            <input type="hidden" name="kind" value="FOLLOW" />
            {ctxDeal ? <input type="hidden" name="dealId" value={ctxDeal.id} /> : (
              <label>{t("Cliente (opcional)", "Customer (optional)")}<select name="accountId" defaultValue=""><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            )}
            <label>{t("Cuándo", "When")}<input name="dueDate" type="date" /></label>
            <p className="src">{t("Si no eliges fecha: en 2 días hábiles.", "If you don't pick a date: in 2 working days.")}</p>
            <button type="submit">{t("Crear recordatorio", "Create reminder")}</button>
          </form>
        </div></details>
      </section>

      <div className="jbody">
        <div className="jmain">
          <section className="jblock">
            <div className="jbh"><b>{t("OFERTAS DE PROVEEDORES", "SUPPLIER OFFERS")}</b><span className="grow" /><span className="src">{t("lo que nos cotizaron, con su respaldo", "what we were quoted, with its evidence")}</span></div>
            {offers.length === 0 ? <p className="quiet-p">{t("Aún sin ofertas. Pide precio a proveedores o sube la cotización/proforma que te enviaron.", "No offers yet. Ask suppliers for a price or upload the quote/proforma they sent.")}</p> : (
              <table>
                <thead><tr><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th>{t("Plazo", "Lead time")}</th><th>{t("Válida hasta", "Valid until")}</th><th>{t("Respaldo", "Evidence")}</th><th /></tr></thead>
                <tbody>{offers.map((o) => {
                  const exp = o.validUntil && o.validUntil < nowTs;
                  return (
                    <tr key={o.id} className={exp ? "loc-expired" : undefined}>
                      <td><Link href={`/suppliers/${o.supplier.id}`}>{o.supplier.name}</Link>{o.codeAsQuoted !== p.mpn && <span className="src block mono">{t("como", "as")} {o.codeAsQuoted}</span>}<SupplierEvidenceLine ev={sev.get(o.supplier.id)} t={t} /></td>
                      <td className="n mono">{o.currency} {i.n2(o.unitPrice)}{o.qty ? <span className="src block">{t(`por ${o.qty}`, `for ${o.qty}`)}</span> : null}</td>
                      <td>{o.leadText ?? "—"}{o.incoterm ? <span className="src block">{o.incoterm}</span> : null}</td>
                      <td>{o.validUntil ? i.day(o.validUntil) : <span className="src">{t("sin fecha", "no date")}</span>}{exp ? <span className="src block">{t("vencida · confirmar", "expired · re-confirm")}</span> : null}</td>
                      <td className="small">{o.doc ? <Link href={`/localizar/ofertas/${o.doc.id}`}>{o.doc.kind === "PROFORMA" ? "Proforma" : t("Cotización", "Quote")} {o.doc.reference ?? ""}</Link> : o.source ?? "—"}<span className="src block">{o.recordedByName} · {i.day(o.createdAt)}</span></td>
                      <td>{(manager || o.recordedByName === user.name) && <form action={removeOffer.bind(null, p.id, o.id)} data-confirm={t("¿Quitar esta oferta?", "Remove this offer?")}><button className="link small" type="submit">{t("Quitar", "Remove")}</button></form>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            <div className="loc-offer-acts">
              <Link className="link small" href={`/localizar/ofertas/nueva${pastSuppliers[0] ? `?supplier=${pastSuppliers[0].id}` : ""}`}>{t("Subir cotización o proforma del proveedor", "Upload the supplier's quote or proforma")}</Link>
              <details className="qa"><summary className="qa-btn">{t("Registrar oferta a mano", "Record an offer by hand")}</summary><div className="qa-pop wide">
                <form action={addOffer.bind(null, p.id)} className="qa-form">
                  <label>{t("Proveedor", "Supplier")}<select name="supplierId" required defaultValue={pastSuppliers[0]?.id ?? ""}><option value="" disabled>{t("— elige —", "— choose —")}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  <div className="qa-row">
                    <label>{t("Precio unit.", "Unit price")}<input name="unitPrice" required inputMode="decimal" /></label>
                    <label>{t("Moneda", "Currency")}<select name="currency" defaultValue="USD"><option>USD</option><option>EUR</option><option>COP</option><option>GBP</option></select></label>
                  </div>
                  <div className="qa-row">
                    <label>{t("Cantidad", "Qty")}<input name="qty" type="number" min="1" /></label>
                    <label>{t("Plazo", "Lead time")}<input name="leadText" placeholder={t("4-6 semanas", "4-6 weeks")} /></label>
                  </div>
                  <div className="qa-row">
                    <label>{t("Válida hasta", "Valid until")}<input name="validUntil" type="date" /></label>
                    <label>Incoterm<input name="incoterm" placeholder="FCA Miami" /></label>
                  </div>
                  <label>{t("Fuente", "Source")}<input name="source" placeholder={t("Ej.: llamada con Juan, WhatsApp", "E.g.: call with Juan, WhatsApp")} /></label>
                  <button type="submit">{t("Guardar oferta", "Save offer")}</button>
                </form>
              </div></details>
            </div>
          </section>

          <section className="jblock" id="fuentes">
            <div className="jbh"><b>{t("FUENTES EN INTERNET", "WEB SOURCES")}</b><span className="grow" /><span className="src">{t("referencia pública con fecha · no es una oferta confirmada", "dated public reference · not a confirmed offer")}</span></div>
            {web.length === 0 ? <p className="quiet-p">{t("Aún nada. Busca en las fuentes oficiales o pega la página del producto de un proveedor o fabricante.", "Nothing yet. Search the official sources or paste a supplier's or manufacturer's product page.")}</p> : (
              <table className="loc-web">
                <thead><tr><th>{t("Fuente", "Source")}</th><th className="n">{t("Precio", "Price")}</th><th>{t("Disponibilidad", "Availability")}</th><th>{t("Leído", "Read")}</th><th /></tr></thead>
                <tbody>{web.map((w) => {
                  const breaks = Array.isArray(w.priceBreaks) ? (w.priceBreaks as { qty: number; price: number }[]) : [];
                  const old = nowTs.getTime() - w.fetchedAt.getTime() > 7 * 86_400_000;
                  return (
                    <tr key={w.id}>
                      <td>
                        <span className="loc-chip">{KIND[w.kind] ?? w.kind}</span> <a href={w.url} target="_blank" rel="noopener noreferrer nofollow">{w.title ?? w.host}</a>
                        <span className="src block">{w.host}{w.mpnSeen ? <> · <span className="mono">{w.mpnSeen}</span></> : null}{w.brand ? ` · ${w.brand}` : ""}</span>
                        {w.matched ? <span className="src block ok-text">✓ {t("muestra este número de parte", "shows this part number")}</span> : <span className="src block warn-text">{t("no muestra el número exacto: revisar", "doesn't show the exact number: check")}</span>}
                        {w.datasheetUrl && <a className="small" href={w.datasheetUrl} target="_blank" rel="noopener noreferrer nofollow">{t("Ficha técnica (PDF)", "Datasheet (PDF)")}</a>}
                      </td>
                      <td className="n mono">{w.price != null ? `${w.currency ?? ""} ${i.n2(w.price)}` : "—"}{breaks.length > 1 && <span className="src block">{breaks.slice(0, 4).map((b) => `${b.qty}+: ${i.n2(b.price)}`).join(" · ")}</span>}</td>
                      <td>{w.stock != null ? t(`${w.stock} en existencia`, `${w.stock} in stock`) : w.availability ? (AVAIL[w.availability] ?? w.availability) : "—"}{w.leadText && <span className="src block">{t("plazo", "lead")} {w.leadText}</span>}{w.lifecycle && w.lifecycle !== "ACTIVE" && <span className="loc-chip warn">{L(LIFE, w.lifecycle)}</span>}</td>
                      <td className="mono small">{i.day(w.fetchedAt)}{old && <span className="src block">{t("antiguo · volver a buscar", "old · search again")}</span>}</td>
                      <td><form action={removeWebSource.bind(null, p.id, w.id)}><button className="link small" type="submit">{t("Quitar", "Remove")}</button></form></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            <div className="loc-offer-acts">
              <form action={searchSources.bind(null, p.id)}><button type="submit" className="secondary sm">{t("Buscar en fuentes oficiales", "Search official sources")}</button></form>
              <details className="qa"><summary className="qa-btn">{t("Leer una página web", "Read a web page")}</summary><div className="qa-pop wide">
                <form action={readPage.bind(null, p.id)} className="qa-form">
                  <label>{t("Dirección de la página del producto", "Product page address")}<input name="url" required inputMode="url" placeholder="https://www.proveedor.com/producto/…" /></label>
                  <p className="src">{t("SOLU solo la lee si las reglas del sitio lo permiten (robots.txt). Busca el número de parte, precio, existencias y ficha técnica.", "SOLU only reads it if the site's rules allow it (robots.txt). It looks for the part number, price, stock and datasheet.")}</p>
                  <button type="submit">{t("Leer página", "Read page")}</button>
                </form>
              </div></details>
            </div>
            <p className="src loc-srcstate">
              {t("Fuentes oficiales:", "Official sources:")} Mouser {apis.mouser ? <b>{t("activo", "on")}</b> : t("sin clave", "no key")} · Digi-Key {apis.digikey ? <b>{t("activo", "on")}</b> : t("sin clave", "no key")} · {t(`${sitesWithWeb} proveedor(es) con sitio web`, `${sitesWithWeb} supplier(s) with a website`)} (<Link href="/suppliers">{t("agregar", "add")}</Link>). {t("La búsqueda puede tardar hasta un minuto.", "The search can take up to a minute.")}
            </p>
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("OTROS NÚMEROS Y NOMBRES", "OTHER NUMBERS & NAMES")}</b><span className="grow" /><span className="src">{t("cualquiera de estos encuentra esta parte", "any of these finds this part")}</span></div>
            {p.aliases.length === 0 ? <p className="quiet-p">{t("Todavía ninguno. Agrega el número del fabricante, equivalentes de otras marcas o el número anterior.", "None yet. Add the manufacturer number, other brands' equivalents or the old number.")}</p> : (
              <table>
                <thead><tr><th>{t("Número / nombre", "Number / name")}</th><th>{t("Qué es", "What it is")}</th><th>{t("Fuente", "Source")}</th><th /></tr></thead>
                <tbody>
                  {p.aliases.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.code}{a.brand ? <span className="src"> · {a.brand}</span> : null}</td>
                      <td title={ALIAS_KIND[a.kind]?.help}>{L(ALIAS_KIND, a.kind)}</td>
                      <td className="small">{a.source ?? a.createdByName ?? "—"}</td>
                      <td>{(manager || a.createdByName === user.name) && (
                        <form action={removeAlias.bind(null, p.id, a.id)} data-confirm={t(`¿Quitar ${a.code}? Ya no encontrará esta parte.`, `Remove ${a.code}? It won't find this part anymore.`)}><button className="link small" type="submit">{t("Quitar", "Remove")}</button></form>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={addAlias.bind(null, p.id)} className="inline" style={{ marginTop: 10 }}>
              <label>{t("Número o nombre", "Number or name")}<input name="code" required /></label>
              <label>{t("Qué es", "What it is")}<select name="kind" defaultValue="CROSSREF">{Object.entries(ALIAS_KIND).filter(([k]) => k !== "MERGED").map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Marca", "Brand")}<input name="brand" /></label>
              <label>{t("Fuente", "Source")}<input name="source" placeholder={t("catálogo SKF 2025, correo del proveedor…", "SKF catalog 2025, supplier email…")} /></label>
              <button type="submit">{t("Agregar", "Add")}</button>
            </form>
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("COMPRAS", "PURCHASES")}</b><span className="grow" /><span className="src">{t("lo que realmente pagamos, con fecha", "what we actually paid, with date")}</span></div>
            {buys.length === 0 ? <p className="quiet-p">{t("Nunca la hemos comprado.", "We've never bought it.")}</p> : (
              <table>
                <thead><tr><th>PO</th><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Cant.", "Qty")}</th><th className="n">{t("Costo unit.", "Unit cost")}</th><th>{t("Fecha", "Date")}</th></tr></thead>
                <tbody>
                  {buys.map((b) => {
                    const f = freshness(i, b.at, 180, now);
                    return (
                      <tr key={b.id}>
                        <td><Link className="val" href={`/compras/${b.po!.id}`}>{b.po!.code}</Link></td>
                        <td><Link href={`/suppliers/${b.po!.supplier.id}`}>{b.po!.supplier.name}</Link><span className="src block mono">{b.code}</span></td>
                        <td className="n mono">{b.qty}</td>
                        <td className="n mono">{b.po!.currency} {i.n2(b.unitCost)}</td>
                        <td className="mono">{i.day(b.at)} <span className={`fresh${f.stale ? " stale" : ""}`}>{f.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("COTIZACIONES Y JOURNEYS", "QUOTES & JOURNEYS")}</b></div>
            {h.quotes.length + h.items.length === 0 ? <p className="quiet-p">{t("No aparece en cotizaciones ni Journeys.", "It doesn't appear in quotes or Journeys.")}</p> : (
              <table>
                <thead><tr><th>{t("Dónde", "Where")}</th><th>{t("Cliente", "Customer")}</th><th className="n">{t("Cant.", "Qty")}</th><th className="n">{t("Precio unit.", "Unit price")}</th></tr></thead>
                <tbody>
                  {h.quotes.map((x) => (
                    <tr key={x.id}>
                      <td><Link className="val" href={`/cotizaciones/${x.quote!.id}`}>{x.quote!.number}{x.quote!.rev ? ` R${x.quote!.rev}` : ""}</Link><span className="src block">{t("cotización", "quote")} · {i.day(x.quote!.createdAt)}</span></td>
                      <td>{x.quote!.deal.account.name}</td>
                      <td className="n mono">{x.qty}</td>
                      <td className="n mono">{i.n2(x.unitPrice)}</td>
                    </tr>
                  ))}
                  {h.items.map((x) => (
                    <tr key={x.id}>
                      <td><Link className="val" href={`/deals/${x.deal!.id}`}>{x.deal!.code ?? x.deal!.title}</Link><span className="src block">Journey · {x.deal!.title}</span></td>
                      <td><Link href={`/accounts/${x.deal!.account.id}`}>{x.deal!.account.name}</Link></td>
                      <td className="n mono">{x.qty}</td>
                      <td className="n mono">{i.n2(x.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("FICHA", "DATA SHEET")}</b></div>
            <dl className="filedl">
              <dt>{t("Condición", "Condition")}</dt><dd>{L(CONDITION, p.condition)}</dd>
              <dt>{t("Estado de fabricación", "Lifecycle")}</dt><dd>{L(LIFE, p.lifecycle)}</dd>
              <dt>GTIN / EAN</dt><dd className="mono">{p.gtin ?? "—"}</dd>
              <dt>{t("Compatible con", "Compatible with")}</dt><dd>{p.compatibleModels.length ? p.compatibleModels.join(", ") : "—"}</dd>
              {specs.map((s, n) => <Fragment key={n}><dt>{s.k}</dt><dd>{s.v}</dd></Fragment>)}
              {p.notes && <><dt>{t("Notas", "Notes")}</dt><dd>{p.notes}</dd></>}
            </dl>
          </div>
          <details className="qa"><summary className="qa-btn">{t("Editar ficha", "Edit data sheet")}</summary><div className="qa-pop wide">
            <form action={updatePart.bind(null, p.id)} className="qa-form">
              <label>{t("Número de parte", "Part number")}<input name="mpn" required defaultValue={p.mpn} /></label>
              <label>{t("Descripción (español)", "Description (Spanish)")}<input name="name" required defaultValue={p.name} /></label>
              <label>{t("Descripción (inglés)", "Description (English)")}<input name="nameEn" defaultValue={p.nameEn ?? ""} /></label>
              <label>{t("Marca", "Brand")}<input name="brand" defaultValue={p.brand ?? ""} /></label>
              <label>{t("Línea", "Line")}<select name="category" defaultValue={p.category ?? ""}><option value="">—</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Condición", "Condition")}<select name="condition" defaultValue={p.condition ?? ""}><option value="">—</option>{Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Estado de fabricación", "Lifecycle")}<select name="lifecycle" defaultValue={p.lifecycle ?? ""}><option value="">—</option>{Object.entries(LIFE).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>GTIN / EAN<input name="gtin" defaultValue={p.gtin ?? ""} /></label>
              <label>{t("Compatible con (separa con comas)", "Compatible with (comma-separated)")}<input name="compatibleModels" defaultValue={p.compatibleModels.join(", ")} /></label>
              <label>{t("Notas", "Notes")}<textarea name="notes" rows={3} defaultValue={p.notes ?? ""} /></label>
              <p className="src">{t("Si cambias el número de parte, el anterior queda guardado y sigue encontrando esta parte.", "If you change the part number, the old one is kept and still finds this part.")}</p>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </div></details>
          {manager && (
            <details className="qa"><summary className="qa-btn">{t("Fusionar un duplicado aquí", "Merge a duplicate into this")}</summary><div className="qa-pop wide">
              <form action={mergeInto.bind(null, p.id)} className="qa-form" data-confirm={t("¿Fusionar? El duplicado desaparece de la búsqueda y sus números pasan a esta parte.", "Merge? The duplicate disappears from search and its numbers move to this part.")}>
                <label>{t("Número de parte del duplicado", "Duplicate's part number")}<input name="dup" required defaultValue={sp.err === "enotro" && other ? other.mpn : ""} /></label>
                <p className="src">{t("Úsalo cuando la misma parte quedó registrada dos veces con números distintos.", "Use it when the same part was recorded twice under different numbers.")}</p>
                <button type="submit">{t("Fusionar", "Merge")}</button>
              </form>
            </div></details>
          )}
          {p.merged.length > 0 && <p className="src">{t("Duplicados ya fusionados aquí:", "Duplicates merged here:")} {p.merged.map((m) => m.mpn).join(", ")}</p>}
          <p className="note ai">{t("Sin puntajes: junto a cada proveedor ves lo que prometió y lo que pasó, con cuántos casos lo respaldan.", "No scores: next to each supplier you see what they promised and what happened, with how many cases back it.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
