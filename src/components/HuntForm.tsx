import { startHunt } from "@/app/(app)/localizar/internet/actions";
import type { HuntAnswers } from "@/lib/web-hunt";

type T = (es: string, en: string) => string;

/** The questions asked before searching the internet for a piece. Only the piece itself is required: every answer
 *  is optional and only sharpens the search. */
export function HuntForm({ t, q, dealId, partId, needs, answers, showQuery, fixedDeal, state, cap }: {
  t: T; q: string; dealId?: string | null; partId?: string | null; needs: { id: string; label: string }[];
  answers?: HuntAnswers; showQuery?: boolean; /** inside a Need: the search is always for that Need */ fixedDeal?: boolean; state: "ON" | "OFF" | "CAP"; cap: number;
}) {
  if (state !== "ON") {
    return (
      <p className="note attn">
        {state === "OFF"
          ? t("La búsqueda en internet usa la inteligencia artificial, que todavía no está conectada. Gerencia la conecta en ADMINISTRACIÓN → Configuración → Inteligencia artificial.", "The internet search uses the AI, which is not connected yet. Management connects it in ADMINISTRATION → Settings → Artificial intelligence.")
          : t(`La búsqueda en internet está en pausa: este mes ya se usó el tope de USD ${cap} de inteligencia artificial. Vuelve el mes siguiente, o Gerencia puede subir el tope.`, `The internet search is paused: this month's AI cap of USD ${cap} is used up. It returns next month, or Management can raise the cap.`)}
      </p>
    );
  }
  return (
    <form action={startHunt} className="wl-form">
      {partId && <input type="hidden" name="part" value={partId} />}
      {showQuery
        ? <label className="wide">{t("Pieza que buscas (número de parte, nombre o marca)", "Piece you are looking for (part number, name or brand)")}<input name="q" required minLength={3} maxLength={200} defaultValue={q} /></label>
        : <input type="hidden" name="q" value={q} />}
      <label>{t("Marca (si la sabes)", "Brand (if you know it)")}<input name="brand" maxLength={80} defaultValue={answers?.brand ?? ""} /></label>
      <label>{t("Cantidad", "Quantity")}<input name="qty" inputMode="numeric" maxLength={20} defaultValue={answers?.qty ?? ""} placeholder="1" /></label>
      <label>{t("País de entrega", "Delivery country")}<input name="country" maxLength={60} defaultValue={answers?.country ?? "Colombia"} /></label>
      <label>{t("¿Sirve usada o reacondicionada?", "Is used or refurbished acceptable?")}
        <select name="condition" defaultValue={answers?.condition ?? "NEW"}>
          <option value="NEW">{t("No, solo nueva", "No, new only")}</option>
          <option value="ANY">{t("Sí, también usada o reacondicionada", "Yes, used or refurbished too")}</option>
        </select>
      </label>
      <label>{t("¿Sirve un equivalente de otra marca?", "Is an equivalent from another brand acceptable?")}
        <select name="equivalents" defaultValue={answers?.equivalents ? "1" : "0"}>
          <option value="0">{t("No, la misma marca y número", "No, the same brand and number")}</option>
          <option value="1">{t("Sí, también equivalentes", "Yes, equivalents too")}</option>
        </select>
      </label>
      {fixedDeal && dealId ? <input type="hidden" name="deal" value={dealId} /> : (
        <label>{t("¿Para qué Necesidad es? (opcional)", "Which Need is it for? (optional)")}
          <select name="deal" defaultValue={dealId ?? ""}>
            <option value="">{t("Todavía ninguna", "None yet")}</option>
            {needs.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </label>
      )}
      <label className="wide">{t("Datos que ayuden (voltaje, medidas, máquina donde va)", "Details that help (voltage, dimensions, the machine it goes in)")}<input name="details" maxLength={600} defaultValue={answers?.details ?? ""} /></label>
      <div className="wide wl-go">
        <button type="submit">{t("Buscar en internet", "Search the internet")}</button>
        <span className="src">{t("Tarda de 1 a 3 minutos y usa la inteligencia artificial (unos centavos de dólar por búsqueda). El resultado queda guardado para todo el equipo.", "It takes 1 to 3 minutes and uses the AI (a few US cents per search). The result is kept for the whole team.")}</span>
      </div>
    </form>
  );
}
