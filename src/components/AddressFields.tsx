"use client";

import { useState } from "react";
import { COUNTRIES, type Place } from "@/lib/customer-fields";

// A customer has two addresses, asked apart: billing and shipping. When the goods go to the billing address,
// the person ticks "same as billing" instead of typing it twice. Used by Nueva Necesidad and by the customer's page.

type Lang = "ES" | "EN";

/** The five boxes of one address. Names are `${prefix}Country`, `${prefix}Region`, `${prefix}City`, `${prefix}PostalCode`, `${prefix}Address`. */
export function PlaceBoxes({ lang, prefix, value, need = false }: { lang: Lang; prefix: string; value?: Place | null; need?: boolean }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const star = need ? " *" : "";
  return (
    <>
      <label>{t("Dirección (calle y número)", "Address (street and number)")}{star}
        <input name={`${prefix}Address`} required={need} maxLength={300} defaultValue={value?.address ?? ""} placeholder={t("Ej.: Calle 100 # 8A-55, oficina 301", "E.g.: 8300 NW 53rd St, Suite 350")} autoComplete="off" />
      </label>
      <div className="adr-row">
        <label>{t("Ciudad", "City")}{star}<input name={`${prefix}City`} required={need} maxLength={120} defaultValue={value?.city ?? ""} autoComplete="off" /></label>
        <label>{t("Estado / Provincia / Departamento", "State / Province / Department")}{star}<input name={`${prefix}Region`} required={need} maxLength={120} defaultValue={value?.region ?? ""} autoComplete="off" /></label>
      </div>
      <div className="adr-row">
        <label>{t("Código postal", "Postal code")}<input name={`${prefix}PostalCode`} maxLength={12} defaultValue={value?.postalCode ?? ""} autoComplete="off" /></label>
        <label>{t("País", "Country")}{star}
          <select name={`${prefix}Country`} required={need} defaultValue={value?.country ?? ""}>
            <option value="">{t("Elegir…", "Choose…")}</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{lang === "EN" ? c.en : c.es}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}

/** The shipping address with its "same as billing" box. Sends `shipSame` and, when unticked, the `ship…` boxes. */
export function ShippingBlock({ lang, shipping, same = true, need = false }: { lang: Lang; shipping?: Place | null; same?: boolean; need?: boolean }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const [eq, setEq] = useState(same);
  return (
    <>
      <b className="adr-h">{t("Dirección de envío", "Shipping address")}</b>
      <label className="adr-same"><input type="checkbox" name="shipSame" value="1" checked={eq} onChange={(e) => setEq(e.target.checked)} /> <span>{t("Igual a la de facturación", "Same as billing")}</span></label>
      {eq
        ? <span className="src">{t("La mercancía se envía a la dirección de facturación. Si va a otro lugar, quita la marca y escribe la dirección de envío.", "The goods are shipped to the billing address. If they go elsewhere, untick the box and type the shipping address.")}</span>
        : <PlaceBoxes lang={lang} prefix="ship" value={shipping} need={need} />}
    </>
  );
}

/** Billing address, then shipping address with its "same as billing" box. */
export function AddressFields({ lang, billing, shipping, same = true, need = false }: { lang: Lang; billing?: Place | null; shipping?: Place | null; same?: boolean; need?: boolean }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  return (
    <div className="adr">
      <b className="adr-h">{t("Dirección de facturación", "Billing address")}</b>
      <PlaceBoxes lang={lang} prefix="bill" value={billing} need={need} />
      <ShippingBlock lang={lang} shipping={shipping} same={same} need={need} />
    </div>
  );
}
