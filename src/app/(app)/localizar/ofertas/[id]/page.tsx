import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import type { DocLine } from "@/lib/supplier-doc";
import { deleteSupplierDoc, saveSupplierDoc } from "../actions";

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export default async function SupplierDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; n?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const doc = await db.supplierDoc.findUnique({
    where: { id },
    select: {
      id: true, kind: true, reference: true, issuedAt: true, validUntil: true, currency: true, incoterm: true, leadText: true, paymentTerms: true,
      fileName: true, size: true, extracted: true, bankWarning: true, reviewedAt: true, createdByName: true, createdAt: true,
      supplier: { select: { id: true, name: true } },
      rfqRecipient: { select: { rfq: { select: { id: true, code: true } } } },
      offers: { orderBy: { createdAt: "asc" }, select: { id: true, partId: true, codeAsQuoted: true, description: true, qty: true, unitPrice: true, leadText: true, part: { select: { mpn: true, name: true } } } },
    },
  });
  if (!doc) notFound();
  const ex = (doc.extracted ?? { readable: false, lines: [] }) as { readable: boolean; lines: DocLine[] };
  // Rows to review: the saved offers once reviewed, otherwise what SOLU read. Plus empty rows to add what it missed.
  const base = doc.reviewedAt && doc.offers.length
    ? doc.offers.map((o) => ({ code: o.codeAsQuoted, description: o.description ?? "", qty: o.qty, unitPrice: Number(o.unitPrice), leadText: o.leadText, partId: o.partId, partMpn: o.part.mpn, confident: true, inc: true }))
    : ex.lines.map((l) => ({ ...l, inc: !!l.partId || l.confident }));
  const rows = [...base, ...Array.from({ length: 3 }, () => ({ code: "", description: "", qty: null, unitPrice: null, leadText: null, partId: null, partMpn: null, confident: false, inc: false }))];
  const expired = doc.validUntil && doc.validUntil < new Date();
  const canDelete = canManageAll(user) || doc.createdByName === user.name;

  return (
    <div className="jw x3">
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/localizar/ofertas/nueva">{t("Documentos de proveedores", "Supplier documents")}</Link></p>
          <span className="jid">{doc.kind === "PROFORMA" ? "Proforma" : t("Cotización", "Quote")}</span>
          <span className="grow" />
          <a className="link small" href={`/localizar/ofertas/archivo/${doc.id}`} target="_blank" rel="noopener">{t("Ver el PDF", "Open the PDF")}</a>
        </div>
        <div className="jh-title"><h1>{doc.supplier.name} · {doc.reference ?? doc.fileName}</h1></div>
        <p className="jh-sub">{t(`subido por ${doc.createdByName} el ${i.day(doc.createdAt)}`, `uploaded by ${doc.createdByName} on ${i.day(doc.createdAt)}`)}{doc.rfqRecipient ? <> · {t("respuesta a", "answer to")} <Link href={`/localizar/rfq/${doc.rfqRecipient.rfq.id}`}>{doc.rfqRecipient.rfq.code}</Link></> : null}</p>
      </header>

      {sp.ok === "guardado" && <p className="note">{t(`Guardado: ${sp.n ?? ""} oferta(s). Ya aparecen en cada parte, con este documento como respaldo.`, `Saved: ${sp.n ?? ""} offer(s). They now show on each part, with this document as evidence.`)}</p>}
      {sp.err === "lineas" && <p className="note attn">{t("Marca al menos una línea con número de parte y precio.", "Tick at least one line with a part number and price.")}</p>}
      {sp.err === "permiso" && <p className="note attn">{t("Solo quien lo subió o gerencia puede borrarlo.", "Only the uploader or management can delete it.")}</p>}
      {doc.bankWarning === "DIFFERENT" && <p className="note attn"><b>{t("Alto: los datos bancarios de este documento NO coinciden con el perfil verificado del proveedor.", "Stop: the bank details on this document do NOT match the supplier's verified profile.")}</b> {t("No pagues con ellos. Un cambio de cuenta solo se acepta tras verificación independiente (llamada al teléfono registrado) en Pagos a proveedores.", "Don't pay with them. An account change is only accepted after independent verification (call to the registered phone) in Supplier payments.")}</p>}
      {doc.bankWarning === "NO_VERIFIED" && <p className="note attn">{t("Este documento trae datos bancarios y el proveedor aún no tiene perfil bancario verificado. SOLU no los guarda ni los usa: la verificación se hace aparte, en Pagos a proveedores.", "This document shows bank details and the supplier has no verified bank profile yet. SOLU doesn't store or use them: verification happens separately, in Supplier payments.")}</p>}
      {!ex.readable && !doc.reviewedAt && <p className="note attn">{t("No pude leer texto en este archivo (¿es una foto o un escaneo?). Escribe las líneas abajo mirando el PDF.", "I couldn't read text in this file (is it a photo or a scan?). Type the lines below while looking at the PDF.")}</p>}
      {expired && <p className="note attn">{t(`La oferta venció el ${i.day(doc.validUntil)}: confirma precio con el proveedor antes de cotizar.`, `The offer expired on ${i.day(doc.validUntil)}: re-confirm the price with the supplier before quoting.`)}</p>}

      <form action={saveSupplierDoc.bind(null, doc.id)}>
        <section className="jblock">
          <div className="jbh"><b>{t("CONDICIONES DEL DOCUMENTO", "DOCUMENT TERMS")}</b><span className="grow" /><span className="src">{doc.reviewedAt ? t(`revisado ${i.day(doc.reviewedAt)}`, `reviewed ${i.day(doc.reviewedAt)}`) : t("leído por SOLU · revisa y corrige", "read by SOLU · review and correct")}</span></div>
          <div className="loc-docgrid">
            <label>{t("Tipo", "Type")}<select name="kind" defaultValue={doc.kind}><option value="QUOTE">{t("Cotización", "Quote")}</option><option value="PROFORMA">{t("Factura proforma", "Proforma invoice")}</option></select></label>
            <label>{t("Número del proveedor", "Supplier's number")}<input name="reference" defaultValue={doc.reference ?? ""} /></label>
            <label>{t("Fecha", "Date")}<input type="date" name="issuedAt" defaultValue={ymd(doc.issuedAt)} /></label>
            <label>{t("Válida hasta", "Valid until")}<input type="date" name="validUntil" defaultValue={ymd(doc.validUntil)} /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue={doc.currency ?? "USD"} /></label>
            <label>Incoterm<input name="incoterm" defaultValue={doc.incoterm ?? ""} placeholder="FCA Miami" /></label>
            <label>{t("Plazo de entrega", "Lead time")}<input name="leadText" defaultValue={doc.leadText ?? ""} placeholder={t("4-6 semanas", "4-6 weeks")} /></label>
            <label>{t("Forma de pago", "Payment terms")}<input name="paymentTerms" defaultValue={doc.paymentTerms ?? ""} /></label>
          </div>
        </section>

        <section className="jblock">
          <div className="jbh"><b>{t("LÍNEAS", "LINES")}</b><span className="grow" /><span className="src">{t("marcadas = se guardan como oferta · ✓ = cantidad × precio cuadra con el total", "ticked = saved as an offer · ✓ = quantity × price matches the total")}</span></div>
          <input type="hidden" name="rows" value={rows.length} />
          <div className="loc-lines">
            <table>
              <thead><tr><th /><th>{t("Número de parte", "Part number")}</th><th>{t("En el catálogo", "In catalog")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Cant.", "Qty")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th>{t("Plazo", "Lead")}</th></tr></thead>
              <tbody>
                {rows.map((r, n) => (
                  <tr key={n}>
                    <td><input type="checkbox" name={`inc_${n}`} value="1" defaultChecked={r.inc} aria-label={t("Guardar esta línea", "Save this line")} /></td>
                    <td><input name={`code_${n}`} defaultValue={r.code} className="mono" size={16} /></td>
                    <td className="small">{r.partId ? <><input type="hidden" name={`part_${n}`} value={r.partId} /><Link href={`/localizar/${r.partId}`} className="mono">{r.partMpn}</Link></> : r.code ? <span className="src">{t("nueva: se agrega al catálogo", "new: added to catalog")}</span> : null}</td>
                    <td><input name={`desc_${n}`} defaultValue={r.description} size={26} /></td>
                    <td className="n"><input name={`qty_${n}`} defaultValue={r.qty ?? ""} inputMode="decimal" size={4} /></td>
                    <td className="n"><input name={`price_${n}`} defaultValue={r.unitPrice ?? ""} inputMode="decimal" size={9} />{r.confident && r.code && !doc.reviewedAt ? <span className="ok-mark" title={t("cantidad × precio = total", "qty × price = total")}> ✓</span> : null}</td>
                    <td><input name={`lead_${n}`} defaultValue={r.leadText ?? ""} size={9} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}><button type="submit">{doc.reviewedAt ? t("Guardar cambios", "Save changes") : t("Confirmar y guardar ofertas", "Confirm and save offers")}</button></div>
        </section>
      </form>

      {canDelete && (
        <form action={deleteSupplierDoc.bind(null, doc.id)} data-confirm={t("¿Borrar este documento y sus ofertas?", "Delete this document and its offers?")} style={{ marginTop: 8 }}>
          <button type="submit" className="link small">{t("Borrar documento", "Delete document")}</button>
        </form>
      )}
    </div>
  );
}
