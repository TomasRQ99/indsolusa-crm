import Link from "next/link";
import { db } from "@/lib/db";
import { today, dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { EXC_TEXT, LOT_STATES, MAX_RECEIPT_PHOTOS } from "@/lib/stock-rules";
import { recordReceipt } from "@/app/(app)/compras/recepcion-actions";
import { ReceiptPhotosAdd } from "@/components/ReceiptPhotosAdd";

// Operaciones O6 · receiving goods against a Supplier PO: ordered vs received per line (a partial delivery keeps its
// balance), the checks beyond quantity, where each unit ended up, and the photo evidence.

export async function SpoReceipt({ spoId, lang, editable }: { spoId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const spo = await db.supplierPO.findUnique({ where: { id: spoId }, select: { id: true, releasedAt: true, lines: { orderBy: { position: "asc" } }, receipts: { orderBy: { receivedAt: "asc" }, include: { location: true, lines: { orderBy: { position: "asc" }, include: { lots: { include: { deal: { select: { code: true, title: true } } } } } }, photos: { select: { id: true, name: true } } } } } });
  if (!spo?.releasedAt) return null;
  const locations = await db.stockLocation.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const got = (pos: number) => spo.receipts.flatMap((r) => r.lines).filter((l) => l.position === pos).reduce((s, l) => s + l.qtyReceived, 0);
  const pending = spo.lines.some((l) => got(l.position) < l.qty);
  const okNo = (name: string) => <select name={name} defaultValue="yes" style={{ flex: "0 0 86px" }}><option value="yes">{t("Sí", "Yes")}</option><option value="no">No</option></select>;

  return (
    <section className="jblock" id="recepcion">
      <div className="jbh"><b>{t("RECEPCIÓN", "GOODS RECEIPT")}</b><span className="grow" />{spo.receipts.length === 0 ? <span className="sig wait">{t("Sin recibir", "Not received")}</span> : pending ? <span className="sig attn">{t("Recibido en parte", "Partly received")}</span> : <span className="sig ok">{t("Recibido completo", "Fully received")}</span>}</div>
      <div className="tscroll"><table>
        <thead><tr><th>{t("Producto", "Product")}</th><th className="n">{t("Pedido", "Ordered")}</th><th className="n">{t("Recibido", "Received")}</th><th className="n">{t("Saldo", "Balance")}</th></tr></thead>
        <tbody>{spo.lines.map((l) => { const g = got(l.position); return <tr key={l.id}><td>{l.code ? <b className="mono">{l.code}</b> : null} {l.description}</td><td className="n mono">{l.qty}</td><td className="n mono">{g}</td><td className={`n mono${g < l.qty ? " risk-t" : ""}`}>{Math.max(0, l.qty - g)}</td></tr>; })}</tbody>
      </table></div>

      {spo.receipts.map((r) => (
        <article key={r.id} className="exc-item" id={`rec-${r.id}`}>
          <header className="exc-head"><b className="mono">{r.code}</b> · {r.location.name} · {i.day(r.receivedAt)} · {r.receivedByName}<span className="grow" />{r.lines.some((l) => l.exceptionKind) ? <span className="sig risk">{t("Con novedades", "With exceptions")}</span> : <span className="sig ok">{t("Sin novedades", "Clean")}</span>}</header>
          {r.lines.map((l) => (
            <p key={l.id} className="small"><b>{l.qtyReceived}</b> × {l.code ?? l.description}{l.exceptionKind && <span className="risk-t"> · {t(EXC_TEXT[l.exceptionKind]?.es ?? l.exceptionKind, EXC_TEXT[l.exceptionKind]?.en ?? l.exceptionKind)}: {l.exceptionNote}</span>}{l.serials && <span className="muted"> · {t("seriales", "serials")} {l.serials}</span>}
              <span className="src block">{l.lots.map((x) => `${x.qty} ${t(LOT_STATES[x.state]?.es ?? x.state, LOT_STATES[x.state]?.en ?? x.state).toLowerCase()}${x.deal ? ` (${x.deal.code ?? x.deal.title})` : ""}`).join(" · ")}</span></p>
          ))}
          {(r.grossKg != null || r.dims || r.packages != null) && <p className="src">{t("Medido por nosotros", "Measured by us")}: {r.packages != null ? `${r.packages} ${t("bultos", "packages")} · ` : ""}{r.grossKg != null ? `${Number(r.grossKg)} kg` : ""}{r.dims ? ` · ${r.dims} cm` : ""}{r.packagingOk === false ? ` · ${t("empaque con daño", "packaging damaged")}` : ""}</p>}
          {r.photos.length > 0 && <div className="vf-grid">{r.photos.map((p) => <figure key={p.id} className="vf-item"><a href={`/compras/foto/${p.id}`} target="_blank" rel="noreferrer"><img src={`/compras/foto/${p.id}`} alt={p.name} loading="lazy" /></a></figure>)}</div>}
          {editable && <ReceiptPhotosAdd receiptId={r.id} lang={lang} room={MAX_RECEIPT_PHOTOS - r.photos.length} />}
          <span className="src block">{t(`${r.photos.length} de ${MAX_RECEIPT_PHOTOS} fotos`, `${r.photos.length} of ${MAX_RECEIPT_PHOTOS} photos`)} · <Link href="/operaciones/inventario">{t("Ver inventario", "See stock")}</Link></span>
        </article>
      ))}

      {editable && pending && (
        <details className="qa" open={spo.receipts.length === 0} style={{ marginTop: 8 }}><summary className="qa-btn">{t("Registrar una recepción", "Record a receipt")}</summary>
          <form action={recordReceipt.bind(null, spo.id)} className="qa-form" style={{ marginTop: 8 }}>
            <div className="qa-row">
              <label>{t("Dónde se recibe", "Where it is received")}<select name="locationId" required defaultValue={locations[0]?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label style={{ flex: "0 0 auto" }}>{t("Fecha", "Date")}<input name="receivedAt" type="date" defaultValue={dayInput(today())} /></label>
            </div>
            {spo.lines.filter((l) => got(l.position) < l.qty).map((l) => (
              <fieldset key={l.id} className="emf-fx">
                <legend className="small"><b>{l.code ?? ""}</b> {l.description} · {t("faltan", "pending")} {l.qty - got(l.position)}</legend>
                <div className="qa-row" style={{ flexWrap: "wrap" }}>
                  <label style={{ flex: "0 0 110px" }}>{t("Llegaron", "Arrived")}<input name={`rq_${l.position}`} type="number" min={0} defaultValue={l.qty - got(l.position)} /></label>
                  <label style={{ flex: "0 0 auto" }}>{t("¿Es la referencia exacta?", "Exact part?")}{okNo(`id_${l.position}`)}</label>
                  <label style={{ flex: "0 0 auto" }}>{t("¿En buen estado?", "Good condition?")}{okNo(`cond_${l.position}`)}</label>
                  <label style={{ flex: "0 0 auto" }}>{t("¿Completo?", "Complete?")}{okNo(`comp_${l.position}`)}</label>
                  <label style={{ flex: "0 0 auto" }}>{t("¿Con documentos?", "Documents?")}{okNo(`docs_${l.position}`)}</label>
                </div>
                <div className="qa-row">
                  <label>{t("Seriales", "Serials")}<input name={`ser_${l.position}`} maxLength={400} /></label>
                  <label>{t("Qué se vio (obligatorio si algo no está bien)", "What was seen (required if something is off)")}<input name={`note_${l.position}`} maxLength={300} /></label>
                </div>
              </fieldset>
            ))}
            <b className="small">{t("Lo que medimos (opcional, alimenta el pasaporte del producto)", "What we measured (optional, feeds the product passport)")}</b>
            <div className="qa-row">
              <label style={{ flex: "0 0 100px" }}>{t("Bultos", "Packages")}<input name="packages" type="number" min={0} /></label>
              <label style={{ flex: "0 0 130px" }}>{t("Peso real kg", "Actual kg")}<input name="grossKg" type="number" min={0} step="0.01" /></label>
              <label>{t("Medidas del bulto (cm)", "Package dimensions (cm)")}<input name="dims" maxLength={160} placeholder="41x31x30" /></label>
              <label style={{ flex: "0 0 150px" }}>{t("¿Empaque sano?", "Packaging intact?")}<select name="packagingOk" defaultValue=""><option value="">—</option><option value="yes">{t("Sí", "Yes")}</option><option value="no">No</option></select></label>
            </div>
            <label className="chk"><input type="checkbox" name="lastDelivery" value="1" /> {t("El proveedor no enviará más (lo que falte es un faltante, no un saldo)", "The supplier will send nothing more (anything missing is a shortage, not a balance)")}</label>
            <label>{t("Notas", "Notes")}<input name="notes" maxLength={500} /></label>
            <button type="submit">{t("Registrar recepción", "Record receipt")}</button>
            <span className="src block">{t("Las fotos se agregan después de registrar. Lo que esté en duda queda en cuarentena: está físicamente, pero no disponible.", "Photos are added after recording. Anything in doubt goes to quarantine: physically here, but not available.")}</span>
          </form>
        </details>
      )}
    </section>
  );
}
