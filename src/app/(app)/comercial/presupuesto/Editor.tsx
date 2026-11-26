"use client";

import { useMemo, useState } from "react";
import { KPIS, MONTHS, usdCell, usdMoney, deriveMonth, growthOf, marginOf, moneyText, parseMoney, parsePct, suggest, sum, type Assumptions } from "@/lib/sales-budget-rules";

// Presupuesto comercial · P03 Propuesta + P04 Simulador (spec §5). One form: the assumptions on top (changing them
// recalculates SOLU's suggestion and what the goal requires, never the history), the twelve months below.
// Money is typed in whole dollars. Nothing is saved until "Guardar borrador" or "Enviar a aprobación".

export type Rate = { value: number | null; n: [number, number]; scope: "EMPRESA" | "CARTERA" | "NONE" };
export type EditorBasis = {
  baseYear: number; ocClose: number | null; factClose: number | null; monthsUsed: number;
  seasonOc: number[] | null; seasonFact: number[] | null; backlog: number;
  ticket: Rate; convSC: Rate; bateoN: Rate; bateoV: Rate; margin: Rate;
};
export type EditorSaved = { oc: number[]; fact: number[]; ocN: (number | null)[]; ent: (number | null)[]; a: Assumptions; potential: string | null; strategy: string | null; justification: string | null };

type Props = {
  es: boolean; year: number; editable: boolean; prospects: boolean; basis: EditorBasis; start: Assumptions; saved: EditorSaved | null;
  save: (fd: FormData) => void | Promise<void>; send: (fd: FormData) => void | Promise<void>;
  /** The field the server sent the person back to (justificacion, valor, supuesto…). */
  bad: string | null;
};

export default function Editor({ es, year, editable, prospects, basis, start, saved, save, send, bad }: Props) {
  const t = (a: string, b: string) => (es ? a : b);
  const locale = es ? "es-CO" : "en-US";
  const one = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const show = (v: number | null) => (v == null ? "—" : usdCell(v, es));
  const cash = (v: number) => usdMoney(v, es);
  const pctText = (v: number | null) => (v == null ? "" : es ? String(v).replace(".", ",") : String(v));

  const init = saved?.a ?? start;
  const [growth, setGrowth] = useState(pctText(init.growthPct));
  const [factGrowth, setFactGrowth] = useState(pctText(init.factGrowthPct));
  const [ticket, setTicket] = useState(moneyText(init.ticket, es));
  const [convSC, setConvSC] = useState(pctText(init.convSC));
  const [bateoN, setBateoN] = useState(pctText(init.bateoN));
  const [bateoV, setBateoV] = useState(pctText(init.bateoV));
  const [margin, setMargin] = useState(pctText(init.marginPct));
  const [season, setSeason] = useState<Assumptions["season"]>(init.season);

  const a: Assumptions = {
    growthPct: parsePct(growth) ?? 0, factGrowthPct: parsePct(factGrowth) ?? 0,
    ticket: (() => { const v = parseMoney(ticket, es); return v != null && !Number.isNaN(v) && v > 0 ? v : null; })(),
    convSC: parsePct(convSC), bateoN: parsePct(bateoN), bateoV: parsePct(bateoV), marginPct: parsePct(margin), season, manual: [],
  };
  const sugOc = suggest(basis.ocClose, a.growthPct, basis.seasonOc, season);
  const sugFact = suggest(basis.factClose, a.factGrowthPct, basis.seasonFact, season);

  // A company opened for the first time starts with SOLU's suggestion already in the months (accepting it is one click on "Guardar").
  const [oc, setOc] = useState<string[]>(() => (saved ? saved.oc : sugOc ?? Array(12).fill(null)).map((v) => (v == null || (!saved && v === 0) ? "" : moneyText(v, es))));
  const [fact, setFact] = useState<string[]>(() => (saved ? saved.fact : sugFact ?? Array(12).fill(null)).map((v) => (v == null || (!saved && v === 0) ? "" : moneyText(v, es))));
  const [ocN, setOcN] = useState<string[]>(() => (saved?.ocN ?? Array(12).fill(null)).map((v) => (v == null ? "" : String(v))));
  const [ent, setEnt] = useState<string[]>(() => (saved?.ent ?? Array(12).fill(null)).map((v) => (v == null ? "" : String(v))));

  const num = (s: string) => { const v = parseMoney(s, es); return v == null || Number.isNaN(v) ? 0 : v; };
  const ocV = oc.map(num), factV = fact.map(num);
  const der = ocV.map((v, m) => deriveMonth(v, a, ocN[m].trim() ? Number(ocN[m]) : null));
  const total = (xs: (number | null)[]) => (xs.some((x) => x == null) ? null : sum(xs));
  const annualOc = sum(ocV), annualFact = sum(factV), annualEsa = total(der.map((d) => d.esa));
  const setAt = (set: (f: (p: string[]) => string[]) => void, m: number, v: string) => set((p) => p.map((x, k) => (k === m ? v : x)));
  const apply = () => {
    if (sugOc) setOc(sugOc.map((v) => moneyText(v, es)));
    if (sugFact) setFact(sugFact.map((v) => moneyText(v, es)));
    setOcN(Array(12).fill(""));
  };

  const scopeTxt = (r: Rate, unit: "pct" | "m") => r.value == null
    ? t(`Sin base suficiente (${r.n[1]} casos): escríbelo tú.`, `Not enough basis (${r.n[1]} cases): type it yourself.`)
    : `${t("SOLU midió", "SOLU measured")} ${unit === "m" ? cash(r.value) : `${one.format(r.value)} %`} · ${unit === "m" ? t(`${r.n[1]} órdenes`, `${r.n[1]} orders`) : t(`${r.n[0]} de ${r.n[1]}`, `${r.n[0]} of ${r.n[1]}`)} · ${r.scope === "EMPRESA" ? t("esta empresa", "this company") : t("toda tu cartera (la empresa sola no alcanza)", "your whole portfolio (the company alone is not enough)")}`;
  const nobase = <span className="pc-nobase">{t("sin base suficiente", "not enough basis")}</span>;
  const cell = (v: number | null, money: boolean) => (v == null ? nobase : money ? show(v) : String(v));
  const M = MONTHS.map((m) => (es ? m.es : m.en));
  const ro = !editable;

  return (
    <form action={save} className="pc-form">
      <h3 id="supuestos">{t("Supuestos (simulador)", "Assumptions (simulator)")}</h3>
      <p className="src">{prospects
        ? t("Esta línea no tiene historial: SOLU no sugiere cifras. Los porcentajes vienen de toda tu cartera y sirven para calcular qué exige la meta.", "This line has no history: SOLU suggests no figures. The percentages come from your whole portfolio and serve to work out what the goal takes.")
        : t("Cambia un supuesto y mira cómo cambian la sugerencia de SOLU y lo que la meta exige. El historial no se toca. Son supuestos para planear, no garantías.", "Change an assumption and see how SOLU's suggestion and what the goal takes change. The history is not touched. They are planning assumptions, not guarantees.")}</p>
      <div className={`pc-assume${bad === "supuesto" ? " pc-bad" : ""}`}>
        {!prospects && <label>{t(`Crecimiento de OC sobre el cierre ${basis.baseYear} (%)`, `PO growth over the ${basis.baseYear} close (%)`)}<input name="growthPct" inputMode="decimal" value={growth} onChange={(e) => setGrowth(e.target.value)} readOnly={ro} />
          <span className="src">{basis.ocClose != null ? t(`Cierre ${basis.baseYear} proyectado: ${cash(basis.ocClose)} (${basis.monthsUsed} meses con historial)`, `Projected ${basis.baseYear} close: ${cash(basis.ocClose)} (${basis.monthsUsed} months with history)`) : t(`Sin base suficiente para proyectar ${basis.baseYear}: escribe las metas mes a mes.`, `Not enough basis to project ${basis.baseYear}: type the goals month by month.`)}</span></label>}
        {!prospects && <label>{t(`Crecimiento de facturación sobre el cierre ${basis.baseYear} (%)`, `Invoicing growth over the ${basis.baseYear} close (%)`)}<input name="factGrowthPct" inputMode="decimal" value={factGrowth} onChange={(e) => setFactGrowth(e.target.value)} readOnly={ro} />
          <span className="src">{basis.factClose != null ? t(`Cierre ${basis.baseYear} proyectado: ${cash(basis.factClose)}`, `Projected ${basis.baseYear} close: ${cash(basis.factClose)}`) : t("Sin base suficiente para proyectarla.", "Not enough basis to project it.")}{basis.backlog > 0 ? t(` · OC aceptadas sin facturar hoy: ${cash(basis.backlog)}`, ` · Accepted POs not invoiced today: ${cash(basis.backlog)}`) : ""}</span></label>}
        {!prospects && <label>{t("Estacionalidad", "Seasonality")}
          <select name="season" value={season} onChange={(e) => setSeason(e.target.value === "PAREJA" ? "PAREJA" : "PROPIA")} disabled={ro}>
            <option value="PROPIA">{t("La de la empresa (sus meses)", "The company's own (its months)")}</option>
            <option value="PAREJA">{t("Pareja (12 meses iguales)", "Even (12 equal months)")}</option>
          </select>
          {ro && <input type="hidden" name="season" value={season} />}
          <span className="src">{basis.seasonOc ? t("SOLU tiene 12 meses o más de historial de esta empresa.", "SOLU has 12 months or more of this company's history.") : t("Sin estacionalidad propia todavía (menos de 12 meses de historial): SOLU reparte parejo.", "No seasonality of its own yet (under 12 months of history): SOLU spreads evenly.")}</span></label>}
        <label>{t("Ticket promedio de una OC (US$)", "Average value of a PO (US$)")}<input name="ticket" inputMode="decimal" value={ticket} onChange={(e) => setTicket(e.target.value)} readOnly={ro} /><span className="src">{scopeTxt(basis.ticket, "m")}</span></label>
        <label>{t("Solicitud → Cotización (%)", "Request → Quote (%)")}<input name="convSC" inputMode="decimal" value={convSC} onChange={(e) => setConvSC(e.target.value)} readOnly={ro} /><span className="src">{scopeTxt(basis.convSC, "pct")}</span></label>
        <label>{t("Bateo Cotización → OC por cantidad (%)", "Batting Quote → PO by number (%)")}<input name="bateoN" inputMode="decimal" value={bateoN} onChange={(e) => setBateoN(e.target.value)} readOnly={ro} /><span className="src">{scopeTxt(basis.bateoN, "pct")}</span></label>
        <label>{t("Bateo Cotización → OC por valor (%)", "Batting Quote → PO by value (%)")}<input name="bateoV" inputMode="decimal" value={bateoV} onChange={(e) => setBateoV(e.target.value)} readOnly={ro} /><span className="src">{scopeTxt(basis.bateoV, "pct")}</span></label>
        <label>{t("Eságara objetivo (%)", "Eságara objective (%)")}<input name="marginPct" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} readOnly={ro} /><span className="src">{scopeTxt(basis.margin, "pct")}</span></label>
      </div>
      {editable && !prospects && (sugOc || sugFact) && <div className="pc-actions"><button type="button" className="secondary" onClick={apply}>{t("Aplicar la sugerencia de SOLU a los 12 meses", "Apply SOLU's suggestion to the 12 months")}</button><span className="src">{t("Reemplaza lo escrito en los meses por la sugerencia calculada con estos supuestos.", "Replaces what is typed in the months with the suggestion worked out from these assumptions.")}</span></div>}

      <h3 id="propuesta">{t(`Propuesta ${year} · enero a diciembre`, `Proposal ${year} · January to December`)}</h3>
      <p className="src">{t("Cifras en dólares (US$), sin IVA. Vacío = 0. El total anual siempre es la suma de los doce meses.", "Figures in dollars (US$), before VAT. Empty = 0. The annual total is always the sum of the twelve months.")}</p>
      <div className="pc-scroll">
        <table className={`pc-table pc-matrix${bad === "valor" || bad === "vacio" || bad === "numero" ? " pc-bad" : ""}`}>
          <thead><tr><th>{t("Indicador", "Indicator")}</th>{M.map((m) => <th key={m}>{m}</th>)}<th className="pc-year">{t(`Anual ${year}`, `Annual ${year}`)}</th></tr></thead>
          <tbody>
            <tr className="pc-g"><td colSpan={14}>{t("Órdenes de compra (base comercial)", "Purchase orders (commercial base)")}</td></tr>
            {!prospects && <tr className="pc-sug" data-k="SUG_OC"><th scope="row">{t("Sugerencia de SOLU", "SOLU's suggestion")}</th>{sugOc ? sugOc.map((v, m) => <td key={m}>{show(v)}</td>) : <td colSpan={12} className="l">{nobase}</td>}<td className="pc-year">{sugOc ? show(sum(sugOc)) : "—"}</td></tr>}
            <tr data-k="OC_COP"><th scope="row">{t("Meta OC (US$)", "PO goal (US$)")}</th>{oc.map((v, m) => <td key={m}><input className="pc-in" name={`oc_${m + 1}`} inputMode="decimal" value={v} onChange={(e) => setAt(setOc, m, e.target.value)} readOnly={ro} aria-label={`${t("Meta OC", "PO goal")} · ${M[m]}`} /></td>)}<td className="pc-year" data-total="OC_COP">{show(annualOc)}</td></tr>
            <tr data-k="OC_N"><th scope="row">{t("# OC objetivo", "# POs objective")}<span className="src block">{t("Sale del ticket; escribe otro número si la frecuencia real es distinta.", "From the ticket; type another number if the real frequency differs.")}</span></th>{ocN.map((v, m) => <td key={m}><input className="pc-in n" name={`ocn_${m + 1}`} inputMode="numeric" value={v} placeholder={der[m].ocN == null ? "?" : String(deriveMonth(ocV[m], a).ocN ?? "?")} onChange={(e) => setAt(setOcN, m, e.target.value.replace(/[^\d]/g, ""))} readOnly={ro} aria-label={`${t("# OC objetivo", "# POs objective")} · ${M[m]}`} /></td>)}<td className="pc-year">{cell(total(der.map((d) => d.ocN)), false)}</td></tr>
            <tr data-k="ESA_COP"><th scope="row">{t("Eságara objetivo (US$)", "Eságara objective (US$)")}</th>{der.map((d, m) => <td key={m}>{cell(d.esa, true)}</td>)}<td className="pc-year">{cell(annualEsa, true)}</td></tr>
            <tr className="pc-g"><td colSpan={14}>{t("Lo que la meta exige (indicadores de apoyo)", "What the goal takes (supporting indicators)")}</td></tr>
            <tr data-k="COT_COP"><th scope="row">{t("Cotizaciones requeridas (US$)", "Quotes required (US$)")}</th>{der.map((d, m) => <td key={m}>{cell(d.cotUsd, true)}</td>)}<td className="pc-year">{cell(total(der.map((d) => d.cotUsd)), true)}</td></tr>
            <tr data-k="COT_N"><th scope="row">{t("# Cotizaciones requeridas", "# Quotes required")}</th>{der.map((d, m) => <td key={m}>{cell(d.cotN, false)}</td>)}<td className="pc-year">{cell(total(der.map((d) => d.cotN)), false)}</td></tr>
            <tr data-k="SOL_N"><th scope="row">{t("# Solicitudes requeridas", "# Requests required")}<span className="src block">{t("Señal de cuánta demanda generar; no una obligación del cliente.", "A signal of how much demand to create; not an obligation of the customer.")}</span></th>{der.map((d, m) => <td key={m}>{cell(d.solN, false)}</td>)}<td className="pc-year">{cell(total(der.map((d) => d.solN)), false)}</td></tr>
            <tr className="pc-g"><td colSpan={14}>{t("Facturación (base financiera · plan aparte)", "Invoicing (financial base · a separate plan)")}</td></tr>
            {!prospects && <tr className="pc-sug" data-k="SUG_FACT"><th scope="row">{t("Sugerencia de SOLU", "SOLU's suggestion")}</th>{sugFact ? sugFact.map((v, m) => <td key={m}>{show(v)}</td>) : <td colSpan={12} className="l">{nobase}</td>}<td className="pc-year">{sugFact ? show(sum(sugFact)) : "—"}</td></tr>}
            <tr data-k="ENT_N"><th scope="row">{t("# Entregas objetivo", "# Deliveries objective")}<span className="src block">{t("Opcional: cuántas entregas al cliente esperas confirmar cada mes.", "Optional: how many deliveries to the customer you expect to confirm each month.")}</span></th>{ent.map((v, m) => <td key={m}><input className="pc-in n" name={`ent_${m + 1}`} inputMode="numeric" value={v} onChange={(e) => setAt(setEnt, m, e.target.value.replace(/[^\d]/g, ""))} readOnly={ro} aria-label={`${t("# Entregas objetivo", "# Deliveries objective")} · ${M[m]}`} /></td>)}<td className="pc-year" data-total="ENT_N">{ent.some((v) => v.trim()) ? ent.reduce((s2, v) => s2 + (Number(v) || 0), 0) : "—"}</td></tr>
            <tr data-k="FACT_COP"><th scope="row">{t("Meta facturación (US$)", "Invoicing goal (US$)")}</th>{fact.map((v, m) => <td key={m}><input className="pc-in" name={`fact_${m + 1}`} inputMode="decimal" value={v} onChange={(e) => setAt(setFact, m, e.target.value)} readOnly={ro} aria-label={`${t("Meta facturación", "Invoicing goal")} · ${M[m]}`} /></td>)}<td className="pc-year" data-total="FACT_COP">{show(annualFact)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="src" data-growth>
        {!prospects && basis.ocClose != null && annualOc > 0 ? t(`Crecimiento de la meta de OC frente al cierre ${basis.baseYear} proyectado: ${growthOf(annualOc, basis.ocClose)! > 0 ? "+" : ""}${one.format(growthOf(annualOc, basis.ocClose)!)} %. `, `Growth of the PO goal against the projected ${basis.baseYear} close: ${growthOf(annualOc, basis.ocClose)! > 0 ? "+" : ""}${one.format(growthOf(annualOc, basis.ocClose)!)} %. `) : ""}
        {annualEsa != null && annualOc > 0 ? t(`Margen de Eságara del año: ${one.format(marginOf(annualEsa, annualOc) ?? 0)} %.`, `Eságara margin of the year: ${one.format(marginOf(annualEsa, annualOc) ?? 0)} %.`) : ""}
      </p>

      <div className="pc-text">
        <label>{t("Potencial de la empresa", "Company's potential")}
          <select name="potential" defaultValue={saved?.potential ?? ""} disabled={ro}><option value="">—</option><option value="ALTO">{t("Alto", "High")}</option><option value="MEDIO">{t("Medio", "Medium")}</option><option value="BAJO">{t("Bajo", "Low")}</option></select>
        </label>
        <label>{t("Estrategia ECSA para esta empresa", "ECSA strategy for this company")}<textarea name="strategy" rows={3} maxLength={2000} defaultValue={saved?.strategy ?? ""} readOnly={ro} /></label>
        <label id="justificacion" className={bad === "justificacion" ? "pc-bad" : ""}>{t("Justificación (obligatoria para enviar si cambias la sugerencia de SOLU o no hay sugerencia)", "Justification (required to send if you change SOLU's suggestion or there is none)")}<textarea name="justification" rows={3} maxLength={2000} defaultValue={saved?.justification ?? ""} readOnly={ro} /></label>
      </div>

      {editable && (
        <div className="pc-actions">
          <button type="submit" className="secondary">{t("Guardar borrador", "Save draft")}</button>
          <button type="submit" formAction={send}>{t("Enviar a aprobación", "Send for approval")}</button>
          <span className="src">{t("«Enviar a aprobación» guarda primero y luego envía la propuesta a tu líder.", "«Send for approval» saves first and then sends the proposal to your leader.")}</span>
        </div>
      )}
      <details className="small" style={{ marginTop: 10 }}>
        <summary>{t("Cómo se calcula", "How it is calculated")}</summary>
        <ul className="mk-ul">
          <li>{t(`Sugerencia de SOLU = cierre ${basis.baseYear} proyectado × (1 + crecimiento), repartido por la estacionalidad elegida.`, `SOLU's suggestion = projected ${basis.baseYear} close × (1 + growth), spread by the chosen seasonality.`)}</li>
          <li>{t("# OC objetivo = meta OC ÷ ticket promedio, redondeado; mínimo 1 si la meta del mes es mayor que cero.", "# POs objective = PO goal ÷ average ticket, rounded; at least 1 when the month's goal is above zero.")}</li>
          <li>{t("Eságara objetivo = meta OC × Eságara objetivo (%).", "Eságara objective = PO goal × Eságara objective (%).")}</li>
          <li>{t("Cotizaciones requeridas ($) = meta OC ÷ bateo por valor. # Cotizaciones = # OC ÷ bateo por cantidad, hacia arriba. # Solicitudes = # Cotizaciones ÷ Solicitud → Cotización, hacia arriba.", "Quotes required ($) = PO goal ÷ batting by value. # Quotes = # POs ÷ batting by number, rounded up. # Requests = # Quotes ÷ Request → Quote, rounded up.")}</li>
          <li>{t(KPIS.FACT_COP.how.es, KPIS.FACT_COP.how.en)}</li>
          <li>{t(`# Entregas objetivo: lo escribes tú; SOLU no lo calcula. Lo real: ${KPIS.ENT_N.how.es}`, `# Deliveries objective: you type it; SOLU does not work it out. Real: ${KPIS.ENT_N.how.en}`)}</li>
          <li>{t("Los porcentajes se miden por grupos de origen en los últimos 24 meses: solo cotizaciones ya decididas (una abierta no cuenta como perdida) y solicitudes con más de 30 días. Con menos de 5 casos SOLU dice «sin base suficiente».", "The percentages are measured by cohort over the last 24 months: only quotes already decided (an open one is not a loss) and requests older than 30 days. With fewer than 5 cases SOLU says «not enough basis».")}</li>
        </ul>
      </details>
    </form>
  );
}
