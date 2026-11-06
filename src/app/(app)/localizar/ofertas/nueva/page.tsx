import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { uploadSupplierDoc } from "../actions";

export default async function NewSupplierDoc({ searchParams }: { searchParams: Promise<{ supplier?: string; rfqr?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const [suppliers, recipient, recent] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    sp.rfqr ? db.rfqRecipient.findUnique({ where: { id: sp.rfqr }, select: { id: true, supplier: { select: { id: true, name: true } }, rfq: { select: { id: true, code: true } } } }) : null,
    db.supplierDoc.findMany({ orderBy: { createdAt: "desc" }, take: 15, select: { id: true, kind: true, reference: true, fileName: true, createdAt: true, reviewedAt: true, supplier: { select: { name: true } }, _count: { select: { offers: true } } } }),
  ]);
  const errs: Record<string, string> = {
    proveedor: t("Elige el proveedor.", "Pick the supplier."),
    archivo: t("Adjunta el archivo de la cotización o proforma.", "Attach the quote or proforma file."),
    grande: t("El archivo es demasiado grande (máximo 8 MB).", "The file is too large (max 8 MB)."),
    tipo: t("Usa un PDF (o una foto JPG/PNG).", "Use a PDF (or a JPG/PNG photo)."),
  };
  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/localizar">{t("Localizar repuestos", "Find parts")}</Link></div>
          <h1>{t("Registrar cotización o proforma de proveedor", "Record a supplier quote or proforma")}</h1>
          <p>{t("Sube el PDF que te mandó el proveedor. SOLU lee los números de parte, cantidades, precios, plazo y validez; tú revisas antes de guardar.", "Upload the PDF the supplier sent. SOLU reads part numbers, quantities, prices, lead time and validity; you review before saving.")}</p>
        </div>
      </div>
      {sp.err && errs[sp.err] && <p className="note attn">{errs[sp.err]}</p>}
      {recipient && <p className="note">{t(`Respuesta de ${recipient.supplier.name} a ${recipient.rfq.code}.`, `${recipient.supplier.name}'s answer to ${recipient.rfq.code}.`)}</p>}
      <div className="card">
        <form action={uploadSupplierDoc} className="stack">
          {recipient ? <input type="hidden" name="rfqRecipientId" value={recipient.id} /> : (
            <label>{t("Proveedor", "Supplier")}<select name="supplierId" required defaultValue={sp.supplier ?? ""}><option value="" disabled>{t("— elige —", "— choose —")}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          )}
          <label>{t("Archivo (PDF de la cotización o factura proforma)", "File (PDF of the quote or proforma invoice)")}<input type="file" name="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" required /></label>
          <p className="src">{t("Se guarda como respaldo de la oferta. Si trae datos bancarios, SOLU solo los compara con el perfil verificado: nunca los usa para pagar.", "It's kept as evidence of the offer. If it shows bank details, SOLU only compares them with the verified profile: it never uses them to pay.")}</p>
          <div><button type="submit">{t("Subir y leer", "Upload and read")}</button></div>
        </form>
        {!recipient && <p className="src" style={{ marginTop: 8 }}>{t("¿El proveedor no está? ", "Supplier missing? ")}<Link href="/suppliers">{t("Agrégalo en Proveedores", "Add it in Suppliers")}</Link>.</p>}
      </div>
      {recent.length > 0 && (
        <section className="jblock loc-sec">
          <div className="jbh"><b>{t("ÚLTIMOS DOCUMENTOS DE PROVEEDORES", "LATEST SUPPLIER DOCUMENTS")}</b></div>
          <div className="card flush"><table>
            <thead><tr><th>{t("Documento", "Document")}</th><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Ofertas", "Offers")}</th><th>{t("Subido", "Uploaded")}</th></tr></thead>
            <tbody>{recent.map((d) => (
              <tr key={d.id}>
                <td><Link className="val" href={`/localizar/ofertas/${d.id}`}>{d.kind === "PROFORMA" ? "Proforma" : t("Cotización", "Quote")} {d.reference ?? d.fileName}</Link>{!d.reviewedAt && <span className="loc-chip warn">{t("sin revisar", "not reviewed")}</span>}</td>
                <td>{d.supplier.name}</td>
                <td className="n mono">{d._count.offers}</td>
                <td className="mono">{i.day(d.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
