"use client";

import { useEffect, useRef, useState } from "react";
import { CURRENCIES } from "@/lib/currencies";

// The TRM chip in the top bar, as a currency converter (owner, 2026-11-25: "if clicked it should give options to
// change the currency both ways, what coin we have and what are we buying"). The chip keeps showing the official
// TRM; a click opens "Tengo → Quiero" with the market rates SOLU already keeps (Yahoo Finance, every 15 minutes).
// It only calculates: nothing is saved.

type Trm = { rate: number; validFrom: string; source: string } | null;
type Rates = { rates: Record<string, number>; source: string; stale: boolean } | "loading" | "fail" | null;

export function FxConverter({ lang, trm }: { lang: "ES" | "EN"; trm: Trm }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const loc = lang === "EN" ? "en-US" : "es-CO";
  const [open, setOpen] = useState(false);
  const [have, setHave] = useState("USD");
  const [want, setWant] = useState("COP");
  const [amount, setAmount] = useState("1");
  const [data, setData] = useState<Rates>(null);
  const loaded = useRef(0);

  useEffect(() => {
    if (!open || Date.now() - loaded.current < 5 * 60e3) return;
    let live = true;
    setData((d) => (d && typeof d === "object" ? d : "loading"));
    fetch("/shell-fx", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (live) { loaded.current = Date.now(); setData(j.rates && Object.keys(j.rates).length > 1 ? j : "fail"); } })
      .catch(() => { if (live) setData((d) => (d && typeof d === "object" ? d : "fail")); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const d = data && typeof data === "object" ? data : null;
  // usdPerUnit of each currency; the official TRM stands in for the peso when the market has no reading.
  const usdPer = (c: string): number | null => (c === "USD" ? 1 : d?.rates[c] ?? (c === "COP" && trm ? 1 / trm.rate : null));
  const a = usdPer(have), b = usdPer(want);
  const n = Number(amount.replace(/\s/g, "").replace(",", "."));
  const rate = a && b ? a / b : null; // 1 "have" = rate "want"
  const out = rate != null && Number.isFinite(n) ? n * rate : null;
  const nf = (v: number) => new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) >= 1 ? 2 : 6 }).format(v);
  const swap = () => { setHave(want); setWant(have); };
  const opts = CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {t(c.es, c.en)}</option>);
  const chip = trm
    ? <><small>TRM</small> ${trm.rate.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
    : <small>{t("MONEDAS", "CURRENCIES")}</small>;

  return (
    <div className="fxc-wrap">
      <button type="button" className={`trm-chip fxc-chip${open ? " on" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={trm ? t(`${trm.source} · vigente desde ${trm.validFrom}. Haz clic para convertir monedas.`, `${trm.source} · valid from ${trm.validFrom}. Click to convert currencies.`) : t("Convertir monedas", "Convert currencies")}>
        {chip} <span className="fxc-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="fxc-pop" role="dialog" aria-label={t("Convertir monedas", "Convert currencies")}>
          <div className="fxc-top"><b>{t("Convertir monedas", "Convert currencies")}</b><button type="button" className="fxc-x" onClick={() => setOpen(false)} aria-label={t("Cerrar", "Close")}>×</button></div>
          <div className="fxc-row">
            <label>{t("Tengo", "I have")}<select value={have} onChange={(e) => setHave(e.target.value)}>{opts}</select></label>
            <button type="button" className="fxc-swap" onClick={swap} title={t("Invertir las monedas", "Swap the currencies")} aria-label={t("Invertir las monedas", "Swap the currencies")}>⇄</button>
            <label>{t("Quiero comprar", "I want to buy")}<select value={want} onChange={(e) => setWant(e.target.value)}>{opts}</select></label>
          </div>
          <label className="fxc-amt">{t(`Cantidad en ${have}`, `Amount in ${have}`)}<input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
          {data === "loading" && !rate && <p className="src">{t("Consultando el mercado…", "Checking the market…")}</p>}
          {rate == null && data !== "loading" && <p className="note risk">{t("No hay una tasa disponible para ese par en este momento.", "No rate is available for that pair right now.")}</p>}
          {rate != null && (
            <>
              <p className="fxc-out">{out != null ? <><span>{nf(n)} {have} =</span> <b>{nf(out)} {want}</b></> : t("Escribe una cantidad.", "Type an amount.")}</p>
              <p className="fxc-rates"><span>1 {have} = {nf(rate)} {want}</span><span>1 {want} = {nf(1 / rate)} {have}</span></p>
            </>
          )}
          <p className="src">{d ? `${d.source}${d.stale ? ` · ${t("lectura vieja: el mercado no respondió hoy", "old reading: the market didn't answer today")}` : ""}. ` : ""}{t("Es la tasa del mercado, de referencia: la del banco el día del pago puede variar.", "It is the market rate, for reference: the bank's rate on payment day can differ.")}{trm ? ` ${t(`TRM oficial de hoy: 1 USD = ${nf(trm.rate)} COP.`, `Today's official TRM: 1 USD = ${nf(trm.rate)} COP.`)}` : ""}</p>
        </div>
      )}
    </div>
  );
}
