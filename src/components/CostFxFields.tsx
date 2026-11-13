"use client";

import { useEffect, useRef, useState } from "react";
import { previewMarketRate } from "@/app/(app)/cotizaciones/actions";
import { BASE_CURRENCY, CURRENCIES, looksInverted, rateGapPct, rateText } from "@/lib/currencies";

// Supplier currency of a quote's cost. Picking a currency brings the market rate (Yahoo Finance) and fills the
// rate and its source; the person can still type the bank's own rate. The supplier's cost stays in its currency
// and the form shows what it is worth in dollars before saving.

type Market = { usdPerUnit: number; unitsPerUsd: number; sourceText: string; stale: boolean };

export function CostFxFields({ lang, currency: c0, rate: r0, source: s0 }: { lang: "ES" | "EN"; currency: string; rate: number | null; source: string | null }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const box = useRef<HTMLDivElement>(null);
  const [currency, setCurrency] = useState(c0);
  const [rate, setRate] = useState(r0 ? rateText(r0) : "");
  const [source, setSource] = useState(s0 ?? "");
  const [market, setMarket] = useState<Market | "loading" | "fail" | null>(null);
  const [cost, setCost] = useState("");
  // The first lookup only compares (the saved rate stays); after the person changes the currency, the market rate fills in.
  const fill = useRef(!r0);
  const loc = lang === "EN" ? "en-US" : "es-CO";
  const nf = (v: number, d = 2) => new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const foreign = currency !== BASE_CURRENCY;
  const options = CURRENCIES.some((c) => c.code === c0) ? CURRENCIES : [...CURRENCIES, { code: c0, es: c0, en: c0, whereEs: "", whereEn: "" }];

  // Follow the supplier-cost field of the same form, to show its value in dollars.
  useEffect(() => {
    const el = box.current?.closest("form")?.elements.namedItem("supplierCost") as HTMLInputElement | null;
    if (!el) return;
    const read = () => setCost(el.value);
    read();
    el.addEventListener("input", read);
    return () => el.removeEventListener("input", read);
  }, []);

  useEffect(() => {
    if (!foreign) { setMarket(null); return; }
    let live = true;
    setMarket("loading");
    previewMarketRate(currency)
      .then((r) => {
        if (!live) return;
        if (!r.ok) { setMarket("fail"); return; }
        setMarket(r);
        if (fill.current) { setRate(rateText(r.usdPerUnit)); setSource(r.sourceText); }
      })
      .catch(() => { if (live) setMarket("fail"); });
    return () => { live = false; };
  }, [currency, foreign]);

  const pick = (code: string) => { fill.current = true; setRate(""); setSource(""); setCurrency(code); };
  const useMarket = () => { if (market && typeof market === "object") { setRate(rateText(market.usdPerUnit)); setSource(market.sourceText); } };

  const m = market && typeof market === "object" ? market : null;
  const r = Number(rate.replace(",", "."));
  const okRate = Number.isFinite(r) && r > 0;
  const gap = m && okRate ? rateGapPct(r, m.usdPerUnit) : 0;
  const same = m != null && okRate && Math.abs(gap) < 0.005;
  const inverted = m != null && okRate && looksInverted(r, m.usdPerUnit);
  const n = Number(cost.replace(",", "."));
  const usd = okRate && Number.isFinite(n) && n > 0 ? n * r : null;

  return (
    <div ref={box} className="cfx">
      <div className="qa-row">
        <label>{t("Moneda en que se le paga al proveedor", "Currency the supplier is paid in")}
          <select name="costCurrency" value={currency} onChange={(e) => pick(e.target.value)}>
            {options.map((c) => <option key={c.code} value={c.code}>{c.code} · {t(c.es, c.en)}{c.whereEs ? ` (${t(c.whereEs, c.whereEn)})` : ""}</option>)}
          </select>
        </label>
        {foreign && (
          <label style={{ flex: "0 1 170px" }}>{t(`1 ${currency} = ¿cuántos USD?`, `1 ${currency} = how many USD?`)}
            <input name="fxRate" type="number" step="any" min="0" inputMode="decimal" value={rate} onChange={(e) => { fill.current = false; setRate(e.target.value); if (m && source === m.sourceText) setSource(""); }} />
          </label>
        )}
      </div>
      {!foreign && <span className="src block">{t("El banco prefiere pagar en la moneda del país donde compramos: si el proveedor es de China, elige CNY; de Europa, EUR.", "The bank prefers paying in the currency of the country we buy from: for a supplier in China pick CNY; in Europe, EUR.")}</span>}
      {foreign && (
        <>
          <p className="small cfx-mkt" role="status">
            {market === "loading" && t("Consultando el mercado…", "Checking the market…")}
            {market === "fail" && <span className="risk-t">{t(`No se pudo consultar la tasa de ${currency} ahora. Escribe la tasa del banco y de dónde salió.`, `Couldn't get the ${currency} rate right now. Type the bank's rate and where it came from.`)}</span>}
            {m && (
              <>
                {t("Mercado", "Market")}: <b className="mono">1 {currency} = {rateText(m.usdPerUnit)} USD</b> <span className="muted">(1 USD = {nf(m.unitsPerUsd, m.unitsPerUsd >= 100 ? 2 : 4)} {currency})</span>
                <span className="src block">{m.sourceText}{m.stale ? ` · ${t("lectura vieja: el mercado no respondió hoy", "old reading: the market didn't answer today")}` : ""}</span>
                {inverted ? <span className="risk-t block">{t(`La tasa parece estar al revés: 1 ${currency} vale ${rateText(m.usdPerUnit)} USD, no ${rate}.`, `The rate looks reversed: 1 ${currency} is worth ${rateText(m.usdPerUnit)} USD, not ${rate}.`)}</span>
                  : okRate && !same ? <span className="block">{t(`Tu tasa está ${nf(Math.abs(gap), 2)} % ${gap > 0 ? "por encima" : "por debajo"} del mercado.`, `Your rate is ${nf(Math.abs(gap), 2)}% ${gap > 0 ? "above" : "below"} the market.`)}</span> : null}
                {!same && <button type="button" className="linkish" onClick={useMarket}>{t("Usar la tasa del mercado", "Use the market rate")}</button>}
              </>
            )}
          </p>
          <label>{t("Fuente de la tasa", "Rate source")}
            <input name="fxSource" maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} placeholder={t("Ej.: banco, 5 nov 10:00", "E.g.: bank, Nov 5 10:00")} />
          </label>
          {usd != null && <p className="small">{t("Proveedor", "Supplier")}: <b className="mono">{currency} {nf(n)}</b> → <b className="mono">USD {nf(usd)}</b></p>}
          <span className="src block">{t(`Escribe el costo del proveedor en ${currency}. Fletes y otros siguen en USD. La tasa del mercado es de referencia: la del banco el día del pago puede variar.`, `Type the supplier's cost in ${currency}. Freight and other stay in USD. The market rate is a reference: the bank's rate on payment day can differ.`)}</span>
        </>
      )}
    </div>
  );
}
