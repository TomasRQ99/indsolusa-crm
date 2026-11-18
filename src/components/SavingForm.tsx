"use client";

import { useState } from "react";
import { Info } from "./Info";

// Record a saving on a supplier order, in the order a person thinks it: what kind it is, what we were going to pay,
// what we ended up paying (SOLU shows the saving while you type), how much of it went to the customer, and the proof.
// Only the fields that apply to the chosen kind are shown (user, 2026-11-18: "esta sección no está clara").

type Kind = { key: string; label: string };

const KIND_HELP: Record<string, [string, string]> = {
  SUPPLIER_SAVINGS: ["El proveedor bajó su precio frente a su primera cotización (descuento, negociación).", "The supplier lowered the price against their first quote (discount, negotiation)."],
  FREIGHT_SAVINGS: ["El envío costó menos de lo previsto (otra transportadora, consolidar, mejor tarifa).", "Shipping cost less than planned (another carrier, consolidation, a better rate)."],
  PAYMENT_SAVINGS: ["Se pagó menos por la forma de pago (descuento por pronto pago, menor costo de giro).", "Less was paid because of how it was paid (early-payment discount, lower wire cost)."],
  LEGITIMATE_DUTY_REDUCTION: ["Se pagó menos arancel de forma legal (acuerdo comercial, clasificación correcta).", "Less duty was paid legally (trade agreement, correct classification)."],
  CLAIM_RECOVERY: ["Dinero recuperado con un reclamo (al proveedor, a la transportadora, al seguro).", "Money recovered through a claim (supplier, carrier, insurance)."],
  ERROR_AVOIDANCE: ["Un error que se detectó a tiempo y no llegó a costar (cantidad, referencia o precio equivocados).", "A mistake caught in time that never cost money (wrong quantity, part or price)."],
};

export function SavingForm({ lang, action, currency, total, firstQuote, firstQuoteRef, kinds }: {
  lang: "ES" | "EN"; action: (fd: FormData) => void | Promise<void>; currency: string; total: number;
  firstQuote: number | null; firstQuoteRef: string | null; kinds: Kind[];
}) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const [kind, setKind] = useState("SUPPLIER_SAVINGS");
  const [base, setBase] = useState("");
  const [fin, setFin] = useState(String(total));
  const [passed, setPassed] = useState("0");
  const supplier = kind === "SUPPLIER_SAVINGS";
  const num = (v: string) => { const n = Number(String(v).replace(",", ".")); return v.trim() !== "" && Number.isFinite(n) ? n : null; };
  const fmt = (n: number) => `${currency} ${n.toLocaleString(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const b = supplier ? firstQuote : num(base);
  const f = num(fin), p = num(passed) ?? 0;
  const saving = b != null && f != null ? Math.round((b - f) * 100) / 100 : null;
  const noFirst = supplier && firstQuote == null;
  const problem = noFirst ? null
    : saving == null ? null
    : saving < 0 ? t("Así no hay ahorro: lo que se pagó al final es más que lo que se iba a pagar.", "There is no saving this way: what was finally paid is more than what was going to be paid.")
    : p < 0 || p > saving ? t("Lo que se le rebajó al cliente no puede ser mayor que el ahorro.", "What was passed to the customer cannot be more than the saving.")
    : null;
  const ok = !noFirst && saving != null && saving > 0 && !problem;

  return (
    <form action={action} className="sv-form">
      <p className="sv-intro">{t("Un ahorro es dinero que dejamos de pagar frente a lo que íbamos a pagar. Es opcional: no hace falta para liberar la orden. Regístralo solo si tienes cómo probarlo.", "A saving is money we did not pay compared with what we were going to pay. It is optional: it is not needed to release the order. Record it only if you can prove it.")}</p>

      <label><span className="fname">1 · {t("¿Qué tipo de ahorro es?", "What kind of saving is it?")}</span>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
      </label>
      <span className="src">{KIND_HELP[kind] ? t(KIND_HELP[kind][0], KIND_HELP[kind][1]) : ""}</span>

      <div className="sv-row">
        {supplier ? (
          <div className="sv-fixed">
            <span className="fname">2 · {t("Lo que íbamos a pagar", "What we were going to pay")} <Info lang={lang} text={t("En un ahorro con el proveedor siempre es su primera cotización. Se escribe una sola vez, arriba, en «ANTES DE COMPRAR».", "For a supplier saving it is always their first quote. It is typed once, above, under “BEFORE BUYING”.")} /></span>
            {firstQuote != null
              ? <b className="mono">{fmt(firstQuote)}<span className="src block">{t("Primera cotización del proveedor", "Supplier's first quote")}{firstQuoteRef ? ` · ${firstQuoteRef}` : ""}</span></b>
              : <span className="req-tag">{t("Falta la primera cotización del proveedor. ", "The supplier's first quote is missing. ")}<a href="#antes">{t("Escríbela en «ANTES DE COMPRAR»", "Type it under “BEFORE BUYING”")} →</a></span>}
          </div>
        ) : (
          <label><span className="fname">2 · {t(`Lo que íbamos a pagar (${currency})`, `What we were going to pay (${currency})`)} <Info lang={lang} text={t("El valor que estaba previsto antes del ahorro: lo cotizado, lo presupuestado o lo que se pagó la vez anterior.", "The amount planned before the saving: what was quoted, budgeted or paid last time.")} example="250" /></span>
            <input name="baselineAmount" type="number" min={0} step="0.01" required value={base} onChange={(e) => setBase(e.target.value)} />
          </label>
        )}
        <label><span className="fname">3 · {t(`Lo que pagamos al final (${currency})`, `What we finally paid (${currency})`)} <Info lang={lang} text={t("El valor definitivo, después del descuento o la mejora. Viene con el total de esta orden; cámbialo si el ahorro es de otra cosa (flete, arancel, giro).", "The final amount, after the discount or improvement. It comes with this order's total; change it if the saving is about something else (freight, duty, wire).")} example="200" /></span>
          <input name="finalAmount" type="number" min={0} step="0.01" required value={fin} onChange={(e) => setFin(e.target.value)} />
        </label>
      </div>
      {!supplier && (
        <label><span className="fname">{t("¿De dónde sale lo que íbamos a pagar?", "Where does what we were going to pay come from?")} <Info lang={lang} text={t("El documento que muestra ese valor previsto.", "The document that shows that planned amount.")} example={t("Cotización de flete de DHL del 10 de noviembre", "DHL freight quote of 10 November")} /></span>
          <input name="baselineSource" maxLength={160} />
        </label>
      )}

      <div className={`sv-calc${problem ? " bad" : ok ? " good" : ""}`} aria-live="polite">
        {problem ?? (saving != null && saving > 0
          ? <>{t("Ahorro", "Saving")}: <b>{fmt(saving)}</b> <span className="src">= {fmt(b!)} − {fmt(f!)}</span></>
          : saving === 0
            ? t("Los dos valores son iguales: todavía no hay ahorro. Si se pagó menos, escribe el valor nuevo en el punto 3.", "Both amounts are the same: there is no saving yet. If less was paid, type the new amount in point 3.")
            : t("Escribe los dos valores y SOLU calcula el ahorro.", "Type both amounts and SOLU works out the saving."))}
      </div>

      <label><span className="fname">4 · {t(`De ese ahorro, ¿cuánto se le rebajó al cliente? (${currency})`, `Of that saving, how much was passed on to the customer? (${currency})`)} <Info lang={lang} text={t("Si parte del ahorro se le dio al cliente como menor precio, escribe cuánto. Lo demás queda para la empresa. Si no se le rebajó nada, deja 0.", "If part of the saving went to the customer as a lower price, type how much. The rest stays with the company. If nothing was passed on, leave 0.")} example="0" /></span>
        <input name="passedToCustomer" type="number" min={0} step="0.01" value={passed} onChange={(e) => setPassed(e.target.value)} style={{ maxWidth: 220 }} />
      </label>
      {ok && <span className="src">{t("Queda para la empresa", "Stays with the company")}: <b>{fmt(Math.round((saving! - p) * 100) / 100)}</b></span>}

      <label><span className="fname">5 · {t("Prueba del ahorro", "Proof of the saving")} <Info lang={lang} text={t("Dónde se puede ver que el ahorro es real: quién lo confirmó, en qué documento y cuándo.", "Where it can be seen that the saving is real: who confirmed it, on which document and when.")} example={t("Correo de Ana (proveedor) del 18 de noviembre con el precio nuevo", "Email from Ana (supplier) of 18 November with the new price")} /></span>
        <input name="evidence" required maxLength={300} />
      </label>
      <button type="submit" disabled={!ok}>{t("Registrar ahorro", "Record saving")}</button>
    </form>
  );
}
