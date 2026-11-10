import { VALUE_KINDS } from "@/lib/goal-rules";

/** Comercial C7 §39: "what did this contact leave?" — only a contact that left something counts as useful. */
export function ValueKindSelect({ es }: { es: boolean }) {
  return (
    <label>{es ? "¿Qué dejó este contacto?" : "What did this contact leave?"}
      <select name="valueKind" defaultValue="">
        <option value="">{es ? "Nada útil todavía (sin respuesta, intento)" : "Nothing useful yet (no answer, attempt)"}</option>
        {Object.entries(VALUE_KINDS).map(([k, v]) => <option key={k} value={k}>{es ? v.es : v.en}</option>)}
      </select>
    </label>
  );
}
