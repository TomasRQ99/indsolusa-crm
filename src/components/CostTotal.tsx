"use client";

import { useEffect, useRef, useState } from "react";
import { ESAGARA_MAX_PCT, priceForEsagara } from "@/lib/cost-lines";

// Live result of the cost settlement sheet: adds what is typed (before saving) and shows the total cost, the
// Eságara the person wants (a % they type and adjust) and the sale price that comes out of both:
// price = total cost ÷ (1 − Eságara %). With the Eságara box empty, the price is the one the products already
// have and the Eságara is whatever that leaves. When a typed cost is lower than the saved one, the "why" box
// appears right there (the server asks for it anyway). Display only: the server recalculates on save.

const OTHER = ["taxCost", "customsCost", "packingCost", "wireCost", "miscCost"];

type Live = { cost: number; noRate: boolean; drop: boolean; pct: number | null; pctBad: boolean; rows: number | null; costed: boolean };

export function CostTotal({ lang, sale, pct, lines, threshold, fixed, saved, note, askAlways }: {
  /** The price is already committed with the customer: the Eságara is shown as a result, not asked. */
  fixed?: boolean;
  lang: "ES" | "EN";
  /** What the products add up to today. */
  sale: number;
  /** Eságara % those prices leave over the saved costs (null = no price or no cost yet). */
  pct: number | null;
  /** How many products will take the price. */
  lines: number;
  /** Commercial policy: below this % the quote needs an approved exception. */
  threshold?: number | null;
  saved: { supplier: number; freight: number; other: number };
  note: string | null;
  askAlways: boolean;
}) {
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
      const rawPct = String((form.elements.namedItem("esagaraPct") as HTMLInputElement | null)?.value ?? "").trim().replace(",", ".");
      const p = rawPct === "" ? null : Number(rawPct);
      const pctBad = p != null && !(Number.isFinite(p) && p >= 0 && p <= ESAGARA_MAX_PCT);
      // With one row per product on the sheet (ProductRows), the count and "each has its cost" are read live.
      const costs = [...form.querySelectorAll<HTMLInputElement>('.liq-prod input[name="pi_cost"]')];
      const descs = [...form.querySelectorAll<HTMLInputElement>('.liq-prod input[name="pi_desc"]')];
      const ids = [...form.querySelectorAll<HTMLInputElement>('.liq-prod input[name="pi_id"]')];
      const real = costs.map((el, n) => ({ c: Number(String(el.value).replace(",", ".")) || 0, on: !!(ids[n]?.value || descs[n]?.value.trim() || Number(el.value) > 0) })).filter((r) => r.on);
      const rows = form.querySelector(".liq-prod") ? real.length : null;
      const costed = real.length > 0 && real.every((r) => r.c > 0);
      const next: Live = { cost: (sup + fre + oth - c(val("creditAmount"))) / 100, noRate: cur !== "USD" && !rate, drop: lower(sup, supplier) || lower(fre, freight) || lower(oth, other), pct: pctBad ? null : p, pctBad, rows, costed };
      setV((o) => (o && o.cost === next.cost && o.noRate === next.noRate && o.drop === next.drop && o.pct === next.pct && o.pctBad === next.pctBad && o.rows === next.rows && o.costed === next.costed ? o : next));
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    // The rate can be filled by the market lookup without a typing event.
    const iv = window.setInterval(read, 1000);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); window.clearInterval(iv); };
  }, [supplier, freight, other]);

  // The Eságara typed decides the price; with none typed, the price is what the products have today.
  const n = v?.rows ?? lines;
  const how = v?.costed ? t(", cada uno según su costo", ", each one by its cost") : null;
  const fromPct = v ? priceForEsagara(v.cost, v.pct) : null;
  const price = fromPct ?? sale;
  const es = v ? Math.round((price - v.cost) * 100) / 100 : 0;
  const esPct = price > 0 ? (es / price) * 100 : null;
  const moves = fromPct != null && Math.abs(fromPct - sale) > 0.005;
  const low = threshold != null && esPct != null && price > 0 && Math.round(esPct * 100) / 100 < threshold;
  const ask = askAlways || !!note || !!v?.drop;
  return (
    <div ref={box} className="liq-end">
      <div className="liq-total" role="status">
        <div><span>{t("Costo total", "Total cost")}</span><b className="mono">USD {nf(v?.cost ?? 0)}</b></div>
        {!fixed && (
          <div className="liq-es">
            <label htmlFor="liq-esagaraPct">{t("Eságara que quieres ganar", "Eságara you want to earn")}<small>{t("Es tuya: escríbela y ajústala. De ella sale el precio.", "It is yours: type it and adjust it. The price comes from it.")}</small></label>
            <span className="liq-pct">
              <input id="liq-esagaraPct" name="esagaraPct" type="number" min="0" max={ESAGARA_MAX_PCT} step="0.01" inputMode="decimal" defaultValue={pct != null && pct >= 0 && pct <= ESAGARA_MAX_PCT ? pct.toFixed(2) : ""} placeholder={threshold != null ? String(threshold) : "30"} aria-describedby="liq-es-how" />
              <span aria-hidden>%</span>
            </span>
          </div>
        )}
        {v && (
          <>
            {v.pctBad && <span className="risk-t">{t(`La Eságara va entre 0 y ${ESAGARA_MAX_PCT} %.`, `Eságara goes from 0 to ${ESAGARA_MAX_PCT} %.`)}</span>}
            {price > 0 && v.cost > 0 && <div className={es < 0 ? "neg" : undefined}><span>{t("Eságara en dinero", "Eságara in money")}</span><b className="mono">USD {nf(es)}{v.pct == null && esPct != null ? ` · ${nf(esPct)} %` : ""}</b></div>}
            <div className="big">
              <span>{t("Precio de venta", "Sale price")}</span>
              <b className="mono">{price > 0 ? `USD ${nf(price)}` : t("escribe la Eságara o el precio del producto", "type the Eságara or the product's price")}</b>
            </div>
            <span className="src" id="liq-es-how">
              {fromPct != null
                ? <>{t(`Costo total ${nf(v.cost)} ÷ (1 − ${nf(v.pct ?? 0)} %) = ${nf(fromPct)}.`, `Total cost ${nf(v.cost)} ÷ (1 − ${nf(v.pct ?? 0)} %) = ${nf(fromPct)}.`)}{" "}
                    {moves && (n === 0
                      ? t("Todavía no hay productos: agrega uno para que tome este precio.", "There are no products yet: add one so it takes this price.")
                      : sale > 0
                        ? t(`Hoy los productos suman USD ${nf(sale)}: al guardar ${n === 1 ? "el producto pasa" : `los ${n} productos pasan`} a USD ${nf(fromPct)}${n > 1 ? how ?? ", en la misma proporción de sus precios" : ""}.`, `Today the products add up to USD ${nf(sale)}: on save the ${n === 1 ? "product becomes" : `${n} products become`} USD ${nf(fromPct)}${n > 1 ? how ?? ", in the same proportion as their prices" : ""}.`)
                        : t(`Al guardar, SOLU pone este precio en ${n === 1 ? "el producto" : `los ${n} productos${how ?? ", repartido por unidades"}`}.`, `On save, SOLU puts this price on ${n === 1 ? "the product" : `the ${n} products${how ?? ", split by units"}`}.`))}
                  </>
                : v.pct != null && !(v.cost > 0)
                  ? t("Escribe primero los costos: el precio sale del costo total y de la Eságara.", "Type the costs first: the price comes from the total cost and the Eságara.")
                  : fixed
                    ? t("El precio ya se le presentó al cliente: aquí no cambia. Para cambiarlo, crea una revisión de la cotización.", "The price was already presented to the customer: it does not change here. To change it, create a revision of the quote.")
                  : price > 0
                    ? t("Este precio es el que tienen hoy los productos. Escribe la Eságara que quieres y SOLU calcula el precio.", "This is the price the products have today. Type the Eságara you want and SOLU calculates the price.")
                    : t("Precio = costo total ÷ (1 − Eságara).", "Price = total cost ÷ (1 − Eságara).")}
            </span>
            {low && <span className="src">{t(`Por debajo de la referencia de ${threshold} %. Se puede presentar así: es tu decisión.`, `Below the ${threshold} % reference. It can be presented like this: it is your decision.`)}</span>}
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
