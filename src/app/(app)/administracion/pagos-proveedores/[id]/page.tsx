import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { loadSupplierPayments } from "@/lib/queries";
import { paymentStateLabel } from "@/lib/labels";
import { approveSupplierPayment, executeSupplierPayment, verifySupplierPayment } from "../../actions";

export default async function PaymentPrepPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const [p] = await loadSupplierPayments({ id });
  if (!p) notFound();
  const manager = canManageAll(user);
  const s = p.supplierPo.supplier;
  const deal = p.supplierPo.deal;

  // Possible duplicates: same supplier, same amount, not this payment.
  const dupes = await db.supplierPayment.findMany({
    where: { id: { not: p.id }, amount: p.amount, supplierPo: { supplierId: s.id } },
    select: { id: true, createdAt: true, executedAt: true, supplierPo: { select: { code: true } } },
  });

  const fields: { key: "beneficiary" | "bankName" | "account" | "swift"; label: string; profile: string | null; doc: string | null }[] = [
    { key: "beneficiary", label: t("Beneficiario", "Beneficiary"), profile: s.bankBeneficiary, doc: p.docBeneficiary },
    { key: "bankName", label: t("Banco", "Bank"), profile: s.bankName, doc: p.docBankName },
    { key: "account", label: t("Cuenta / IBAN", "Account / IBAN"), profile: s.bankAccount, doc: p.docAccount },
    { key: "swift", label: "SWIFT", profile: s.bankSwift, doc: p.docSwift },
  ];
  const differs = new Set(p.discrepancies.map((d) => d.field));
  const l = paymentStateLabel(i, p.state);
  const canVerify = p.state === "VERIFY" && p.requestedById !== user.id;
  const canApprove = p.state === "APPROVE" && manager && p.requestedById !== user.id && p.verifiedById !== user.id;
  const canExecute = p.state === "EXECUTE" && manager;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/administracion/pagos-proveedores">{t("Pagos a proveedores", "Supplier payments")}</Link> · {p.supplierPo.code}</div>
          <h1>{t("Preparar pago", "Prepare payment")} · {s.name}</h1>
          <p>{p.currency} {i.n2(p.amount)}{p.amountUsd && p.currency !== "USD" ? ` · ≈ USD ${i.n2(p.amountUsd)}` : ""} · {t("pagar antes de", "pay by")} {i.dateShort(p.dueBy)}</p>
        </div>
        <div className="grow" />
        <span className={`sig ${l.cls}`}>{l.text}</span>
      </div>

      {p.state === "VERIFY" && (
        <div className="note risk" style={{ marginBottom: 16 }}>
          <span>
            <b>{t(`Requiere verificación independiente: ${p.discrepancies.length} diferencias materiales.`, `Independent verification required: ${p.discrepancies.length} material differences.`)}</b>{" "}
            {s.bankVerifiedAt
              ? t("Los datos bancarios de la instrucción no coinciden con el perfil verificado. Un cambio de cuenta por correo es la forma más común de fraude; conviene no pagar hasta confirmarlo por teléfono.", "The instruction's bank data doesn't match the verified profile. An account change by email is the most common fraud pattern; best not to pay until confirmed by phone.")
              : t("Este proveedor aún no tiene perfil bancario verificado. Se verifica una vez y queda como referencia.", "This supplier has no verified bank profile yet. Verify once and it becomes the reference.")}
          </span>
        </div>
      )}

      <div className="two">
        <div className="stack-lg">
          <div className="card flush">
            <table>
              <thead><tr><th>{t("Campo", "Field")}</th><th>{t("Perfil verificado", "Verified profile")}</th><th>{t("Instrucción del documento", "Document instruction")}</th><th /></tr></thead>
              <tbody>
                {fields.map((f, k) => (
                  <tr key={f.key}>
                    <td><b>{f.label}</b></td>
                    <td className="mono small">{s.bankVerifiedAt ? (f.profile ?? "—") : <span className="src">{t("sin verificar", "unverified")}{f.profile ? ` · ${f.profile}` : ""}</span>}</td>
                    <td className="mono small">{f.doc ?? "—"}{k === 0 && p.docSource && <span className="src">{t("Fuente", "Source")}: {p.docSource}</span>}</td>
                    <td>{differs.has(f.key) ? <span className="sig risk">{t("Difiere", "Differs")}</span> : <span className="sig ok">✓</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>{t("Trazabilidad", "Traceability")}</h2>
            <ul className="timeline">
              <li>{t("Solicitó", "Requested by")} <b>{p.requestedBy.name}</b> · {i.date(p.createdAt)}</li>
              {p.verifiedAt && <li>{t("Verificó", "Verified by")} <b>{p.verifiedBy?.name}</b> · {i.date(p.verifiedAt)}<span className="src block">{p.verificationNote}</span></li>}
              {p.approvedAt && <li>{t("Aprobó", "Approved by")} <b>{p.approvedBy?.name}</b> · {i.date(p.approvedAt)}</li>}
              {p.executedAt && <li>{t("Ejecutó", "Executed by")} <b>{p.executedBy?.name}</b> · {i.date(p.executedAt)} · <span className="mono">{p.executedRef}</span></li>}
            </ul>
          </div>
          <p className="note ai">{t("SOLU compara los datos y señala diferencias. Nunca actualiza datos bancarios ni aprueba un pago.", "SOLU compares the data and flags differences. It never updates bank data or approves a payment.")}</p>
        </div>

        <aside className="rail">
          <div className="card">
            {canVerify && (
              <>
                <span className="k">{t("Verificación independiente", "Independent verification")}</span>
                <p className="small" style={{ margin: "6px 0 10px" }}>
                  {t("Llama al teléfono registrado del proveedor", "Call the supplier's registered phone")} (<b className="mono">{s.phone ?? t("sin teléfono registrado", "no registered phone")}</b>){t(", nunca al del correo o la factura, y confirma cada dato.", ", never the one in the email or invoice, and confirm each field.")}
                </p>
                <form action={verifySupplierPayment.bind(null, p.id)} className="stack">
                  <label>{t("Con quién hablaste y qué confirmó", "Who you spoke with and what they confirmed")}<textarea name="verificationNote" required /></label>
                  <label className="check"><input type="checkbox" name="updateProfile" defaultChecked /> {t("Actualizar el perfil verificado con estos datos", "Update the verified profile with this data")}</label>
                  <button type="submit" className="wide">{t("Confirmar verificación", "Confirm verification")}</button>
                </form>
              </>
            )}
            {p.state === "VERIFY" && !canVerify && (
              <p className="small">{t("Debe verificarlo una persona distinta de quien solicitó el pago.", "Someone other than the requester must verify it.")}</p>
            )}
            {p.state === "APPROVE" && (
              <>
                <span className="k">{t("Aprobación", "Approval")}</span>
                <p className="small" style={{ margin: "6px 0 10px" }}>{t("Aprueba Gerencia, una persona distinta de quien solicitó y de quien verificó.", "Management approves: someone other than the requester and the verifier.")}</p>
                {canApprove ? (
                  <form action={approveSupplierPayment.bind(null, p.id)}><button type="submit" className="wide">{t("Aprobar pago", "Approve payment")} · {p.currency} {i.n2(p.amount)}</button></form>
                ) : (
                  <button type="button" className="wide" disabled>{t("Enviar a aprobación", "Send for approval")}</button>
                )}
              </>
            )}
            {p.state === "EXECUTE" && (
              <>
                <span className="k">{t("Ejecutar transferencia", "Execute transfer")}</span>
                {canExecute ? (
                  <form action={executeSupplierPayment.bind(null, p.id)} className="stack" style={{ marginTop: 8 }}>
                    <label>{t("Referencia del banco", "Bank reference")}<input name="executedRef" required /></label>
                    <button type="submit" className="wide">{t("Registrar transferencia", "Record transfer")}</button>
                    <span className="src">{t("Se registra una sola vez; si no estás seguro de que el banco la procesó, revisa antes de reintentar.", "Recorded only once; if unsure the bank processed it, check before retrying.")}</span>
                  </form>
                ) : <p className="small">{t("Lo ejecuta Tesorería o Gerencia.", "Treasury or management executes it.")}</p>}
              </>
            )}
            {p.state === "DONE" && <p><span className="sig ok">✓ {t("Pagado", "Paid")}</span> {i.date(p.executedAt)}</p>}
          </div>

          <div className="card">
            <dl className="facts">
              <dt>{t("Por qué se mueve", "Why it moves")}</dt><dd>{p.reason}</dd>
              <dt>Supplier PO</dt><dd className="mono">{p.supplierPo.code} · {p.supplierPo.currency} {i.n2(p.supplierPo.amount)}</dd>
              <dt>Journey</dt><dd><Link href={`/deals/${deal.id}`}>{deal.code}</Link> · {deal.account.name}</dd>
              <dt>{t("Promesa al cliente", "Customer promise")}</dt><dd>{deal.promiseText ?? "—"}{deal.promisedDate ? ` · ${i.dateShort(deal.promisedDate)}` : ""}</dd>
              <dt>{t("Duplicados", "Duplicates")}</dt>
              <dd>{dupes.length === 0 ? t("Ninguno con el mismo monto y proveedor", "None with the same amount and supplier") : dupes.map((d) => <span key={d.id} className="attn-t block small">{d.supplierPo.code} · {i.date(d.createdAt)}{d.executedAt ? t(" · pagado", " · paid") : ""}</span>)}</dd>
              <dt>{t("Autoridad", "Authority")}</dt><dd>{t("Verifica: cualquier persona distinta del solicitante. Aprueba: Gerencia.", "Verify: anyone but the requester. Approve: management.")}</dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}
