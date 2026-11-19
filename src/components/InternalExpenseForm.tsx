"use client";

import { useState } from "react";
import { Info } from "./Info";

// Record an internal purchase (something the company buys for itself). Three things are required: what it is,
// whether it is a product or a service, and how much it cost. The rest is optional. The receipt goes with it.

type Opt = { key: string; label: string; hint?: string };

export function InternalExpenseForm({ lang, action, kinds, categories, todayStr }: {
  lang: "ES" | "EN"; action: (fd: FormData) => void | Promise<void>; kinds: Opt[]; categories: Opt[]; todayStr: string;
}) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const [kind, setKind] = useState("PRODUCT");
  const [cat, setCat] = useState("");
  const [already, setAlready] = useState(true);
  const hint = categories.find((c) => c.key === cat)?.hint;

  return (
    <form action={action} className="ie-form">
      <label className="wide"><span className="fname">1 · {t("¿Qué se compró?", "What was bought?")} * <Info lang={lang} text={t("En pocas palabras, lo que se compró o se necesita comprar para la empresa.", "In a few words, what was bought or needs to be bought for the company.")} example={t("Mouse inalámbrico para Paola", "Wireless mouse for Paola")} /></span>
        <input name="description" required maxLength={200} placeholder={t("Ej.: 2 resmas de papel y grapas", "E.g.: 2 reams of paper and staples")} />
      </label>

      <div className="ie-kind wide" role="radiogroup" aria-label={t("Tipo", "Kind")}>
        <span className="fname">2 · {t("¿Es un producto o un servicio?", "Is it a product or a service?")} *</span>
        <div className="ie-pills">
          {kinds.map((k) => (
            <label key={k.key} className={`ie-pill${kind === k.key ? " on" : ""}`}><input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} /> {k.label}<small>{k.hint}</small></label>
          ))}
        </div>
      </div>

      <label><span className="fname">3 · {t("¿Cuánto costó?", "How much did it cost?")} * <Info lang={lang} text={t("El valor total del recibo, con impuestos. Si fue en pesos, elige COP: SOLU lo pasa a dólares para el reporte con la tasa del día.", "The receipt's total, taxes included. If it was in pesos, choose COP: SOLU converts it to dollars for the report at the day's rate.")} example="85" /></span>
        <input name="amount" type="number" min="0.01" step="0.01" required inputMode="decimal" />
      </label>
      <label><span className="fname">{t("Moneda", "Currency")}</span>
        <select name="currency" defaultValue="USD"><option value="USD">USD · {t("dólares", "dollars")}</option><option value="COP">COP · {t("pesos colombianos", "Colombian pesos")}</option><option value="EUR">EUR · {t("euros", "euros")}</option></select>
      </label>

      <label><span className="fname">{t("Categoría (opcional)", "Category (optional)")} <Info lang={lang} text={t("Sirve para que el reporte del mes muestre en qué se va el dinero. Si dudas, deja «Otro».", "It lets the month's report show where the money goes. If in doubt, leave “Other”.")} /></span>
        <select name="category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t("Elegir…", "Choose…")}</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        {hint && <span className="src">{hint}</span>}
      </label>
      <label><span className="fname">{t("¿Dónde o a quién se le compró? (opcional)", "Where or from whom? (optional)")}</span>
        <input name="supplierName" maxLength={160} placeholder={t("Ej.: Amazon, Panamericana, Juan (técnico)", "E.g.: Amazon, Staples, John (technician)")} />
      </label>

      <label className="wide"><span className="fname">{t("¿Para qué es? (opcional)", "What is it for? (optional)")} <Info lang={lang} text={t("Una línea que ayude a quien aprueba a entender la compra.", "One line that helps whoever approves understand the purchase.")} example={t("El mouse anterior dejó de funcionar", "The old mouse stopped working")} /></span>
        <input name="need" maxLength={500} />
      </label>

      <div className="ie-bought wide">
        <label className="chk"><input type="checkbox" name="already" value="1" checked={already} onChange={(e) => setAlready(e.target.checked)} /> <span>{t("Ya se compró", "It was already bought")}</span></label>
        {already
          ? <label>{t("Fecha de la compra", "Purchase date")}<input name="boughtAt" type="date" defaultValue={todayStr} max={todayStr} /></label>
          : <span className="src">{t("Queda como solicitud: cuando se apruebe y se compre, se marca «Ya se compró» y entra al reporte de ese mes.", "It stays as a request: once approved and bought, it is marked “It was bought” and enters that month's report.")}</span>}
      </div>

      <label className="wide"><span className="fname">{t("Recibo o factura (foto o PDF)", "Receipt or invoice (photo or PDF)")} <Info lang={lang} text={t("Una foto del recibo con el celular sirve. Hasta 6 archivos de 5 MB. Si aún no lo tienes, lo agregas después en la compra.", "A phone photo of the receipt is fine. Up to 6 files of 5 MB. If you don't have it yet, add it later on the purchase.")} /></span>
        <input name="files" type="file" multiple accept="image/*,application/pdf" />
      </label>

      <div className="ie-foot wide">
        <span className="src">{t("Al enviar, queda esperando aprobación. Solo las compras aprobadas entran al reporte del mes.", "On sending, it waits for approval. Only approved purchases enter the month's report.")}</span>
        <button type="submit">{t("Enviar compra interna", "Send internal purchase")}</button>
      </div>
    </form>
  );
}
