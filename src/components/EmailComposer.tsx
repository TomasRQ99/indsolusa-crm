"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { sendEmail, type EmailState } from "@/app/(app)/email/actions";

type Recipient = { id: string; label: string };

export function EmailComposer({ recipients, from, es }: { recipients: Recipient[]; from: string; es: boolean }) {
  const t = (a: string, b: string) => (es ? a : b);
  const [state, action, pending] = useActionState<EmailState, FormData>(sendEmail, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form only after a successful send, so a failed send doesn't lose the draft.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  if (recipients.length === 0) {
    return <p className="muted small">{t("Aún no hay contactos con correo.", "No contacts with an email address yet.")}</p>;
  }

  return (
    <form
      ref={formRef}
      className="stack"
      data-no-pending
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      <p className="muted small">{t(`Se envía desde ${from}`, `Sends from ${from}`)}</p>
      <label>
        {t("Para", "To")}
        <select name="contactId" required defaultValue="">
          <option value="" disabled>{t("Elige un contacto…", "Select a contact…")}</option>
          {recipients.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label>{t("Asunto", "Subject")}<input name="subject" required /></label>
      <label>{t("Mensaje", "Message")}<textarea name="body" required style={{ minHeight: 140 }} /></label>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="small" style={{ color: "var(--ok)" }}>{state.ok}</p>}
      <button type="submit" disabled={pending}>{pending ? t("Enviando…", "Sending…") : t("Enviar correo", "Send email")}</button>
    </form>
  );
}
