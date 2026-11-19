import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { createSupplier, updateSupplier } from "../operaciones/actions";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ nuevo?: string; volver?: string; ok?: string; prov?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // Arriving from a Need: the form is open and saving returns to that Need.
  const back = sp.volver && /^\/deals\/[a-z0-9]+$/i.test(sp.volver) ? sp.volver : null;
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
      {sp.ok === "creado" && <p className="small ok-t" role="status">{t(`Proveedor creado: ${suppliers.find((s) => s.id === sp.prov)?.name ?? ""}. Está en la lista de abajo.`, `Supplier created: ${suppliers.find((s) => s.id === sp.prov)?.name ?? ""}. It is in the list below.`)}</p>}
      <details className="card" id="nuevo-proveedor" open={sp.nuevo === "1"}>
        <summary>{t("Nuevo proveedor", "New supplier")}</summary>
        {back && <p className="small">{t("Solo el nombre es obligatorio. Al guardar vuelves a la Necesidad, con este proveedor ya elegido.", "Only the name is required. Saving takes you back to the Need, with this supplier already picked.")} <Link href={`${back}?tab=execute#comprar`}>{t("Volver sin crear", "Go back without creating")}</Link></p>}
        <form action={createSupplier} className="stack" style={{ maxWidth: 640 }}>
          {back && <input type="hidden" name="back" value={back} />}
          <div className="row">
            <label style={{ flex: 1 }}>{t("Nombre", "Name")}<input name="name" required /></label>
            <label>{t("País", "Country")}<input name="country" /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" style={{ width: 70 }} /></label>
            <label>{t("NIT / Tax ID", "Tax ID / NIT")}<input name="taxId" style={{ width: 150 }} /></label>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>{t("Correo", "Email")}<input name="email" type="email" /></label>
            <label style={{ flex: 1 }}>{t("Teléfono registrado (para verificar pagos)", "Registered phone (for payment verification)")}<input name="phone" /></label>
          </div>
          <label>{t("Sitio web (opcional: SOLU busca ahí las páginas de producto, respetando las reglas del sitio)", "Website (optional: SOLU looks for product pages there, following the site's rules)")}<input name="website" placeholder="www.proveedor.com" /></label>
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
                <td><Link href={`/suppliers/${s.id}`}><b>{s.name}</b></Link><span className="src">{s.country ?? ""} · {s.currency}</span></td>
                <td className="small">{s.email ?? "—"}<span className="src">{s.phone ?? ""}</span>{s.website && <span className="src block">{s.website.replace(/^https?:\/\//, "")}</span>}</td>
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
                      <label>{t("NIT / Tax ID", "Tax ID / NIT")}<input name="taxId" defaultValue={s.taxId ?? ""} /></label>
                      <label>{t("Correo", "Email")}<input name="email" defaultValue={s.email ?? ""} /></label>
                      <label>{t("Teléfono registrado", "Registered phone")}<input name="phone" defaultValue={s.phone ?? ""} /></label>
                      <label>{t("Sitio web", "Website")}<input name="website" defaultValue={s.website ?? ""} placeholder="www.proveedor.com" /></label>
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
