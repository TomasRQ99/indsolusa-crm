"use client";

import { useActionState } from "react";
import { sendTestEmail, type EmailState } from "@/app/(app)/email/actions";

export function TestEmailButton() {
  const [state, action, pending] = useActionState<EmailState, FormData>(sendTestEmail, {});
  return (
    <form action={action} className="stack">
      <div>
        <button className="secondary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send test email"}
        </button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="small" style={{ color: "var(--ok)" }}>{state.ok}</p>}
    </form>
  );
}
