"use client";

import { useEffect, useRef, useState } from "react";

// Live result of the cost settlement sheet: adds what is typed (before saving) and shows the total cost
// and the Eságara it leaves against the quote's sale. When a typed cost is lower than the saved one, the
// "why" box appears right there (the server asks for it anyway). Display only: the server recalculates on save.

const OTHER = ["taxCost", "customsCost", "packingCost", "wireCost", "miscCost"];

type Live = { cost: number; noRate: boolean; drop: boolean };

export function CostTotal({ lang, sale, saved, note, askAlways }: { lang: "ES" | "EN"; sale: number; saved: { supplier: number; freight: number; other: number }; note: string | null; askAlways: boolean }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const box = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<Live | null>(null);
  const nf = (n: number) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const { supplier, freight, other } = saved;

  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const val = (name: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      const n = el ? Number(String(el.value).replace(",", ".")) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const c = (n: number) => Math.round(n * 100);
    const read = () => {
      const cur = (form.elements.namedItem("costCurrency") as HTMLSelectElement | null)?.value ?? "USD";
      const rate = cur === "USD" ? 1 : val("fxRate");
      const sup = c(val("supplierCost") * (rate || 1));
      const fre = c(val("freightCost"));
      const oth = OTHER.reduce((a, k) => a + c(val(k)), 0);
      const lower = (now: number, before: number) => before > 0 && now < c(before);
      const next: Live = { cost: (sup + fre + oth - c(val("creditAmount"))) / 100, noRate: cur !== "USD" && !rate, drop: lower(sup, supplier) || lower(fre, freight) || lower(oth, other) };
      setV((p) => (p && p.cost === next.cost && p.noRate === next.noRate && p.drop === next.drop ? p : next));
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    // The rate can be filled by the market lookup without a typing event.
    const iv = window.setInterval(read, 1000);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); window.clearInterval(iv); };
  }, [supplier, freight, other]);

  const es = v ? Math.round((sale - v.cost) * 100) / 100 : 0;
  const ask = askAlways || !!note || !!v?.drop;
  return (
    <div ref={box} className="liq-end">
      <div className="liq-total" role="status">
        {v && (
          <>
            <div><span>{t("Costo total", "Total cost")}</span><b className="mono">USD {nf(v.cost)}</b></div>
            <div><span>{t("Venta (precio de los productos)", "Sale (price of the products)")}</span><b className="mono">USD {nf(sale)}</b></div>
            <div className={`big${sale > 0 && es < 0 ? " neg" : ""}`}><span>Eságara</span><b className="mono">{sale > 0 ? `USD ${nf(es)} · ${nf((es / sale) * 100)} %` : t("falta el precio de los productos", "product prices are missing")}</b></div>
            {v.noRate && <span className="risk-t">{t("Falta la tasa de la moneda del proveedor.", "The supplier currency rate is missing.")}</span>}
          </>
        )}
      </div>
      {ask && (
        <label className={`liq-why${v?.drop ? " on" : ""}`}>
          {v?.drop ? t("¿Por qué bajó el costo? Un costo quedó más bajo que el guardado: SOLU lo pide para guardar.", "Why did the cost go down? A cost is lower than the saved one: SOLU asks for it to save.") : t("¿Por qué cambiaron los costos? (queda con esta versión)", "Why did the costs change? (stays with this version)")}
          <input name="changeNote" maxLength={300} defaultValue={note ?? ""} placeholder={t("Ej.: nueva proforma del proveedor", "E.g.: new supplier proforma")} />
        </label>
      )}
    </div>
  );
}
