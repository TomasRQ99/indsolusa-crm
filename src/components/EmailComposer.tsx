"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { sendEmail, type EmailState } from "@/app/(app)/email/actions";

type Recipient = { id: string; label: string };

export function EmailComposer({ recipients, from }: { recipients: Recipient[]; from: string }) {
  const [state, action, pending] = useActionState<EmailState, FormData>(sendEmail, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form only after a successful send, so a failed send doesn't lose the draft.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  if (recipients.length === 0) {
    return <p className="muted small">No contacts with an email address yet.</p>;
  }

  return (
    <form
      ref={formRef}
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      <p className="muted small">Sends from {from}</p>
      <label>
        To
        <select name="contactId" required defaultValue="">
          <option value="" disabled>Select a contact…</option>
          {recipients.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label>Subject<input name="subject" required /></label>
      <label>Message<textarea name="body" required style={{ minHeight: 140 }} /></label>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="small" style={{ color: "var(--ok)" }}>{state.ok}</p>}
      <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send email"}</button>
    </form>
  );
}
