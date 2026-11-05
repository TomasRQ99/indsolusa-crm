"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ es }: { es: boolean }) {
  const t = (a: string, b: string) => (es ? a : b);
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="stack">
      <label>
        {t("Correo", "Email")}
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        {t("Contraseña", "Password")}
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t("Ingresando…", "Signing in…") : t("Ingresar", "Sign in")}
      </button>
    </form>
  );
}
