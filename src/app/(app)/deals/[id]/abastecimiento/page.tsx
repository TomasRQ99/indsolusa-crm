import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { supplyWorkspace, type FieldEvidence } from "@/lib/supply";
import { AVAILABILITY, IMPORT_FEAS, OBS_STATUS, PAY_METHOD, RFQ_ASKS, SUPPLY_RULES, payCost, payTradeoff, type AskKey, type AskLevel } from "@/lib/supply-rules";
import { addOption, addPaymentOption, discardOption, optionFromOffer, removePaymentOption, restoreOption, selectBasis, updateOption } from "./actions";

// Comercial C4 · Sourcing & Supply (§6–13): who can supply it, what exactly each one offers, how we'd pay, and the
// documented choice that backs our promise. SOLU never chooses: it shows trade-offs, evidence and what's missing.
export default async function SupplyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; n?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const W = await supplyWorkspace(id);
  const { d } = W;
  const editable = canEditOps(user, d.ownerId);
  const suppliers = editable ? await db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }) : [];
  const L = (x: { es: string; en: string } | undefined, fb = "—") => (x ? t(x.es, x.en) : fb);
  const now = today();
  const urgent = !!d.neededBy && d.neededBy.getTime() - now.getTime() < 14 * 864e5;
  const money = (cur: string, v: unknown) => (v == null ? "—" : `${cur} ${i.n2(Number(v))}`);
  const lead = (o: { leadDaysMin: number | null; leadDaysMax: number | null }) => (o.leadDaysMin == null && o.leadDaysMax == null ? "—" : o.leadDaysMin === o.leadDaysMax || o.leadDaysMax == null ? t(`${o.leadDaysMin} días`, `${o.leadDaysMin} days`) : t(`${o.leadDaysMin ?? "?"}–${o.leadDaysMax} días`, `${o.leadDaysMin ?? "?"}–${o.leadDaysMax} days`));
  // Comparison rows: complete scope first; when urgent, faster first; otherwise cheaper first. SOLU orders, the person decides.
  const rows = [...W.live].sort((a, b) => {
    const ca = W.eq.byId.get(a.id)?.complete === false ? 1 : 0; const cb = W.eq.byId.get(b.id)?.complete === false ? 1 : 0;
    if (ca !== cb) return ca - cb;
    if (urgent) return (a.leadDaysMin ?? 9e9) - (b.leadDaysMin ?? 9e9);
    return (a.price == null ? 9e12 : Number(a.price)) - (b.price == null ? 9e12 : Number(b.price));
  });
  const discarded = W.options.filter((o) => o.status === "DISCARDED");
  const partsQs = W.parts.map((p) => `part=${p.id}`).join("&");

  const okMsg: Record<string, string> = {
    opcion: t("Opción guardada. Cada dato quedó con su fuente y fecha.", "Option saved. Every value keeps its source and date."),
    editada: t("Opción actualizada. Solo los datos que cambiaron tomaron la nueva fuente.", "Option updated. Only the values that changed took the new source."),
    descartada: t("Opción descartada con su motivo (queda en el historial).", "Option discarded with its reason (kept in history)."),
    pago: t("Forma de pago actualizada.", "Payment option updated."),
    base: t("Base de suministro registrada. La anterior queda como historial. No se creó ninguna orden de compra.", "Supply basis recorded. The previous one stays as history. No purchase order was created."),
    busqueda: t("Búsqueda guardada en el Journey.", "Search saved on the Journey."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Solo quien lleva el Journey, un Negociador Operativo o la dirección pueden cambiar el abastecimiento.", "Only the Journey owner, an Operations Negotiator or management can change sourcing."),
    opcion: t("Elige el proveedor y describe qué ofrece.", "Pick the supplier and describe what they offer."),
    fuente: t("Di de dónde salen los datos (correo, proforma, llamada…): sin fuente no se guardan.", "Say where the values come from (email, proforma, call…): without a source they aren't saved."),
    fecha: t("La fecha de la respuesta no puede ser futura.", "The answer date can't be in the future."),
    motivo: t("Escribe por qué se descarta.", "Write why it's discarded."),
    "en-base": t("Esta opción está en la base de suministro vigente: elige otra base antes de descartarla.", "This option is in the current supply basis: choose another basis before discarding it."),
    pago: t("Elige la forma de pago.", "Pick the payment method."),
    "pago-en-base": t("Esa forma de pago está en la base vigente.", "That payment option is in the current basis."),
    base: t("Elige la opción principal y escribe por qué.", "Pick the primary option and write why."),
    respaldo: t("El respaldo debe ser otra opción.", "The backup must be a different option."),
    "pago-base": t("La forma de pago debe ser de la opción principal.", "The payment option must belong to the primary option."),
    incompleta: t(`La opción principal no incluye: ${sp.n ?? ""}. Di cómo se cubre eso (otro proveedor, el cliente lo pone…) o elige una opción completa.`, `The primary option doesn't include: ${sp.n ?? ""}. Say how that's covered (another supplier, customer supplies it…) or choose a complete option.`),
  };

  const Ev = ({ ev, k }: { ev: FieldEvidence; k: string }) => (ev[k] ? <span className="src" title={`${ev[k].src} · ${ev[k].at.slice(0, 10)}`}> ⓘ</span> : null);

  const OptionFields = ({ o }: { o?: (typeof W.options)[number] }) => (
    <>
      <label>{t("Qué ofrece (en palabras del proveedor)", "What they offer (supplier's words)")}<input name="label" required maxLength={200} defaultValue={o?.label ?? ""} placeholder={t("Ej.: Motorreductor SEW completo / Solo motor 7,5 kW", "E.g.: Complete SEW gearmotor / Motor only 7.5 kW")} /></label>
      {W.needs.length > 0 && (
        <fieldset className="scp-fs"><legend className="small">{t("¿Qué componentes del alcance incluye?", "Which scope components does it include?")}</legend>
          {W.needs.map((n) => <label key={n.id} className="chk"><input type="checkbox" name="covers" value={n.id} defaultChecked={o ? o.covers.includes(n.id) : false} /> {n.component}</label>)}
        </fieldset>
      )}
      <div className="qa-row">
        <label>{t("Precio total", "Total price")}<input name="price" inputMode="decimal" defaultValue={o?.price != null ? String(o.price) : ""} /></label>
        <label>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue={o?.currency ?? "USD"} style={{ width: 70 }} /></label>
        <label>{t("Cant.", "Qty")}<input name="qty" type="number" min={1} defaultValue={o?.qty ?? ""} /></label>
        <label>{t("Stock físico", "Physical stock")}<input name="stockQty" type="number" min={0} defaultValue={o?.stockQty ?? ""} /></label>
      </div>
      <div className="qa-row">
        <label>{t("Plazo mín. (días)", "Lead min (days)")}<input name="leadDaysMin" type="number" min={0} defaultValue={o?.leadDaysMin ?? ""} /></label>
        <label>{t("Plazo máx. (días)", "Lead max (days)")}<input name="leadDaysMax" type="number" min={0} defaultValue={o?.leadDaysMax ?? ""} /></label>
        <label>{t("Qué inicia el plazo", "What starts the lead time")}<input name="leadTrigger" maxLength={120} defaultValue={o?.leadTrigger ?? ""} placeholder={t("Ej.: al recibir el pago", "E.g.: on receipt of payment")} /></label>
        <label>{t("Vigencia", "Valid until")}<input name="validUntil" type="date" defaultValue={o?.validUntil ? dayInput(o.validUntil) : ""} /></label>
      </div>
      <div className="qa-row">
        <label>{t("Condición", "Condition")}<input name="condition" maxLength={60} defaultValue={o?.condition ?? ""} /></label>
        <label>{t("Garantía", "Warranty")}<input name="warranty" maxLength={120} defaultValue={o?.warranty ?? ""} /></label>
        <label>Incoterm<input name="incoterm" maxLength={20} defaultValue={o?.incoterm ?? ""} /></label>
        <label>{t("Recogida (ciudad, país, ZIP)", "Pickup (city, country, ZIP)")}<input name="pickup" maxLength={160} defaultValue={o?.pickup ?? ""} /></label>
      </div>
      <div className="qa-row">
        <label>{t("Origen", "Origin")}<input name="origin" maxLength={60} defaultValue={o?.origin ?? ""} /></label>
        <label>{t("HS del proveedor", "Supplier HS")}<input name="hsSupplier" maxLength={20} defaultValue={o?.hsSupplier ?? ""} /></label>
        <label>{t("Peso bruto kg", "Gross kg")}<input name="grossKg" inputMode="decimal" defaultValue={o?.grossKg != null ? String(o.grossKg) : ""} /></label>
        <label>{t("Medidas cm (L×A×H)", "Size cm (L×W×H)")}<input name="dims" maxLength={80} defaultValue={o?.dims ?? ""} placeholder="60x40x35" /></label>
        <label>{t("Bultos", "Packages")}<input name="packages" type="number" min={0} defaultValue={o?.packages ?? ""} /></label>
      </div>
      <label>{t("Incluye", "Includes")}<input name="includedNote" maxLength={600} defaultValue={o?.includedNote ?? ""} /></label>
      <label>{t("No incluye", "Excludes")}<input name="excludedNote" maxLength={600} defaultValue={o?.excludedNote ?? ""} /></label>
      <div className="qa-row">
        <label>{t("Tipo de dato", "Kind of data")}<select name="availability" defaultValue={o?.availability ?? "QUOTE"}>{Object.entries(AVAILABILITY).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
        {o && <label>{t("Importación", "Import")}<select name="importFeasibility" defaultValue={o.importFeasibility}>{Object.entries(IMPORT_FEAS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>}
        {W.parts.length > 0 && <label>{t("Parte del catálogo", "Catalog part")}<select name="partId" defaultValue={W.parts.length === 1 ? W.parts[0].id : ""}><option value="">—</option>{W.parts.map((p) => <option key={p.id} value={p.id}>{p.mpn}</option>)}</select></label>}
      </div>
      {o && <label>{t("Supuestos de importación", "Import assumptions")}<input name="importNote" maxLength={400} defaultValue={o.importNote ?? ""} /></label>}
      <div className="qa-row">
        <label style={{ flex: 2 }}>{t("Fuente de estos datos", "Source of these values")}<input name="source" maxLength={200} placeholder={t("Correo de Ana (Grainger) del 9 nov, proforma PF-221…", "Ana's email (Grainger) Nov 9, proforma PF-221…")} /></label>
        <label>{t("Fecha de la respuesta", "Answer date")}<input name="answeredAt" type="date" defaultValue={dayInput(now)} /></label>
      </div>
    </>
  );

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=source`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Abastecimiento", "Sourcing & supply")}</span>
          <span className="grow" />
          <Link className="qa-btn" href={`/deals/${d.id}/alcance`}>{t("Técnico y alcance", "Technical & scope")}</Link>
        </div>
        <div className="jh-title">
          <h1>{t("¿Quién lo puede suministrar, exactamente qué y cómo pagaríamos?", "Who can supply it, exactly what, and how would we pay?")}</h1>
          {W.current ? <span className={`sig ${W.freshFor(W.options.find((o) => o.id === W.current!.primaryId)!).ok ? "ok" : "attn"}`}>{t("Base de suministro elegida", "Supply basis chosen")}</span> : <span className="sig wait">{t("Sin base de suministro", "No supply basis yet")}</span>}
        </div>
        <p className="jh-sub">{d.title}{d.desiredResult ? ` · ${t("Resultado", "Result")}: ${d.desiredResult}` : ""}{d.neededBy ? ` · ${t("Se necesita el", "Needed by")} ${i.day(d.neededBy)}` : ""}</p>
      </header>

      {/* 1 · Supply basis */}
      <section className="jblock" id="base">
        <div className="jbh"><b>{t("BASE DE SUMINISTRO", "SUPPLY BASIS")}</b><span className="grow" /><span className="src">{t("La selección documentada que respalda la promesa. No crea orden de compra.", "The documented choice backing the promise. It doesn't create a purchase order.")}</span></div>
        {W.current ? (() => {
          const p = W.options.find((o) => o.id === W.current!.primaryId)!;
          const f = W.freshFor(p);
          const b = W.current.backupId ? W.options.find((o) => o.id === W.current!.backupId) : null;
          const fb = b ? W.freshFor(b) : null;
          return (
            <div className="stack">
              <p><b>{t("Principal", "Primary")}:</b> {p.supplier.name} — {p.label} · {money(p.currency, p.price)} <span className={`sig ${f.ok ? "ok" : "attn"}`}>{L(f.why)}</span></p>
              {b && <p><b>{t("Respaldo", "Backup")}:</b> {b.supplier.name} — {b.label} · {money(b.currency, b.price)} <span className={`sig ${fb!.ok ? "ok" : "attn"}`}>{L(fb!.why)}</span></p>}
              {W.current.paymentOption && <p className="small"><b>{t("Pago planeado", "Planned payment")}:</b> {L(PAY_METHOD[W.current.paymentOption.method])}{W.current.paymentOption.confirmed ? "" : ` · ${t("condiciones sin confirmar", "conditions not confirmed")}`}</p>}
              <p className="small"><b>{t("Por qué", "Why")}:</b> {W.current.reason}</p>
              {W.current.risks && <p className="small" style={{ whiteSpace: "pre-line" }}><b>{t("Riesgos", "Risks")}:</b> {W.current.risks}</p>}
              <p className="src">{W.current.selectedByName} · {i.day(W.current.createdAt)}</p>
              {!f.ok && <p className="note attn">{t("La fuente ya no está vigente: revalida con el proveedor antes de comprometer fecha o precio con el cliente.", "The source is no longer current: re-confirm with the supplier before committing a date or price to the customer.")}</p>}
            </div>
          );
        })() : <p className="quiet-p">{t("Aún no se ha elegido. Registra las opciones abajo y elige cuando tengas con qué comparar.", "Not chosen yet. Record the options below and choose once you have something to compare.")}</p>}
        {editable && W.live.length > 0 && (
          <details className="scp-add" open={!!sp.err && ["base", "respaldo", "pago-base", "incompleta"].includes(sp.err)}><summary className="qa-btn">{W.current ? t("Cambiar la base", "Change the basis") : t("Elegir la base", "Choose the basis")}</summary>
            <form action={selectBasis.bind(null, d.id)} className="qa-form">
              <div className="qa-row">
                <label>{t("Principal", "Primary")}<select name="primaryId" required defaultValue={W.current?.primaryId ?? ""}><option value="" disabled>—</option>{W.live.map((o) => <option key={o.id} value={o.id}>{o.supplier.name} — {o.label.slice(0, 60)}</option>)}</select></label>
                <label>{t("Respaldo (opcional)", "Backup (optional)")}<select name="backupId" defaultValue={W.current?.backupId ?? ""}><option value="">—</option>{W.live.map((o) => <option key={o.id} value={o.id}>{o.supplier.name} — {o.label.slice(0, 60)}</option>)}</select></label>
              </div>
              {W.live.some((o) => o.paymentOptions.length) && <label>{t("Forma de pago planeada (de la principal)", "Planned payment (of the primary)")}<select name="paymentOptionId" defaultValue={W.current?.paymentOptionId ?? ""}><option value="">—</option>{W.live.flatMap((o) => o.paymentOptions.map((p) => <option key={p.id} value={p.id}>{o.supplier.name} · {L(PAY_METHOD[p.method])}</option>))}</select></label>}
              <label>{t("Por qué esta (lo verá quien revise)", "Why this one (reviewers will see it)")}<textarea name="reason" rows={2} required maxLength={600} /></label>
              <label>{t("Riesgos conocidos (opcional)", "Known risks (optional)")}<input name="risks" maxLength={600} /></label>
              {W.eq.known && <label>{t("Si la principal no incluye todo: cómo se cubre lo que falta", "If the primary doesn't include everything: how the rest is covered")}<input name="gapCover" maxLength={400} /></label>}
              <button type="submit">{t("Registrar base de suministro", "Record supply basis")}</button>
            </form>
          </details>
        )}
        {W.history.length > 0 && <details className="src"><summary>{t(`${W.history.length} base(s) anterior(es)`, `${W.history.length} earlier basis(es)`)}</summary><ul>{W.history.map((h) => <li key={h.id}>{i.day(h.createdAt)} · {h.primary.supplier.name} — {h.primary.label}{h.backup ? ` / ${h.backup.supplier.name}` : ""} · {h.selectedByName} · «{h.reason}»</li>)}</ul></details>}
      </section>

      {/* 2 · Comparison */}
      <section className="jblock" id="comparar">
        <div className="jbh"><b>{t("COMPARAR OPCIONES", "COMPARE OPTIONS")}</b><span className="grow" /><span className="src">{urgent ? t("Es urgente: primero las más rápidas", "It's urgent: fastest first") : t("Primero las más baratas", "Cheapest first")} · {t("sin puntaje", "no score")} · {SUPPLY_RULES}</span></div>
        {!W.eq.known && W.live.length > 1 && <p className="note attn">{t("Este Journey no tiene matriz de alcance: SOLU no puede saber si las ofertas incluyen lo mismo. Revisa «Incluye / No incluye» antes de comparar precios.", "This Journey has no scope matrix: SOLU can't tell whether offers include the same. Check “Includes / Excludes” before comparing prices.")} <Link href={`/deals/${d.id}/alcance`}>{t("Abrir alcance", "Open scope")}</Link></p>}
        {rows.length === 0 ? <p className="quiet-p">{t("Sin opciones todavía.", "No options yet.")}</p> : (
          <div className="tscroll"><table className="scp-mx">
            <thead><tr><th>{t("Opción", "Option")}</th><th>{t("Alcance", "Scope")}</th><th className="n">{t("Precio", "Price")}</th><th>{t("Plazo", "Lead time")}</th><th className="n">{t("Stock", "Stock")}</th><th>{t("Vigencia", "Validity")}</th><th>{t("Origen", "Origin")}</th><th>{t("Importación", "Import")}</th><th>{t("Dato", "Data")}</th></tr></thead>
            <tbody>{rows.map((o) => {
              const e = W.eq.byId.get(o.id);
              const f = W.freshFor(o);
              return (
                <tr key={o.id} className={e?.complete === false ? "gap" : ""}>
                  <td><a href={`#o-${o.id}`}><b>{o.supplier.name}</b></a><span className="src block">{o.label}</span></td>
                  <td>{e?.complete == null ? <span className="src">{t("sin matriz", "no matrix")}</span> : e.complete ? <span className="sig ok">{t("Completo", "Complete")}</span> : <span className="risk-t small">{t("Le falta", "Missing")}: {e.missing.map((m) => m.component).join(", ")}</span>}</td>
                  <td className="n">{money(o.currency, o.price)}{W.lowest.has(o.id) && <span className="src block">{t("menor entre comparables", "lowest among comparable")}</span>}{e?.complete === false && o.price != null && <span className="src block">{t("no comparable", "not comparable")}</span>}</td>
                  <td>{lead(o)}{o.leadTrigger && <span className="src block">{o.leadTrigger}</span>}</td>
                  <td className="n">{o.stockQty ?? "—"}</td>
                  <td><span className={f.ok ? "small" : "attn-t small"}>{L(f.why)}</span></td>
                  <td>{o.origin ?? "—"}</td>
                  <td><span className={`sig ${IMPORT_FEAS[o.importFeasibility]?.tone ?? "info"}`}>{L(IMPORT_FEAS[o.importFeasibility])}</span></td>
                  <td className="small">{L(AVAILABILITY[o.availability])}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {W.eq.known && rows.some((o) => W.eq.byId.get(o.id)?.complete === false) && <p className="src">{t("Una oferta sin un componente necesario no es más barata: es otra cosa. Los precios solo se comparan entre opciones con el mismo alcance.", "An offer missing a needed component isn't cheaper: it's something else. Prices are only compared between options with the same scope.")}</p>}
      </section>

      {/* 3 · Options, field by field */}
      <section className="jblock" id="opciones">
        <div className="jbh"><b>{t("OPCIONES DE SUMINISTRO", "SUPPLY OPTIONS")}</b><span className="grow" /><span className="src">{t("ⓘ = fuente y fecha de cada dato", "ⓘ = source and date of each value")}</span></div>
        {W.live.map((o) => {
          const ev = (o.evidence ?? {}) as FieldEvidence;
          const tradeoff = o.price != null ? payTradeoff(Number(o.price), o.paymentOptions.map((p) => ({ id: p.id, method: p.method, surchargePct: p.surchargePct == null ? null : Number(p.surchargePct), fixedFee: p.fixedFee == null ? null : Number(p.fixedFee), fxSpreadPct: p.fxSpreadPct == null ? null : Number(p.fxSpreadPct), daysToRelease: p.daysToRelease, confirmed: p.confirmed })), o.currency) : null;
          return (
            <div key={o.id} id={`o-${o.id}`} className="scp-tech">
              <div className="scp-tech-h"><b>{o.supplier.name}</b><span className="src"> · {o.label}</span><span className="grow" />
                {editable && <details className="qa"><summary className="qa-btn">{t("Editar", "Edit")}</summary><div className="qa-pop wide right">
                  <form action={updateOption.bind(null, o.id)} className="qa-form"><OptionFields o={o} /><span className="src">{t("Solo los datos que cambies tomarán esta fuente.", "Only the values you change take this source.")}</span><button type="submit">{t("Guardar", "Save")}</button></form>
                  <form action={discardOption.bind(null, o.id)} className="qa-form" style={{ marginTop: 10 }}><label>{t("Descartar: por qué", "Discard: why")}<input name="reason" maxLength={300} required /></label><button type="submit" className="secondary">{t("Descartar opción", "Discard option")}</button></form>
                </div></details>}
              </div>
              <dl className="qv-dl tight2">
                <dt>{t("Precio", "Price")}</dt><dd>{money(o.currency, o.price)}{o.qty ? ` · ${t("cant.", "qty")} ${o.qty}` : ""}<Ev ev={ev} k="price" /></dd>
                <dt>{t("Plazo", "Lead time")}</dt><dd>{lead(o)}{o.leadTrigger ? ` · ${o.leadTrigger}` : ""}<Ev ev={ev} k="leadDaysMin" /></dd>
                <dt>{t("Stock", "Stock")}</dt><dd>{o.stockQty ?? "—"}<Ev ev={ev} k="stockQty" /></dd>
                <dt>{t("Condición / garantía", "Condition / warranty")}</dt><dd>{[o.condition, o.warranty].filter(Boolean).join(" · ") || "—"}<Ev ev={ev} k="condition" /></dd>
                <dt>{t("Logística", "Logistics")}</dt><dd>{[o.incoterm, o.pickup, o.grossKg != null ? `${i.n2(Number(o.grossKg))} kg` : null, o.dims, o.packages != null ? t(`${o.packages} bulto(s)`, `${o.packages} package(s)`) : null].filter(Boolean).join(" · ") || "—"}<Ev ev={ev} k="grossKg" /></dd>
                <dt>{t("Origen / HS proveedor", "Origin / supplier HS")}</dt><dd>{[o.origin, o.hsSupplier].filter(Boolean).join(" · ") || "—"}<Ev ev={ev} k="origin" />{o.hsSupplier && <span className="src block">{t("El HS del proveedor no es la clasificación colombiana.", "The supplier's HS is not the Colombian classification.")}</span>}</dd>
                <dt>{t("Incluye / no incluye", "Includes / excludes")}</dt><dd>{o.includedNote ?? "—"}{o.excludedNote ? <span className="block risk-t small">{t("No incluye", "Excludes")}: {o.excludedNote}</span> : null}</dd>
                <dt>{t("Importación", "Import")}</dt><dd><span className={`sig ${IMPORT_FEAS[o.importFeasibility]?.tone ?? "info"}`}>{L(IMPORT_FEAS[o.importFeasibility])}</span>{o.importNote ? ` · ${o.importNote}` : ""}</dd>
              </dl>
              {/* §9 Payment Method Compare */}
              <div className="sup-pay">
                <p className="small"><b>{t("Cómo pagarle", "How to pay them")}</b></p>
                {o.paymentOptions.length === 0 ? <p className="src">{t("Sin formas de pago registradas. Pregúntalas en la RFQ (recargo de tarjeta, días hasta reconocer la transferencia, si libera el stock al pagar).", "No payment options recorded. Ask in the RFQ (card surcharge, days to recognize a wire, whether stock is released on payment).")}</p> : (
                  <div className="tscroll"><table className="scp-mx">
                    <thead><tr><th>{t("Medio", "Method")}</th><th className="n">{t("Costo efectivo", "Effective cost")}</th><th>{t("Días hasta liberar", "Days to release")}</th><th>{t("Qué libera el stock", "Release trigger")}</th><th>{t("Confirmado", "Confirmed")}</th>{editable && <th />}</tr></thead>
                    <tbody>{o.paymentOptions.map((p) => {
                      const c = o.price != null ? payCost(Number(o.price), { id: p.id, method: p.method, surchargePct: p.surchargePct == null ? null : Number(p.surchargePct), fixedFee: p.fixedFee == null ? null : Number(p.fixedFee), fxSpreadPct: p.fxSpreadPct == null ? null : Number(p.fxSpreadPct), daysToRelease: p.daysToRelease, confirmed: p.confirmed }) : null;
                      const unk = c?.unknown.filter((u) => u !== "days").map((u) => ({ surcharge: t("recargo", "surcharge"), fee: t("comisión", "fee"), fx: t("diferencial cambiario", "FX spread") })[u as "surcharge" | "fee" | "fx"]) ?? [];
                      return (
                        <tr key={p.id}>
                          <td>{L(PAY_METHOD[p.method])}{p.source && <span className="src block">{p.source}</span>}</td>
                          <td className="n">{c ? <>{c.floor ? "≥ " : ""}{o.currency} {i.n2(c.total)}{unk.length > 0 && <span className="src block">{t("falta", "unknown")}: {unk.join(", ")}</span>}</> : "—"}</td>
                          <td>{p.daysToRelease ?? <span className="src">{t("desconocido", "unknown")}</span>}</td>
                          <td className="small">{p.releaseTrigger ?? "—"}</td>
                          <td>{p.confirmed ? <span className="sig ok">{t("Sí", "Yes")}</span> : <span className="sig attn">{t("Supuesto", "Assumed")}</span>}</td>
                          {editable && <td><form action={removePaymentOption.bind(null, p.id)}><button type="submit" className="linkb">{t("Quitar", "Remove")}</button></form></td>}
                        </tr>
                      );
                    })}</tbody>
                  </table></div>
                )}
                {tradeoff && <p className="small">{L(tradeoff)}</p>}
                {o.paymentOptions.some((p) => !p.confirmed) && <p className="src">{t("No asumas que la tarjeta es gratis o inmediata: confirma recargo, cambio y liberación con el proveedor.", "Don't assume a card is free or instant: confirm surcharge, FX and release with the supplier.")}</p>}
                {editable && (
                  <details className="qa"><summary className="qa-btn">{t("+ Forma de pago", "+ Payment option")}</summary><div className="qa-pop wide">
                    <form action={addPaymentOption.bind(null, o.id)} className="qa-form">
                      <div className="qa-row">
                        <label>{t("Medio", "Method")}<select name="method" required defaultValue="WIRE">{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
                        <label>{t("Recargo %", "Surcharge %")}<input name="surchargePct" inputMode="decimal" placeholder={t("vacío = desconocido", "blank = unknown")} /></label>
                        <label>{t("Comisión fija", "Fixed fee")}<input name="fixedFee" inputMode="decimal" /></label>
                        <label>{t("Dif. cambiario %", "FX spread %")}<input name="fxSpreadPct" inputMode="decimal" /></label>
                      </div>
                      <div className="qa-row">
                        <label>{t("Días hasta liberar", "Days to release")}<input name="daysToRelease" type="number" min={0} /></label>
                        <label style={{ flex: 2 }}>{t("Qué libera el stock", "What releases the stock")}<input name="releaseTrigger" maxLength={160} placeholder={t("Ej.: al ver el dinero acreditado", "E.g.: when funds are credited")} /></label>
                      </div>
                      <label className="chk"><input type="checkbox" name="confirmed" value="1" /> {t("El proveedor lo confirmó (no es un supuesto nuestro)", "The supplier confirmed it (not our assumption)")}</label>
                      <label>{t("Fuente", "Source")}<input name="source" maxLength={200} /></label>
                      <button type="submit">{t("Agregar", "Add")}</button>
                    </form>
                  </div></details>
                )}
              </div>
            </div>
          );
        })}
        {editable && (
          <details className="scp-add" open={sp.err === "opcion" || sp.err === "fuente"}><summary className="qa-btn">{t("+ Opción de suministro", "+ Supply option")}</summary>
            <form action={addOption.bind(null, d.id)} className="qa-form">
              <label>{t("Proveedor", "Supplier")}<select name="supplierId" required defaultValue=""><option value="" disabled>—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              {W.rfqs.length > 0 && <label>{t("Responde a la RFQ", "Answers RFQ")}<select name="rfqId" defaultValue=""><option value="">—</option>{W.rfqs.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label>}
              <OptionFields />
              <button type="submit">{t("Guardar opción", "Save option")}</button>
            </form>
          </details>
        )}
        {W.offers.length > 0 && (
          <div className="scp-sug">
            <p className="src">{t("Ofertas registradas de proveedores para las partes de este Journey (aún no usadas aquí):", "Supplier offers recorded for this Journey's parts (not used here yet):")}</p>
            <ul>{W.offers.slice(0, 12).map((of) => (
              <li key={of.id}><b>{of.supplier.name}</b> · <span className="mono">{of.part.mpn}</span> · {of.currency} {i.n2(Number(of.unitPrice))}{of.qty ? ` × ${of.qty}` : ""}{of.validUntil ? ` · ${t("vigente hasta", "valid until")} ${i.day(of.validUntil)}` : ""} <span className="src">· {i.day(of.createdAt)}</span>
                {editable && <form action={optionFromOffer.bind(null, d.id, of.id)} className="inline"><button type="submit" className="linkb">{t("Usar como opción", "Use as option")}</button></form>}
              </li>
            ))}</ul>
          </div>
        )}
        {discarded.length > 0 && <details className="src"><summary>{t(`${discarded.length} opción(es) descartada(s)`, `${discarded.length} discarded option(s)`)}</summary><ul>{discarded.map((o) => <li key={o.id}>{o.supplier.name} — {o.label} · «{o.discardReason}» {editable && <form action={restoreOption.bind(null, o.id)} className="inline"><button type="submit" className="linkb">{t("Recuperar", "Restore")}</button></form>}</li>)}</ul></details>}
      </section>

      {/* 4 · RFQs */}
      <section className="jblock" id="rfq">
        <div className="jbh"><b>{t("PEDIR COTIZACIÓN", "REQUEST QUOTES")}</b><span className="grow" />{W.parts.length > 0 && <Link className="qa-btn" href={`/localizar/rfq/nueva?${partsQs}&deal=${d.id}`}>{t("Nueva RFQ", "New RFQ")}</Link>}</div>
        {W.parts.length === 0 && <p className="src">{t("Para pedir cotización, primero busca la parte en Localizar repuestos (desde la pestaña Fuente).", "To request quotes, first find the part in Find parts (from the Source tab).")}</p>}
        {W.rfqs.length === 0 ? <p className="quiet-p">{t("Ninguna RFQ enviada para este Journey.", "No RFQ sent for this Journey.")}</p> : (
          <ul className="exc-hist">{W.rfqs.map((r) => {
            const asked = Array.isArray(r.asked) ? (r.asked as { key: AskKey; level: AskLevel }[]) : [];
            return (
              <li key={r.id}><Link href={`/localizar/rfq/${r.id}`} className="mono">{r.code}</Link> <span className="src">· {i.day(r.createdAt)}</span>
                <span className="block small">{r.recipients.map((x) => `${x.supplier.name}: ${x.repliedAt ? t("respondió", "replied") : x.status === "DECLINED" ? t("no cotiza", "declined") : x.status === "FAILED" ? t("no se envió", "not sent") : t("esperando", "waiting")}`).join(" · ")}</span>
                {asked.length > 0 && <span className="src block">{t("Se preguntó además", "Also asked")}: {asked.map((a) => t(RFQ_ASKS[a.key]?.es ?? a.key, RFQ_ASKS[a.key]?.en ?? a.key)).join(" · ")}</span>}
              </li>
            );
          })}</ul>
        )}
      </section>

      {/* 5 · Saved searches */}
      <section className="jblock" id="busquedas">
        <div className="jbh"><b>{t("BÚSQUEDAS GUARDADAS", "SAVED SEARCHES")}</b><span className="grow" /><Link className="qa-btn" href={`/localizar?deal=${d.id}`}>{t("Buscar", "Search")}</Link></div>
        {W.searches.length === 0 ? <p className="quiet-p">{t("Busca desde aquí y guarda la búsqueda: quedan las candidatas y por qué se descartaron las demás.", "Search from here and save it: the candidates and why the others were discarded stay recorded.")}</p> : (
          <ul className="exc-hist">{W.searches.map((s) => {
            const c = (s.candidates ?? []) as { mpn: string; brand?: string | null }[];
            const x = (s.discarded ?? []) as { mpn: string; reason: string }[];
            return <li key={s.id}><b>«{s.query}»</b> <span className="src">· {s.recordedByName} · {i.day(s.createdAt)}{s.sources.length ? ` · ${s.sources.join(", ")}` : ""}</span>
              {c.length > 0 && <span className="block small">{t("Candidatas", "Candidates")}: {c.map((h) => h.mpn).join(", ")}</span>}
              {x.length > 0 && <span className="block small src">{t("Descartadas", "Discarded")}: {x.map((h) => `${h.mpn} (${h.reason})`).join("; ")}</span>}
              {s.note && <span className="block small">{s.note}</span>}</li>;
          })}</ul>
        )}
      </section>

      {/* 6 · Logistics passport + import precedents */}
      <section className="jblock" id="logistica">
        <div className="jbh"><b>{t("LOGÍSTICA E IMPORTACIÓN DE ESTAS PARTES", "LOGISTICS & IMPORT OF THESE PARTS")}</b></div>
        {W.passports.length === 0 ? <p className="quiet-p">{t("Las partes de este Journey aún no están en el catálogo.", "This Journey's parts aren't in the catalog yet.")}</p> : (
          <ul className="exc-hist">{W.passports.map(({ part, passport: pp, learning, count }) => (
            <li key={part.id}><Link href={`/localizar/${part.id}#pasaporte`} className="mono">{part.mpn}</Link> <span className="src">· {t(`${count} observación(es)`, `${count} observation(s)`)}</span>
              <span className="block small">{pp.grossKg ? <>{t("Peso bruto", "Gross weight")} <b>{pp.grossKg.value} kg</b> ({L(OBS_STATUS[pp.grossKg.status])}, {i.day(pp.grossKg.at)}{pp.grossKg.qtyContext ? t(`, para ${pp.grossKg.qtyContext} u.`, `, for ${pp.grossKg.qtyContext} pcs`) : ""}){pp.grossKg.stale && <span className="attn-t"> · {t("revalidar", "re-confirm")}</span>}</> : t("Peso: sin datos", "Weight: no data")}
                {pp.dims ? ` · ${pp.dims.l}×${pp.dims.w}×${pp.dims.h} cm (${pp.dims.volM3} m³)` : ""}{pp.origin ? ` · ${t("origen", "origin")} ${pp.origin.value}` : ""}</span>
              {learning.slice(0, 2).map((l) => <span key={l.measured.id} className="block small">{t(`Se esperaba ${l.expected.grossKg} kg y se midió ${l.measured.grossKg} kg (${l.diffPct > 0 ? "+" : ""}${l.diffPct} %).`, `Expected ${l.expected.grossKg} kg, measured ${l.measured.grossKg} kg (${l.diffPct > 0 ? "+" : ""}${l.diffPct}%).`)}</span>)}
              {W.imports.filter((m) => m.partId === part.id).slice(0, 2).map((m) => <span key={m.id} className="block small">{t("Precedente de importación", "Import precedent")} {i.day(m.importedAt)}: {m.hsCode ? `${t("subpartida", "subheading")} ${m.hsCode}` : ""}{m.approvals ? ` · ${m.approvals}` : ""}{m.days != null ? t(` · ${m.days} días`, ` · ${m.days} days`) : ""} <span className="src">— {t("referencia con fecha; no confirma que la norma siga vigente", "dated reference; it doesn't confirm the rule is still current")}</span></span>)}
            </li>
          ))}</ul>
        )}
        <p className="src">{t("Para registrar una medición al recibir o una importación real, abre la parte.", "To record a measurement at receipt or a real import, open the part.")}</p>
      </section>
    </div>
  );
}
