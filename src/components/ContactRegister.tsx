"use client";

import Link from "next/link";
import { useState } from "react";

// Comercial · Línea de comunicaciones: what a person can register for a company from the slide.
// Call, email and visit start with how it ended (check boxes, one at a time) and finish with the notes.
// A visit can also be planned or closed in full in Visitas: the form links there.

type Kind = "CALL" | "VIDEO" | "MEETING" | "EMAIL" | "NOTE";
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
  /** Per kind: the ways it can end. `counts` = it happened, so "what did it leave?" makes sense. */
  outcomes: Record<"CALL" | "VIDEO" | "MEETING" | "EMAIL", { key: string; label: string; counts: boolean }[]>;
  initial?: Kind | null;
};

export function ContactRegister({ es, action, accountId, u, rango, todayInput, contacts, kinds, outcomes, initial = null }: Props) {
  const [kind, setKind] = useState<Kind | null>(initial);
  const [outcome, setOutcome] = useState<string>("");
  const t = (a: string, b: string) => (es ? a : b);
  const tabs: { k: Kind; label: string }[] = [
    { k: "CALL", label: t("Llamada", "Call") },
    { k: "VIDEO", label: t("Videollamada", "Video call") },
    { k: "MEETING", label: t("Visita", "Visit") },
    { k: "EMAIL", label: t("Correo", "Email") },
    { k: "NOTE", label: t("Nota", "Note") },
  ];
  const pick = (k: Kind) => { setKind(kind === k ? null : k); setOutcome(""); };
  const ask: Record<Exclude<Kind, "NOTE">, { q: string; save: string }> = {
    CALL: { q: t("¿Cómo fue la llamada?", "How did the call go?"), save: t("Registrar llamada", "Save call") },
    VIDEO: { q: t("¿En qué va la videollamada?", "Where does the video call stand?"), save: t("Registrar videollamada", "Save video call") },
    MEETING: { q: t("¿En qué va la visita?", "Where does the visit stand?"), save: t("Registrar visita", "Save visit") },
    EMAIL: { q: t("¿En qué va el correo?", "Where does the email stand?"), save: t("Registrar correo", "Save email") },
  };
  const opts = kind && kind !== "NOTE" ? outcomes[kind] : [];
  const chosen = opts.find((o) => o.key === outcome) ?? null;
  // "What did it leave?" only when the contact really happened and could leave something.
  const leaves = !!chosen && chosen.counts && chosen.key !== "PENDING_REPLY";

  return (
    <div className="cl-reg">
      <div className="cl-acts" role="group" aria-label={t("Registrar", "Register")}>
        {tabs.map((x) => <button key={x.k} type="button" className={kind === x.k ? "on" : ""} aria-pressed={kind === x.k} onClick={() => pick(x.k)}>{x.label}</button>)}
      </div>
      {kind == null && <p className="src">{t("Elige qué quieres registrar.", "Choose what to register.")}</p>}

      {kind != null && kind !== "NOTE" && (
        <form action={action} className="qa-form cl-form" key={kind}>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="type" value={kind} />
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="rango" value={rango} />
          <input type="hidden" name="outcome" value={outcome} />
          <fieldset className="cl-checks">
            <legend>{ask[kind].q}</legend>
            {opts.map((o) => (
              <label key={o.key} className={outcome === o.key ? "on" : ""}>
                <input type="checkbox" checked={outcome === o.key} onChange={() => setOutcome(outcome === o.key ? "" : o.key)} /> {o.label}
              </label>
            ))}
          </fieldset>
          {chosen && !chosen.counts && <span className="src">{kind === "CALL"
            ? t("Queda en la historia como intento. La empresa sigue en el mismo rango hasta que hablemos.", "It stays in the history as an attempt. The company stays in the same range until we speak.")
            : t("Queda en la historia. La empresa sigue en el mismo rango hasta que se haga.", "It stays in the history. The company stays in the same range until it happens.")}</span>}
          <div className="qa-row">
            <label>{t("Fecha", "Date")}<input name="occurredAt" type="date" defaultValue={todayInput} max={todayInput} /></label>
            {contacts.length > 0 && (
              <label>{t("Con quién (opcional)", "With whom (optional)")}
                <select name="contactId" defaultValue=""><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              </label>
            )}
          </div>
          {leaves && (
            <label>{t("¿Qué dejó este contacto?", "What did this contact leave?")}
              <select name="valueKind" defaultValue=""><option value="">{t("Nada útil todavía", "Nothing useful yet")}</option>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
            </label>
          )}
          <label>{t("Notas", "Notes")}<textarea name="body" rows={3} maxLength={2000} placeholder={t("Qué pasó, qué quedó pendiente…", "What happened, what is still open…")} /></label>
          {kind === "MEETING" && <Link className="small" href={`/visitas?cliente=${accountId}#proximas`}>{t("Planear la visita con objetivos en Visitas", "Plan the visit with objectives in Visits")} →</Link>}
          <button type="submit" disabled={!chosen}>{ask[kind].save}</button>
          {!chosen && <span className="src">{t("Marca una de las casillas para poder guardar.", "Tick one of the boxes to be able to save.")}</span>}
        </form>
      )}

      {kind === "NOTE" && (
        <form action={action} className="qa-form cl-form" key="NOTE">
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="type" value="NOTE" />
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="rango" value={rango} />
          <label>{t("Nota", "Note")}<textarea name="body" rows={4} required maxLength={2000} autoFocus placeholder={t("Ej.: Cambian de jefe de compras en marzo", "E.g.: New purchasing lead in March")} /></label>
          <span className="src">{t("Una nota queda en la historia de la empresa, pero no cuenta como contacto: la empresa sigue en el mismo rango.", "A note stays in the company's history but doesn't count as a contact: the company stays in the same range.")}</span>
          <button type="submit">{t("Guardar nota", "Save note")}</button>
        </form>
      )}
    </div>
  );
}
