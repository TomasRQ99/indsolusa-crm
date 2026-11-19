"use client";

import { useMemo, useState } from "react";
import { Info } from "./Info";

// Record an internal purchase (something the company buys for itself). Three things are required: whether it is a
// product or a service, what it is, and how much it cost. The rest is optional. The receipt goes with it.
// Every purchase recorded before is remembered: clicking "What was bought?" opens the list, and choosing one fills
// the form, so nobody types the same expense twice. The order of the fields is the owner's (2026-11-19).

type Opt = { key: string; label: string; hint?: string };
export type PastOpt = { id: string; description: string; kind: string; category: string; supplierName: string; currency: string; amount: number | null; need: string; times: number; lastLabel: string };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const CURRENCIES = ["USD", "COP", "EUR"];

export function InternalExpenseForm({ lang, action, kinds, categories, todayStr, past }: {
  lang: "ES" | "EN"; action: (fd: FormData) => void | Promise<void>; kinds: Opt[]; categories: Opt[]; todayStr: string; past: PastOpt[];
}) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const [kind, setKind] = useState("PRODUCT");
  const [cat, setCat] = useState("");
  const [supplier, setSupplier] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [need, setNeed] = useState("");
  const [already, setAlready] = useState(true);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<PastOpt | null>(null);
  const hint = categories.find((c) => c.key === cat)?.hint;
  const catLabel = (k: string) => categories.find((c) => c.key === k)?.label ?? "";

  // What matches the words typed so far; the ones of the category already chosen come first.
  const shown = useMemo(() => {
    const words = picked && picked.description === desc ? [] : plain(desc).split(/\s+/).filter(Boolean);
    const hits = past.filter((p) => { const hay = plain(`${p.description} ${p.supplierName} ${catLabel(p.category)}`); return words.every((w) => hay.includes(w)); });
    return (cat ? [...hits.filter((p) => p.category === cat), ...hits.filter((p) => p.category !== cat)] : hits).slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, desc, cat, picked]);

  const pick = (p: PastOpt) => {
    setDesc(p.description); setKind(p.kind);
    if (p.category) setCat(p.category);
    if (p.supplierName) setSupplier(p.supplierName);
    if (CURRENCIES.includes(p.currency)) setCurrency(p.currency);
    setAmount(p.amount != null ? String(p.amount) : "");
    setNeed(p.need);
    setPicked(p); setOpen(false);
  };
  const clear = () => { setDesc(""); setKind("PRODUCT"); setCat(""); setSupplier(""); setCurrency("USD"); setAmount(""); setNeed(""); setPicked(null); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!past.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) { setOpen(true); setAt(0); } else setAt((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && shown[at]) { e.preventDefault(); pick(shown[at]); }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
  };

  return (
    <form action={action} className="ie-form">
      <div className="ie-kind wide" role="radiogroup" aria-label={t("Tipo", "Kind")}>
        <span className="fname">1 · {t("¿Es un producto o un servicio?", "Is it a product or a service?")} *</span>
        <div className="ie-pills">
          {kinds.map((k) => (
            <label key={k.key} className={`ie-pill${kind === k.key ? " on" : ""}`}><input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} /> {k.label}<small>{k.hint}</small></label>
          ))}
        </div>
      </div>

      <label><span className="fname">2 · {t("Categoría (opcional)", "Category (optional)")} <Info lang={lang} text={t("Sirve para que el reporte del mes muestre en qué se va el dinero. Si dudas, deja «Otro».", "It lets the month's report show where the money goes. If in doubt, leave “Other”.")} /></span>
        <select name="category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t("Elegir…", "Choose…")}</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        {hint && <span className="src">{hint}</span>}
      </label>
      <label><span className="fname">{t("¿Dónde o a quién se le compró? (opcional)", "Where or from whom? (optional)")}</span>
        <input name="supplierName" maxLength={160} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t("Ej.: Amazon, Panamericana, Juan (técnico)", "E.g.: Amazon, Staples, John (technician)")} />
      </label>

      <div className="ie-what wide">
        <label htmlFor="ie-desc"><span className="fname">3 · {t("¿Qué se compró?", "What was bought?")} * <Info lang={lang} text={t("En pocas palabras, lo que se compró o se necesita comprar para la empresa. Si ya se registró antes, elígelo de la lista y SOLU llena el resto.", "In a few words, what was bought or needs to be bought for the company. If it was recorded before, choose it from the list and SOLU fills in the rest.")} example={t("Mouse inalámbrico para Paola", "Wireless mouse for Paola")} /></span></label>
        <div className="ie-past-w">
          <input id="ie-desc" name="description" required maxLength={200} autoComplete="off" value={desc}
            role="combobox" aria-expanded={open} aria-controls="ie-past" aria-autocomplete="list"
            onChange={(e) => { setDesc(e.target.value); setPicked(null); setAt(0); if (past.length) setOpen(true); }}
            onFocus={() => { if (past.length && !picked) setOpen(true); }} onClick={() => { if (past.length) setOpen(true); }}
            onBlur={() => setOpen(false)} onKeyDown={onKey}
            placeholder={past.length ? t("Escribe o elige una compra anterior", "Type, or choose an earlier purchase") : t("Ej.: 2 resmas de papel y grapas", "E.g.: 2 reams of paper and staples")} />
          {open && past.length > 0 && (
            <div className="ie-past" id="ie-past" role="listbox" aria-label={t("Compras anteriores", "Earlier purchases")}>
              <div className="ie-past-h">{t("COMPRAS ANTERIORES", "EARLIER PURCHASES")} · {t("elige una y se llena el formulario", "choose one and the form fills in")}</div>
              {shown.length === 0 && <div className="ie-past-0">{t("Ninguna compra anterior se parece. Sigue escribiendo: esta quedará guardada para la próxima vez.", "No earlier purchase looks like it. Keep typing: this one will be saved for next time.")}</div>}
              {shown.map((p, n) => (
                <button type="button" key={p.id} role="option" aria-selected={n === at} className={`ie-past-o${n === at ? " on" : ""}`}
                  onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAt(n)} onClick={() => pick(p)}>
                  <b>{p.description}</b>
                  <span>{[kinds.find((k) => k.key === p.kind)?.label, catLabel(p.category), p.supplierName, p.amount != null ? `${p.currency} ${p.amount.toLocaleString(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null, p.times > 1 ? t(`${p.times} veces`, `${p.times} times`) : null, t(`última: ${p.lastLabel}`, `last: ${p.lastLabel}`)].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {picked
          ? <span className="src ie-picked">{t(`Copiado de la compra del ${picked.lastLabel}. Revisa el valor y la fecha, y sube el recibo de esta compra.`, `Copied from the purchase of ${picked.lastLabel}. Check the amount and the date, and upload this purchase's receipt.`)} <button type="button" className="ie-linkb" onClick={clear}>{t("Empezar en blanco", "Start blank")}</button></span>
          : past.length > 0 && <span className="src">{t(`SOLU recuerda ${past.length} compra(s) anterior(es): haz clic en la casilla para verlas.`, `SOLU remembers ${past.length} earlier purchase(s): click the box to see them.`)}</span>}
      </div>

      <label><span className="fname">4 · {t("¿Cuánto costó?", "How much did it cost?")} * <Info lang={lang} text={t("El valor total del recibo, con impuestos. Si fue en pesos, elige COP: SOLU lo pasa a dólares para el reporte con la tasa del día.", "The receipt's total, taxes included. If it was in pesos, choose COP: SOLU converts it to dollars for the report at the day's rate.")} example="85" /></span>
        <input name="amount" type="number" min="0.01" step="0.01" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label><span className="fname">{t("Moneda", "Currency")}</span>
        <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="USD">USD · {t("dólares", "dollars")}</option><option value="COP">COP · {t("pesos colombianos", "Colombian pesos")}</option><option value="EUR">EUR · {t("euros", "euros")}</option></select>
      </label>

      <label className="wide"><span className="fname">5 · {t("¿Para qué es? (opcional)", "What is it for? (optional)")} <Info lang={lang} text={t("Una línea que ayude a quien aprueba a entender la compra.", "One line that helps whoever approves understand the purchase.")} example={t("El mouse anterior dejó de funcionar", "The old mouse stopped working")} /></span>
        <input name="need" maxLength={500} value={need} onChange={(e) => setNeed(e.target.value)} />
      </label>

      <div className="ie-bought wide">
        <label className="chk"><input type="checkbox" name="already" value="1" checked={already} onChange={(e) => setAlready(e.target.checked)} /> <span>6 · {t("Ya se compró", "It was already bought")}</span></label>
        {already
          ? <label>{t("Fecha de la compra", "Purchase date")}<input name="boughtAt" type="date" defaultValue={todayStr} max={todayStr} /></label>
          : <span className="src">{t("Queda como solicitud: cuando se apruebe y se compre, se marca «Ya se compró» y entra al reporte de ese mes.", "It stays as a request: once approved and bought, it is marked “It was bought” and enters that month's report.")}</span>}
      </div>

      <label className="wide"><span className="fname">7 · {t("Recibo o factura (foto o PDF)", "Receipt or invoice (photo or PDF)")} <Info lang={lang} text={t("Una foto del recibo con el celular sirve. Hasta 6 archivos de 5 MB. Si aún no lo tienes, lo agregas después en la compra.", "A phone photo of the receipt is fine. Up to 6 files of 5 MB. If you don't have it yet, add it later on the purchase.")} /></span>
        <input name="files" type="file" multiple accept="image/*,application/pdf" />
      </label>

      <div className="ie-foot wide">
        <span className="src">{t("Al enviar, queda esperando aprobación y guardada en la lista de compras anteriores. Solo las compras aprobadas entran al reporte del mes.", "On sending, it waits for approval and is saved in the list of earlier purchases. Only approved purchases enter the month's report.")}</span>
        <button type="submit">{t("Enviar compra interna", "Send internal purchase")}</button>
      </div>
    </form>
  );
}
