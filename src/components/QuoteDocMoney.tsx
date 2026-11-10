import { quoteDocView, sellerMissing } from "@/lib/sellers";
import { trmFor } from "@/lib/fx";
import { today } from "@/lib/domain";
import { saveDocMoney } from "@/app/(app)/cotizaciones/actions";

// Quote: the currency the customer sees, the exchange rate fixed for this document, and IVA (C-20, C-21).
// Shown only when it matters: the seller adds IVA or may quote in pesos. Eságara stays in USD before IVA.

type Q = { id: string; status: string; currency: string; docFxRate: unknown; docFxSource: string | null; ivaExempt: boolean; ivaExemptReason: string | null; ivaPct: unknown; sellerSnap: unknown; lines: { qty: number; unitPrice: unknown }[] };

export async function QuoteDocMoney({ q, sellerKey, es, editable }: { q: Q; sellerKey: string; es: boolean; editable: boolean }) {
  const t = (a: string, b: string) => (es ? a : b);
  const v = await quoteDocView(q, sellerKey);
  const draft = q.status === "DRAFT";
  const sellerIva = Number(v.seller.ivaPct);
  const relevant = draft ? sellerIva > 0 || v.seller.allowsCop : v.money.currency === "COP" || v.money.ivaPct > 0 || q.ivaExempt;
  if (!relevant) return null;
  const loc = es ? "es-CO" : "en-US";
  const fmt = (n: number, c = v.money.currency) => `${c} ${new Intl.NumberFormat(loc, c === "COP" ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
  const trm = draft && editable && v.seller.allowsCop ? await trmFor(today().toISOString().slice(0, 10)) : null;
  const miss = sellerMissing(v.seller);
  const manual = !!q.docFxSource && !q.docFxSource.startsWith("TRM");

  return (
    <section className="jblock" id="moneda">
      <div className="jbh"><b>{t("MONEDA E IVA DEL DOCUMENTO", "DOCUMENT CURRENCY AND IVA")}</b><span className="grow" /><span className="src">{t("Lo que ve el cliente. La Eságara se mide en USD, antes de IVA.", "What the customer sees. Eságara is measured in USD, before IVA.")}</span></div>
      {draft && miss.length > 0 && <p className="note attn">{t("Faltan datos de la empresa que vende; Gerencia los completa en Comercial → Configuración → Empresas que venden.", "The selling company's details are incomplete; Management completes them in Commercial → Setup → Selling companies.")}</p>}
      <dl className="qv-dl tight">
        <dt>Subtotal</dt><dd className="mono">{fmt(v.money.subtotal)}{v.money.currency === "COP" && <span className="muted"> · USD {new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v.money.usdSubtotal)}</span>}</dd>
        <dt>IVA</dt><dd className="mono">{q.ivaExempt ? <>{t("Exento", "Exempt")}<span className="muted"> · {q.ivaExemptReason}</span></> : v.money.ivaPct > 0 ? <>{fmt(v.money.iva)} <span className="muted">({v.money.ivaPct} %)</span></> : t("No aplica", "Not applicable")}</dd>
        <dt>{t("Total al cliente", "Total to customer")}</dt><dd className="mono"><b>{fmt(v.money.total)}</b></dd>
        {v.money.currency === "COP" && <><dt>{t("Tasa del documento", "Document rate")}</dt><dd className="mono">{new Intl.NumberFormat(loc, { minimumFractionDigits: 2 }).format(v.money.fxRate ?? 0)} COP/USD<span className="src block">{q.docFxSource}</span></dd></>}
      </dl>
      {q.currency === "COP" && !v.money.fxRate && <p className="note attn">{t("Esta cotización está en pesos pero aún no tiene tasa: guárdala abajo.", "This quote is in pesos but has no rate yet: save it below.")}</p>}
      {draft && editable && (
        <form action={saveDocMoney.bind(null, q.id)} className="qa-form" style={{ maxWidth: 640, marginTop: 8 }}>
          {v.seller.allowsCop ? (
            <>
              <label style={{ maxWidth: 260 }}>{t("Moneda del documento", "Document currency")}
                <select name="currency" defaultValue={q.currency}><option value="USD">USD · {t("dólares", "dollars")}</option><option value="COP">COP · {t("pesos colombianos", "Colombian pesos")}</option></select>
              </label>
              <fieldset className="emf-fx">
                <legend className="small">{t("Si es en pesos, ¿con qué tasa?", "If in pesos, at which rate?")}</legend>
                <label className="chk"><input type="radio" name="rateMode" value="TRM" defaultChecked={!manual} /> {t("TRM oficial de hoy", "Today's official TRM")}{trm ? <b className="mono"> · {new Intl.NumberFormat(loc, { minimumFractionDigits: 2 }).format(trm.rate)}</b> : <span className="risk-t"> · {t("no disponible ahora", "not available right now")}</span>}</label>
                <label className="chk"><input type="radio" name="rateMode" value="MANUAL" defaultChecked={manual} /> {t("Otra tasa (la escribo y digo por qué)", "Another rate (I type it and say why)")}</label>
                <div className="qa-row">
                  <label style={{ flex: "0 0 170px" }}>{t("Tasa COP por USD", "Rate COP per USD")}<input name="manualRate" type="number" min={500} max={20000} step="0.01" defaultValue={manual && q.docFxRate ? Number(q.docFxRate) : ""} /></label>
                  <label>{t("Por qué esta tasa", "Why this rate")}<input name="rateReason" maxLength={200} placeholder={t("Ej.: tasa pactada con el cliente", "E.g.: rate agreed with the customer")} /></label>
                </div>
                <span className="src block">{t("La tasa queda fija para este documento; al presentar ya no cambia. Los precios se escriben en USD y el documento los muestra en pesos, redondeados al peso.", "The rate is fixed for this document; once presented it no longer changes. Prices are typed in USD and the document shows them in pesos, rounded to the peso.")}</span>
              </fieldset>
            </>
          ) : <input type="hidden" name="currency" value="USD" />}
          {sellerIva > 0 && (
            <div className="qa-row">
              <label className="chk" style={{ flex: "0 0 auto" }}><input type="checkbox" name="ivaExempt" value="1" defaultChecked={q.ivaExempt} /> {t(`Esta venta está exenta de IVA (si no, se suma ${sellerIva} %)`, `This sale is IVA exempt (otherwise ${sellerIva} % is added)`)}</label>
              <label>{t("Motivo de la exención", "Reason for the exemption")}<input name="ivaExemptReason" maxLength={200} defaultValue={q.ivaExemptReason ?? ""} /></label>
            </div>
          )}
          <button type="submit" className="secondary">{t("Guardar moneda e IVA", "Save currency and IVA")}</button>
        </form>
      )}
    </section>
  );
}
