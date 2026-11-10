import Link from "next/link";
import { SELLER_LABEL, getSellers, sellerLocked, type SellerKey } from "@/lib/sellers";
import { setDealSeller } from "@/app/(app)/comercial/empresas/actions";

/** "Who sells on this Journey": the company, what follows from it, and the choice while it can still change. */
export async function SellerLine({ dealId, sellerKey, es, editable, back }: { dealId: string; sellerKey: string; es: boolean; editable: boolean; back: string }) {
  const t = (a: string, b: string) => (es ? a : b);
  const sellers = await getSellers();
  const cur = sellers.find((s) => s.key === sellerKey) ?? sellers[0];
  const choices = sellers.filter((s) => s.active);
  const locked = editable && choices.length > 1 ? await sellerLocked(dealId) : true;
  const L = SELLER_LABEL[cur.key as SellerKey];
  const iva = Number(cur.ivaPct);
  return (
    <div className="seller-line">
      <span className="k">{t("Vende", "Seller")}</span> <b>{cur.legalName || t(L.es, L.en)}</b>
      <span className="muted small"> · {iva > 0 ? t(`IVA ${iva} % aparte`, `IVA ${iva} % on top`) : t("sin IVA", "no IVA")} · {cur.invoiceMode === "EXTERNAL" ? t("factura por DIAN", "invoice through DIAN") : t("factura de SOLU", "SOLU invoice")}</span>
      {editable && choices.length > 1 && (locked ? <span className="src"> · {t("fija: el cliente ya vio una cotización", "fixed: the customer already saw a quote")}</span> : (
        <form action={setDealSeller.bind(null, dealId)} className="seller-pick">
          <input type="hidden" name="back" value={back} />
          <select name="sellerKey" defaultValue={cur.key} aria-label={t("Empresa que vende", "Selling company")}>{choices.map((s) => <option key={s.key} value={s.key}>{s.legalName}</option>)}</select>
          <button type="submit" className="secondary">{t("Cambiar", "Change")}</button>
        </form>
      ))}
      {editable && choices.length < 2 && <span className="src"> · <Link href="/comercial/empresas">{t("la empresa en Colombia aún no está activa", "the Colombian company isn't active yet")}</Link></span>}
    </div>
  );
}
