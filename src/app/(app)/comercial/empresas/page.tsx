import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { SELLER_LABEL, getSellers, sellerMissing, type SellerKey } from "@/lib/sellers";
import { saveSeller } from "./actions";

// Selling entities (C-02): our own companies that can be the seller on a Journey. Gerencia keeps the details.

export default async function SellersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const edit = isGerencia(user);
  const sellers = await getSellers();
  const counts = await db.deal.groupBy({ by: ["sellerKey"], where: { stage: { notIn: ["WON", "LOST"] } }, _count: { _all: true } });
  const open = (k: string) => counts.find((c) => c.sellerKey === k)?._count._all ?? 0;
  const okMsg: Record<string, string> = { guardada: t("Empresa guardada como nueva versión.", "Company saved as a new version."), igual: t("Sin cambios.", "No changes.") };
  const errMsg: Record<string, string> = {
    permiso: t("Solo Gerencia cambia los datos de las empresas.", "Only Management changes company details."),
    iva: t("El IVA debe estar entre 0 y 40 %.", "IVA must be between 0 and 40 %."),
    incompleta: t("Para activarla faltan datos: razón social, NIT y dirección.", "To activate it, fill in: legal name, tax ID and address."),
    empresa: t("Esa empresa no existe.", "That company doesn't exist."),
  };
  const missTxt: Record<string, string> = { legalName: t("razón social", "legal name"), taxId: t("NIT", "tax ID"), addressLines: t("dirección", "address") };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Empresas que venden", "Selling companies")}</h1>
          <p>{t("Nuestras empresas que pueden vender. Cada Necesidad dice cuál vende; de eso dependen el encabezado de la cotización, el IVA, la moneda y cómo se factura. Aquí no van datos bancarios.", "Our companies that can sell. Each Necessity states which one sells; the quote header, IVA, currency and invoicing depend on it. No bank details go here.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <div className="val-grid">
        {sellers.map((s) => {
          const miss = sellerMissing(s);
          const L = SELLER_LABEL[s.key as SellerKey];
          return (
            <section key={s.key} className="card" id={`e-${s.key}`}>
              <div className="jbh"><b>{t(L.es, L.en)}</b><span className="grow" />{s.active ? <span className="sig ok">{t("Activa", "Active")}</span> : <span className="sig wait">{t("Inactiva", "Inactive")}</span>}</div>
              {miss.length > 0 && <p className="note attn">{t(`Para poder vender con esta empresa falta: ${miss.map((m) => missTxt[m]).join(", ")}.`, `Before this company can sell, fill in: ${miss.map((m) => missTxt[m]).join(", ")}.`)}</p>}
              <p className="src">{t(`${open(s.key)} Necessities abiertos · v${s.version}${s.updatedByName ? ` · ${s.updatedByName} · ${i.day(s.updatedAt)}` : ""}`, `${open(s.key)} open Necessities · v${s.version}${s.updatedByName ? ` · ${s.updatedByName} · ${i.day(s.updatedAt)}` : ""}`)}</p>
              {edit ? (
                <form action={saveSeller.bind(null, s.key)} className="qa-form">
                  <label>{t("Razón social", "Legal name")}<input name="legalName" maxLength={160} defaultValue={s.legalName} /></label>
                  <div className="qa-row">
                    <label style={{ flex: "0 0 110px" }}>{t("Tipo de ID", "ID type")}<input name="taxIdLabel" maxLength={20} defaultValue={s.taxIdLabel ?? ""} placeholder={s.key === "CO" ? "NIT" : "EIN"} /></label>
                    <label>{t("Número", "Number")}<input name="taxId" maxLength={40} defaultValue={s.taxId ?? ""} /></label>
                  </div>
                  <label>{t("Dirección (como sale en los documentos)", "Address (as printed on documents)")}<textarea name="addressLines" rows={2} maxLength={300} defaultValue={s.addressLines ?? ""} /></label>
                  <label>{t("Teléfono", "Phone")}<input name="phone" maxLength={40} defaultValue={s.phone ?? ""} /></label>
                  <label>{t("IVA que se suma a sus cotizaciones (%)", "IVA added to its quotes (%)")}<input name="ivaPct" type="number" min={0} max={40} step="0.01" defaultValue={Number(s.ivaPct)} /></label>
                  <label className="chk"><input type="checkbox" name="allowsCop" value="1" defaultChecked={s.allowsCop} /> {t("Puede cotizar en pesos (COP) además de dólares", "May quote in pesos (COP) as well as dollars")}</label>
                  {s.key !== "USA" && <label className="chk"><input type="checkbox" name="active" value="1" defaultChecked={s.active} /> {t("Activa: se puede elegir en las Necesidades", "Active: can be chosen on Necessities")}</label>}
                  <button type="submit">{t("Guardar", "Save")}</button>
                </form>
              ) : (
                <dl className="qv-dl tight">
                  <dt>{t("Razón social", "Legal name")}</dt><dd>{s.legalName || "—"}</dd>
                  <dt>{s.taxIdLabel ?? "ID"}</dt><dd>{s.taxId ?? "—"}</dd>
                  <dt>{t("Dirección", "Address")}</dt><dd className="pre">{s.addressLines ?? "—"}</dd>
                  <dt>IVA</dt><dd>{i.pct2(Number(s.ivaPct))}</dd>
                </dl>
              )}
              <p className="src">{s.invoiceMode === "EXTERNAL" ? t("Factura: la factura legal se emite por DIAN en el sistema contable y en SOLU se registra su número, fecha y valor.", "Invoice: the legal invoice is issued through DIAN in the accounting system, and its number, date and amount are recorded in SOLU.") : t("Factura: SOLU imprime la factura comercial.", "Invoice: SOLU prints the commercial invoice.")}</p>
            </section>
          );
        })}
      </div>
    </>
  );
}
