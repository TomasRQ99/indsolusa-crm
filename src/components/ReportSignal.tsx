"use client";

import { useState } from "react";
import { reportProductSignal } from "@/app/(app)/gerencia/actions";

// "Tell SOLU": a person reports a product defect of SOLU itself (re-typing data SOLU already had,
// a warning that wasn't needed, a warning that was missing). It measures the product, never people.
export function ReportSignal({ es, screen }: { es: boolean; screen?: string }) {
  const t = (a: string, b: string) => (es ? a : b);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) return <p className="note okn small">{t("Gracias. Quedó registrado como defecto de SOLU, no de una persona.", "Thanks. Recorded as a SOLU defect, not a person's.")}</p>;
  return (
    <details className="rsg-rep">
      <summary>{t("Reportar un defecto de SOLU", "Report a SOLU defect")}</summary>
      <form
        data-no-pending
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await reportProductSignal(new FormData(e.currentTarget)).catch(() => false);
          setBusy(false);
          if (ok) setDone(true);
        }}
        className="qa-form"
      >
        <label>{t("Qué pasó", "What happened")}
          <select name="kind" defaultValue="REENTRY">
            <option value="REENTRY">{t("Tuve que escribir algo que SOLU ya sabía", "I had to type something SOLU already knew")}</option>
            <option value="ATTENTION_NOISE">{t("SOLU me avisó algo que no necesitaba acción", "SOLU warned me about something that needed no action")}</option>
            <option value="ATTENTION_MISSED">{t("SOLU no me avisó algo que debía", "SOLU didn't warn me about something it should have")}</option>
          </select>
        </label>
        <label>{t("Dónde", "Where")}<input name="screen" defaultValue={screen ?? ""} maxLength={120} placeholder={t("Ej.: Necesidad · Facturación", "E.g.: Necessity · Billing")} /></label>
        <label>{t("Detalle", "Detail")}<input name="note" required maxLength={300} placeholder={t("Ej.: volví a escribir el NIT que ya estaba en el cliente", "E.g.: I retyped the tax ID that was already on the customer")} /></label>
        <button type="submit" disabled={busy}>{busy ? "…" : t("Enviar", "Send")}</button>
      </form>
    </details>
  );
}
