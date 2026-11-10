"use client";

import { useEffect, useRef, useState } from "react";
import { previewRate } from "@/app/(app)/visitas/mision/actions";

// Amount of a travel expense in the currency it was paid in. USD stays as typed. For COP the person chooses:
// convert with the official TRM of the expense date (shown before saving), or type the USD actually charged.

export function ExpenseMoneyFields({ lang }: { lang: "ES" | "EN" }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const box = useRef<HTMLDivElement>(null);
  const [currency, setCurrency] = useState<"USD" | "COP">("USD");
  const [mode, setMode] = useState<"TRM" | "CHARGED">("TRM");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [rate, setRate] = useState<{ rate: number; validFrom: string } | "loading" | "fail" | null>(null);
  const nf = (v: number, d = 2) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

  // Follow the form's date field: the rate depends on the day of the expense.
  useEffect(() => {
    const el = box.current?.closest("form")?.elements.namedItem("spentOn") as HTMLInputElement | null;
    if (!el) return;
    const read = () => setDay(el.value);
    read();
    el.addEventListener("change", read);
    return () => el.removeEventListener("change", read);
  }, []);

  useEffect(() => {
    if (currency !== "COP" || mode !== "TRM" || !day) return;
    let live = true;
    setRate("loading");
    previewRate(day).then((r) => { if (live) setRate(r.ok ? { rate: r.rate, validFrom: r.validFrom } : "fail"); }).catch(() => { if (live) setRate("fail"); });
    return () => { live = false; };
  }, [currency, mode, day]);

  const n = Number(amount.replace(",", "."));
  const usd = rate && typeof rate === "object" && Number.isFinite(n) && n > 0 ? n / rate.rate : null;

  return (
    <div ref={box} className="emf">
      <div className="qa-row">
        <label style={{ flex: "0 0 150px" }}>{t("Moneda", "Currency")}
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value === "COP" ? "COP" : "USD")}>
            <option value="USD">USD · {t("dólares", "dollars")}</option>
            <option value="COP">COP · {t("pesos colombianos", "Colombian pesos")}</option>
          </select>
        </label>
        <label>{currency === "COP" ? t("Monto pagado en pesos (COP)", "Amount paid in pesos (COP)") : t("Monto en USD", "Amount in USD")}
          <input name="amount" type="number" min={0} step={currency === "COP" ? "1" : "0.01"} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      {currency === "COP" && (
        <fieldset className="emf-fx">
          <legend className="small">{t("¿Cómo lo pasamos a dólares?", "How do we turn it into dollars?")}</legend>
          <label className="chk"><input type="radio" name="fxMode" value="TRM" checked={mode === "TRM"} onChange={() => setMode("TRM")} /> {t("Con la tasa oficial del día del gasto (TRM)", "With the official rate of the expense date (TRM)")}</label>
          <label className="chk"><input type="radio" name="fxMode" value="CHARGED" checked={mode === "CHARGED"} onChange={() => setMode("CHARGED")} /> {t("Yo escribo cuánto me cobraron en USD (extracto de la tarjeta)", "I'll type what I was charged in USD (card statement)")}</label>
          {mode === "TRM" ? (
            <p className="small" role="status">
              {rate === "loading" && t("Consultando la tasa oficial…", "Looking up the official rate…")}
              {rate === "fail" && <span className="risk-t">{t("No se pudo consultar la tasa oficial ahora. Intenta de nuevo o escribe cuánto te cobraron en USD.", "Couldn't get the official rate right now. Try again, or type what you were charged in USD.")}</span>}
              {rate && typeof rate === "object" && <>{t("TRM", "TRM")} <b className="mono">{nf(rate.rate)}</b> COP {t("por USD", "per USD")} <span className="muted">({t("vigente desde", "valid from")} {rate.validFrom})</span>{usd != null && <> → <b className="mono">USD {nf(usd)}</b></>}</>}
            </p>
          ) : (
            <label>{t("Monto cobrado en USD", "Amount charged in USD")}<input name="usdCharged" type="number" min={0} step="0.01" required /></label>
          )}
          <span className="src block">{t("TRM: tasa oficial de Colombia, certificada por la Superintendencia Financiera (datos.gov.co). Se guarda el monto en pesos, la tasa y de dónde salió.", "TRM: Colombia's official rate, certified by the Superintendencia Financiera (datos.gov.co). The peso amount, the rate and its source are saved.")}</span>
        </fieldset>
      )}
    </div>
  );
}
