"use client";
// Seguimientos: the urgency mark of a Need, changed right on the row. It saves by itself when a value is chosen.
import { useState, useTransition } from "react";
import { setUrgency } from "./actions";

export default function UrgencyPick({ dealId, value, es, about }: { dealId: string; value: string | null; es: boolean; about: string }) {
  const [v, setV] = useState(value ?? "");
  const [busy, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <select
      className="fu-urg" data-u={v || "NONE"} value={v} disabled={busy} aria-busy={busy}
      aria-label={es ? `Urgencia de ${about}` : `Urgency of ${about}`}
      title={failed ? (es ? "No se pudo guardar. Intenta de nuevo." : "Could not save. Try again.") : es ? "Urgencia: se guarda al elegir" : "Urgency: saved when you choose"}
      onChange={(e) => {
        const next = e.target.value, prev = v;
        setV(next); setFailed(false);
        start(async () => { const r = await setUrgency(dealId, next).catch(() => ({ ok: false })); if (!r.ok) { setV(prev); setFailed(true); } });
      }}
    >
      <option value="">{es ? "Urgencia: sin marcar" : "Urgency: not marked"}</option>
      <option value="ALTA">{es ? "Urgencia alta" : "High urgency"}</option>
      <option value="MEDIA">{es ? "Urgencia media" : "Medium urgency"}</option>
      <option value="BAJA">{es ? "Urgencia baja" : "Low urgency"}</option>
    </select>
  );
}
