"use client";

import { useEffect, useRef, useState } from "react";
import { ESAGARA_MAX_PCT, priceForEsagara } from "@/lib/cost-lines";
import { improvePieceText } from "@/app/(app)/deals/piece-ai";

// The products of the cost settlement sheet, one row each (owner, 2026-11-27): how many products the quote has is
// always in sight, another one is added right here, and each keeps what the supplier charges for it. The rows are
// saved with the sheet's own button. The sheet's "Productos" total (the read-only box named supplierCost in the same
// form) is the sum of the rows: this component writes it, so the currency helper and the live total follow it.
// Display only: the server reads the rows again and recalculates everything on save.

export type ProductRowIn = {
  id: string;
  qty: number;
  code: string | null;
  description: string;
  /** What the supplier charges per unit, in the supplier's currency. Null = not typed yet. */
  unitCost: number | null;
  /** Sale price per unit the product has today, in USD. */
  unitPrice: number;
  /** Already delivered in part: it can't be removed and its quantity stays. */
  locked?: boolean;
};

type Row = { key: string; id: string; qty: string; code: string; desc: string; cost: string; price: number; locked: boolean };

const OTHER = ["freightCost", "taxCost", "customsCost", "packingCost", "wireCost", "miscCost"];
const numOf = (s: string) => { const n = Number(String(s).trim().replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };

export function ProductRows({ lang, items, seeded, fixed, what }: {
  lang: "ES" | "EN";
  items: ProductRowIn[];
  /** The unit costs shown were spread by SOLU from an older total: the person should check them. */
  seeded?: boolean;
  /** The products are already with the customer: costs can still be corrected, products are not added or removed. */
  fixed?: boolean;
  /** Where the sheet is: the words of the title follow it. */
  what: "need" | "quote";
}) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const blank = (): Row => ({ key: `n${seq.current++}`, id: "", qty: "1", code: "", desc: "", cost: "", price: 0, locked: false });
  const [rows, setRows] = useState<Row[]>(() => (items.length ? items.map((it) => ({ key: it.id || `s${seq.current++}`, id: it.id, qty: String(it.qty), code: it.code ?? "", desc: it.description, cost: it.unitCost == null ? "" : String(it.unitCost), price: it.unitPrice, locked: !!it.locked })) : [blank()]));
  const [removed, setRemoved] = useState(0);
  // "Mejorar con IA": the row being rewritten, and what the AI answered when it could not.
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [env, setEnv] = useState<{ cur: string; target: number | null }>({ cur: "USD", target: null });
  const nf = (n: number) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const lineCost = (r: Row) => Math.round(numOf(r.qty) * numOf(r.cost) * 100) / 100;
  const total = Math.round(rows.reduce((a, r) => a + lineCost(r) * 100, 0)) / 100;
  const real = rows.filter((r) => r.id || r.desc.trim() || r.code.trim() || numOf(r.cost) > 0);
  const count = real.length;
  const noCost = real.filter((r) => !(numOf(r.cost) > 0)).length;
  const allCosted = count > 0 && noCost === 0;

  // The sheet's "Productos" box is the sum of the rows.
  useEffect(() => {
    const el = box.current?.closest("form")?.elements.namedItem("supplierCost") as HTMLInputElement | null;
    if (!el) return;
    const v = total.toFixed(2);
    if (el.value !== v) el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, [total]);

  // The supplier's currency, and the sale price the typed Eságara gives over all the costs of the sheet.
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const val = (name: string) => numOf((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "");
    const read = () => {
      const cur = (form.elements.namedItem("costCurrency") as HTMLSelectElement | null)?.value ?? "USD";
      const rate = cur === "USD" ? 1 : val("fxRate");
      const cost = Math.round((val("supplierCost") * (rate || 1) + OTHER.reduce((a, k) => a + val(k), 0) - val("creditAmount")) * 100) / 100;
      const rawPct = String((form.elements.namedItem("esagaraPct") as HTMLInputElement | null)?.value ?? "").trim().replace(",", ".");
      const p = rawPct === "" ? null : Number(rawPct);
      const target = p != null && Number.isFinite(p) && p >= 0 && p <= ESAGARA_MAX_PCT ? priceForEsagara(cost, p) : null;
      setEnv((o) => (o.cur === cur && o.target === target ? o : { cur, target }));
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    const iv = window.setInterval(read, 1000);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); window.clearInterval(iv); };
  }, []);

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    setRows((rs) => [...rs, blank()]);
    // The new row is at the end: put the cursor on its description.
    window.setTimeout(() => { const all = box.current?.querySelectorAll<HTMLInputElement>('input[name="pi_desc"]'); all?.[all.length - 1]?.focus(); }, 0);
  };
  const remove = (r: Row) => {
    if (r.id) setRemoved((n) => n + 1);
    setRows((rs) => { const next = rs.filter((x) => x.key !== r.key); return next.length ? next : [blank()]; });
  };

  const improve = async (r: Row) => {
    if (aiBusy) return;
    setAiMsg(null);
    if (r.desc.trim().length < 3) { setAiMsg(t("Escribe primero la descripción de la pieza: la IA la ordena, no la inventa.", "Type the piece's description first: the AI tidies it, it does not invent it.")); return; }
    setAiBusy(r.key);
    try {
      const out = await improvePieceText(r.code, r.desc);
      if (out.ok) set(r.key, { desc: out.text });
      else setAiMsg(out.reason === "OFF" ? t("La IA no está conectada: la descripción queda como la escribiste.", "The AI is not connected: the description stays as you typed it.")
        : out.reason === "CAP" ? t("Se llegó al tope mensual de IA: la descripción queda como la escribiste.", "The monthly AI cap was reached: the description stays as you typed it.")
        : out.reason === "EMPTY" ? t("Escribe primero la descripción de la pieza.", "Type the piece's description first.")
        : t("La IA no respondió. Intenta otra vez; la descripción queda como la escribiste.", "The AI did not answer. Try again; the description stays as you typed it."));
    } catch { setAiMsg(t("La IA no respondió. Intenta otra vez; la descripción queda como la escribiste.", "The AI did not answer. Try again; the description stays as you typed it.")); }
    setAiBusy(null);
  };

  // Price per unit of a row: from its own cost when every product has one and the Eságara gives a price;
  // otherwise the price it has today.
  const priceOf = (r: Row): { v: number; calc: boolean } => {
    if (!fixed && allCosted && env.target != null && total > 0) return { v: Math.round(((numOf(r.cost) * env.target) / total) * 100) / 100, calc: true };
    return { v: r.price, calc: false };
  };
  const anyCalc = !fixed && allCosted && env.target != null && total > 0;
  const title = t("Precio por pieza", "Price per piece");
  const has = count === 0
    ? t("Todavía no hay piezas.", "There are no pieces yet.")
    : what === "quote"
      ? t(`Esta cotización tiene ${count} ${count === 1 ? "pieza" : "piezas"}.`, `This quote has ${count} ${count === 1 ? "piece" : "pieces"}.`)
      : t(`Esta Necesidad tiene ${count} ${count === 1 ? "pieza" : "piezas"}.`, `This Need has ${count} ${count === 1 ? "piece" : "pieces"}.`);

  return (
    <div ref={box} className="liq-prod" id="productos-costo">
      <input type="hidden" name="pi_rows" value="1" />
      <div className="liq-prod-h">
        <b><span className="liq-count">{count}</span>{title}</b>
        <span className="src"><b>{has}</b> {t("Una fila por pieza: cantidad, número de pieza, descripción y el precio que cobra el proveedor por unidad. La descripción llega de Localizar o la escribes aquí, y «Mejorar con IA» la ordena. SOLU guarda el precio de cada pieza y calcula su precio de venta: así sale cada una en el PDF de la cotización.", "One row per piece: quantity, part number, description and the price the supplier charges per unit. The description comes from Locate or you type it here, and “Improve with AI” tidies it. SOLU keeps the price of each piece and calculates its sale price: that is how each one comes out on the quote's PDF.")}</span>
      </div>
      <div className="liq-prow head" aria-hidden>
        <span>#</span><span>{t("Cant.", "Qty")}</span><span>{t("Número de pieza", "Part number")}</span><span>{t("Descripción", "Description")}</span>
        <span className="r">{t("Precio proveedor unit.", "Supplier unit price")} {env.cur}</span><span className="r">{t("Total proveedor", "Supplier total")} {env.cur}</span><span className="r">{t("Precio venta unit. USD", "Unit sale price USD")}</span><span />
      </div>
      {rows.map((r, n) => {
        const p = priceOf(r);
        const isReal = !!(r.id || r.desc.trim() || r.code.trim() || numOf(r.cost) > 0);
        return (
          <div className="liq-prow" key={r.key}>
            <input type="hidden" name="pi_id" value={r.id} />
            <span className="liq-n">{n + 1}</span>
            <input name="pi_qty" type="number" min="1" step="1" inputMode="numeric" value={r.qty} readOnly={r.locked} onChange={(e) => set(r.key, { qty: e.target.value })} aria-label={t(`Cantidad del producto ${n + 1}`, `Quantity of product ${n + 1}`)} />
            <input name="pi_code" maxLength={60} value={r.code} onChange={(e) => set(r.key, { code: e.target.value })} placeholder={t("Número de pieza", "Part number")} aria-label={t(`Número de pieza ${n + 1}`, `Part number ${n + 1}`)} />
            <span className="liq-desc">
              <input name="pi_desc" maxLength={300} value={r.desc} onChange={(e) => set(r.key, { desc: e.target.value })} placeholder={t("Descripción de la pieza", "Piece description")} aria-label={t(`Descripción de la pieza ${n + 1}`, `Description of piece ${n + 1}`)} />
              <button type="button" className="link small" onClick={() => improve(r)} disabled={aiBusy != null} title={t("La IA ordena la descripción que escribiste. No cambia números de parte ni agrega datos.", "The AI tidies the description you typed. It changes no part number and adds no data.")}>{aiBusy === r.key ? t("Mejorando…", "Improving…") : t("Mejorar con IA", "Improve with AI")}</button>
            </span>
            <input name="pi_cost" className={`r${isReal && count > 1 && !(numOf(r.cost) > 0) ? " miss" : ""}`} type="number" min="0" step="0.01" inputMode="decimal" value={r.cost} onChange={(e) => set(r.key, { cost: e.target.value })} placeholder="0" aria-label={t(`Costo por unidad del producto ${n + 1}`, `Cost per unit of product ${n + 1}`)} />
            <span className="r mono liq-lt" data-l={t("Total proveedor", "Supplier total")}>{lineCost(r) > 0 ? nf(lineCost(r)) : "—"}</span>
            <span className={`r mono liq-lt${p.calc ? " calc" : ""}`} data-l={t("Precio venta unit.", "Unit sale price")}>{p.v > 0 ? nf(p.v) : "—"}</span>
            {!fixed && !r.locked ? <button type="button" className="link small" onClick={() => remove(r)} aria-label={t(`Quitar el producto ${n + 1}`, `Remove product ${n + 1}`)}>{t("Quitar", "Remove")}</button> : <span />}
          </div>
        );
      })}
      <div className="liq-prod-f">
        {!fixed
          ? <button type="button" className="btn secondary sm" onClick={add}>{t("+ Agregar pieza", "+ Add a piece")}</button>
          : <span className="src">{t("El precio ya está con el cliente: aquí no se agregan ni se quitan productos. Para cambiarlos, crea una revisión de la cotización.", "The price is already with the customer: products are not added or removed here. To change them, create a revision of the quote.")}</span>}
        <span className="grow" />
        <span className="liq-sum">{t("Piezas", "Pieces")}: <b className="mono">{env.cur} {nf(total)}</b></span>
      </div>
      {aiMsg && <span className="attn-t small" role="status">{aiMsg}</span>}
      {seeded && <span className="attn-t small" role="status">{t("Antes solo había un total para todos los productos: SOLU lo repartió entre ellos. Revisa el costo de cada uno y corrígelo.", "There used to be only one total for all the products: SOLU spread it over them. Check the cost of each one and correct it.")}</span>}
      {removed > 0 && <span className="attn-t small" role="status">{t(`${removed === 1 ? "Quitaste 1 producto: se quita" : `Quitaste ${removed} productos: se quitan`} al guardar.`, `You removed ${removed} ${removed === 1 ? "product: it is" : "products: they are"} removed on save.`)}</span>}
      {!fixed && count > 1 && noCost > 0 && <span className="attn-t small" role="status">{t(`Falta el costo de ${noCost} ${noCost === 1 ? "producto" : "productos"}: escríbelo para que cada uno tenga su precio según lo que cuesta.`, `The cost of ${noCost} ${noCost === 1 ? "product is" : "products is"} missing: type it so each one gets its price from what it costs.`)}</span>}
      {anyCalc && count > 1 && <span className="src">{t("Cada producto gana la misma Eságara sobre su costo. El envío, los impuestos y los demás costos se reparten según lo que cuesta cada producto.", "Each product earns the same Eságara over its cost. Shipping, taxes and the other costs are spread by what each product costs.")}</span>}
    </div>
  );
}
