"use client";

import Link from "next/link";
import { useState } from "react";

// Comercial · Línea de comunicaciones: the four things a person can do with a company from the slide.
// Call, email and note are short forms saved here; a visit belongs to Visitas, so that button takes you there.

type Kind = "CALL" | "EMAIL" | "NOTE";
type Props = {
  es: boolean;
  action: (fd: FormData) => void | Promise<void>;
  accountId: string;
  /** View and band the person came from, so saving returns them to the same place. */
  u: string;
  rango: string;
  todayInput: string;
  contacts: { id: string; label: string }[];
  kinds: { key: string; label: string }[];
  initial?: Kind | null;
};

export function ContactRegister({ es, action, accountId, u, rango, todayInput, contacts, kinds, initial = null }: Props) {
  const [kind, setKind] = useState<Kind | null>(initial);
  const t = (a: string, b: string) => (es ? a : b);
  const tabs: { k: Kind | "VISIT"; label: string }[] = [
    { k: "CALL", label: t("Llamada", "Call") },
    { k: "VISIT", label: t("Visita", "Visit") },
    { k: "EMAIL", label: t("Correo", "Email") },
    { k: "NOTE", label: t("Nota", "Note") },
  ];
  const what: Record<Kind, { title: string; ph: string; save: string }> = {
    CALL: { title: t("¿De qué hablaron?", "What did you talk about?"), ph: t("Ej.: Confirmó la parada de enero", "E.g.: Confirmed the January shutdown"), save: t("Registrar llamada", "Save call") },
    EMAIL: { title: t("¿De qué trató el correo?", "What was the email about?"), ph: t("Ej.: Le envié el catálogo de sellos", "E.g.: Sent the seals catalogue"), save: t("Registrar correo", "Save email") },
    NOTE: { title: t("Nota", "Note"), ph: t("Ej.: Cambian de jefe de compras en marzo", "E.g.: New purchasing lead in March"), save: t("Guardar nota", "Save note") },
  };

  return (
    <div className="cl-reg">
      <div className="cl-acts" role="group" aria-label={t("Registrar", "Register")}>
        {tabs.map((x) => x.k === "VISIT"
          ? <Link key={x.k} href={`/visitas?cliente=${accountId}#proximas`}>{x.label} →</Link>
          : <button key={x.k} type="button" className={kind === x.k ? "on" : ""} aria-pressed={kind === x.k} onClick={() => setKind(kind === x.k ? null : (x.k as Kind))}>{x.label}</button>)}
      </div>
      {kind == null && <p className="src">{t("Elige qué quieres registrar. «Visita» te lleva a Visitas con esta empresa ya elegida.", "Choose what to register. “Visit” takes you to Visits with this company already chosen.")}</p>}
      {kind != null && (
        <form action={action} className="qa-form cl-form" key={kind}>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="type" value={kind} />
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="rango" value={rango} />
          <label>{what[kind].title}<input name="subject" required maxLength={200} placeholder={what[kind].ph} autoFocus /></label>
          <label>{kind === "NOTE" ? t("Detalle (opcional)", "Detail (optional)") : t("Notas (opcional)", "Notes (optional)")}<textarea name="body" rows={3} maxLength={2000} /></label>
          {kind !== "NOTE" && (
            <>
              <div className="qa-row">
                <label>{t("Fecha", "Date")}<input name="occurredAt" type="date" defaultValue={todayInput} max={todayInput} /></label>
                {contacts.length > 0 && (
                  <label>{t("Con quién (opcional)", "With whom (optional)")}
                    <select name="contactId" defaultValue=""><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                  </label>
                )}
              </div>
              <label>{t("¿Qué dejó este contacto?", "What did this contact leave?")}
                <select name="valueKind" defaultValue=""><option value="">{t("Nada útil todavía (sin respuesta, intento)", "Nothing useful yet (no answer, attempt)")}</option>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
              </label>
            </>
          )}
          {kind === "NOTE" && <span className="src">{t("Una nota queda en la historia de la empresa, pero no cuenta como contacto: la empresa sigue en el mismo rango.", "A note stays in the company's history but doesn't count as a contact: the company stays in the same range.")}</span>}
          <button type="submit">{what[kind].save}</button>
        </form>
      )}
    </div>
  );
}
