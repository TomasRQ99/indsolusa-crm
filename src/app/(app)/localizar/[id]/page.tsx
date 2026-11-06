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

type Sp = { ok?: string; err?: string; otro?: string; n?: string; deal?: string };

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
    rfq: t("Listo: el pendiente de pedir precio quedó en tu lista (Mi Día → Pendientes).", "Done: the ask-for-price to-do is on your list (My Day → To-dos)."),
    seguimiento: t("Listo: el recordatorio quedó en tu lista (Mi Día → Pendientes).", "Done: the reminder is on your list (My Day → To-dos)."),
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
    cotizacion: t("Esa cotización ya no está en borrador.", "That quote is no longer a draft."),
  };

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

      {sp.ok && notes[sp.ok] && <p className="note">{notes[sp.ok]}</p>}
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
          <span className="k">{t("SE BUSCA TAMBIÉN COMO", "ALSO SEARCHED AS")}</span>
          <b>{t(`${p.aliases.length} número(s)/nombre(s)`, `${p.aliases.length} number(s)/name(s)`)}</b>
          <span className="src">{p.aliases.slice(0, 3).map((a) => a.code).join(" · ") || t("solo su número", "only its number")}</span>
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
            <p className="src">{t("Crea un pendiente para ti (aparece en Mi Día). El correo automático a varios proveedores llega en la siguiente fase.", "Creates a to-do for you (shows in My Day). Automatic email to several suppliers comes in the next phase.")}</p>
            <button type="submit">{t("Crear pendiente", "Create to-do")}</button>
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
          <p className="note ai">{t("Próximamente aquí: ofertas de proveedores, solicitud de cotización a varios proveedores y búsqueda en internet con fuentes.", "Coming here soon: supplier offers, multi-supplier RFQs and web search with sources.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
