"use client";

import { useEffect, useRef, useState } from "react";

// Live result of the cost settlement form: adds what is typed (before saving) and shows the total cost
// and the Eságara it leaves against the quote's sale. Display only: the server recalculates on save.

const ADD = ["freightCost", "taxCost", "customsCost", "packingCost", "wireCost", "miscCost"];

export function CostTotal({ lang, sale }: { lang: "ES" | "EN"; sale: number }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const box = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<{ cost: number; credit: number; noRate: boolean } | null>(null);
  const nf = (n: number) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const val = (name: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      const n = el ? Number(String(el.value).replace(",", ".")) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const read = () => {
      const cur = (form.elements.namedItem("costCurrency") as HTMLSelectElement | null)?.value ?? "USD";
      const rate = cur === "USD" ? 1 : val("fxRate");
      const credit = val("creditAmount");
      const cents = Math.round(val("supplierCost") * (rate || 1) * 100) + ADD.reduce((a, k) => a + Math.round(val(k) * 100), 0) - Math.round(credit * 100);
      setV({ cost: cents / 100, credit, noRate: cur !== "USD" && !rate });
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    // The rate can be filled by the market lookup without a typing event.
    const iv = window.setInterval(read, 1000);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); window.clearInterval(iv); };
  }, []);

  const es = v ? Math.round((sale - v.cost) * 100) / 100 : 0;
  return (
    <div ref={box} className="liq-total" role="status">
      {v && (
        <>
          <div><span>{t("Costo total", "Total cost")}</span><b className="mono">USD {nf(v.cost)}</b></div>
          <div><span>{t("Venta", "Sale")}</span><b className="mono">USD {nf(sale)}</b></div>
          <div className={sale > 0 && es < 0 ? "neg" : undefined}><span>Eságara</span><b className="mono">{sale > 0 ? `USD ${nf(es)} · ${nf((es / sale) * 100)} %` : t("falta el precio de los productos", "product prices are missing")}</b></div>
          {v.noRate && <span className="risk-t">{t("Falta la tasa de la moneda del proveedor.", "The supplier currency rate is missing.")}</span>}
        </>
      )}
    </div>
  );
}
