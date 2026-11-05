"use client";

import { useActionState } from "react";
import { changePassword, type PasswordState } from "./actions";

export function PasswordForm({ es }: { es: boolean }) {
  const t = (a: string, b: string) => (es ? a : b);
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="stack" style={{ maxWidth: 360 }}>
      <label>{t("Contraseña actual", "Current password")}<input name="current" type="password" autoComplete="current-password" required /></label>
      <label>{t("Nueva contraseña", "New password")}<input name="next" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>{t("Confirmar nueva contraseña", "Confirm new password")}<input name="confirm" type="password" autoComplete="new-password" required /></label>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="small" style={{ color: "var(--ok)" }}>{state.ok}</p>}
      <button type="submit" disabled={pending}>{pending ? t("Guardando…", "Saving…") : t("Cambiar contraseña", "Change password")}</button>
    </form>
  );
}
