"use client";

import { useActionState, useState } from "react";
import { createWorkerKey } from "./actions";

/** Shows the new key once, with a copy button. It is never shown again (only its last 4 characters). */
export function KeyButton({ es, has }: { es: boolean; has: boolean }) {
  const t = (a: string, b: string) => (es ? a : b);
  const [state, action, pending] = useActionState(createWorkerKey, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!state && (
        <form action={action} data-confirm={has ? t("La clave actual dejará de funcionar hasta que pegues la nueva en GitHub. ¿Crear una nueva?", "The current key stops working until you paste the new one in GitHub. Create a new one?") : undefined}>
          <button type="submit" disabled={pending}>{pending ? t("Creando…", "Creating…") : has ? t("Crear una clave nueva", "Create a new key") : t("Crear la clave para GitHub", "Create the key for GitHub")}</button>
        </form>
      )}
      {state && (
        <div className="card" style={{ margin: 0, borderColor: "var(--attn)" }}>
          <b className="small">{t("Copia esta clave ahora: no se volverá a mostrar.", "Copy this key now: it won't be shown again.")}</b>
          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <code className="mono" style={{ wordBreak: "break-all", flex: 1, minWidth: 0 }}>{state.key}</code>
            <button type="button" className="secondary sm" onClick={() => { navigator.clipboard?.writeText(state.key).then(() => setCopied(true)).catch(() => null); }}>{copied ? t("Copiada", "Copied") : t("Copiar", "Copy")}</button>
          </div>
          <span className="src">{t("Pégala en GitHub como secreto SOLU_WORKER_KEY (pasos abajo). No la pegues en chats ni correos.", "Paste it in GitHub as the SOLU_WORKER_KEY secret (steps below). Don't paste it in chats or emails.")}</span>
        </div>
      )}
    </div>
  );
}
