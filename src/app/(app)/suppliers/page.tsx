import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { createSupplier, updateSupplier } from "../operaciones/actions";

export default async function SuppliersPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    include: { bankVerifiedBy: { select: { name: true } }, _count: { select: { pos: true } } },
  });

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mercado", "Market")}</div>
          <h1>{t("Proveedores", "Suppliers")}</h1>
          <p>{t("El perfil bancario solo cambia mediante una verificación independiente al preparar un pago. Nunca por un correo.", "The bank profile only changes through an independent verification when preparing a payment. Never by email.")}</p>
        </div>
      </div>
      <details className="card">
        <summary>{t("Nuevo proveedor", "New supplier")}</summary>
        <form action={createSupplier} className="stack" style={{ maxWidth: 640 }}>
          <div className="row">
            <label style={{ flex: 1 }}>{t("Nombre", "Name")}<input name="name" required /></label>
            <label>{t("País", "Country")}<input name="country" /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" style={{ width: 70 }} /></label>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>{t("Correo", "Email")}<input name="email" type="email" /></label>
            <label style={{ flex: 1 }}>{t("Teléfono registrado (para verificar pagos)", "Registered phone (for payment verification)")}<input name="phone" /></label>
          </div>
          <span className="src">{t("Datos bancarios iniciales (quedan sin verificar hasta el primer pago):", "Initial bank data (stays unverified until the first payment):")}</span>
          <div className="row">
            <label style={{ flex: 1 }}>{t("Beneficiario", "Beneficiary")}<input name="bankBeneficiary" /></label>
            <label style={{ flex: 1 }}>{t("Banco", "Bank")}<input name="bankName" /></label>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>{t("Cuenta / IBAN", "Account / IBAN")}<input name="bankAccount" /></label>
            <label>SWIFT<input name="bankSwift" /></label>
          </div>
          <button type="submit">{t("Crear proveedor", "Create supplier")}</button>
        </form>
      </details>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Proveedor", "Supplier")}</th><th>{t("Contacto", "Contact")}</th><th>{t("Perfil bancario", "Bank profile")}</th><th className="n">Supplier PO</th><th /></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} id={s.id}>
                <td><b>{s.name}</b><span className="src">{s.country ?? ""} · {s.currency}</span></td>
                <td className="small">{s.email ?? "—"}<span className="src">{s.phone ?? ""}</span></td>
                <td>
                  {s.bankVerifiedAt ? (
                    <><span className="sig ok">✓ {t("Verificado", "Verified")} {i.day(s.bankVerifiedAt)}</span><span className="src">{s.bankName} · {s.bankAccount ? `…${s.bankAccount.slice(-4)}` : ""} · {s.bankVerifiedBy?.name}</span></>
                  ) : (
                    <span className="sig attn">{t("Sin verificar", "Not verified")}</span>
                  )}
                </td>
                <td className="n val">{s._count.pos}</td>
                <td>
                  <details>
                    <summary className="small">{t("Editar", "Edit")}</summary>
                    <form action={updateSupplier.bind(null, s.id)} className="stack">
                      <label>{t("Nombre", "Name")}<input name="name" defaultValue={s.name} required /></label>
                      <label>{t("País", "Country")}<input name="country" defaultValue={s.country ?? ""} /></label>
                      <label>{t("Moneda", "Currency")}<input name="currency" defaultValue={s.currency} /></label>
                      <label>{t("Correo", "Email")}<input name="email" defaultValue={s.email ?? ""} /></label>
                      <label>{t("Teléfono registrado", "Registered phone")}<input name="phone" defaultValue={s.phone ?? ""} /></label>
                      <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && <tr><td colSpan={5} className="empty"><b>{t("Aún no hay proveedores", "No suppliers yet")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
