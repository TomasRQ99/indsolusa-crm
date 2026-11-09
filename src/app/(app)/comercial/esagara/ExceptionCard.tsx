// Comercial C2 · the Eságara exception card on a quote: ask, wait, answer, or see the decision.
import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import { REASONS, SCOPES } from "@/lib/esagara-rules";
import { canApprove } from "@/lib/esagara-gate";
import { answerException, requestException } from "./actions";

type T = I18n["t"];
type Hist = { at: string; by: string; action: string; text: string | null };
type Exc = {
  id: string; status: string; reasonCode: string; narrative: string; expectedBenefit: string; scope: string; alternatives: string | null;
  esagaraPct: unknown; saleAmount: unknown; esagaraAmount: unknown; thresholdPct: unknown; requestedById: string; requestedByName: string; requestedAt: Date;
  decidedByName: string | null; decidedAt: Date | null; comments: string | null; history: unknown;
};

export const EXC_ERR = (t: T): Record<string, string> => ({
  "exc-permiso": t("Solo quien lleva este Journey (o un admin) puede hacer esto.", "Only the Journey owner (or an admin) can do this."),
  "exc-estado": t("La excepción se pide sobre un borrador, antes de presentarlo.", "The exception is requested on a draft, before presenting it."),
  "exc-no-aplica": t("La Eságara de este borrador ya está en o por encima del umbral: no necesita excepción.", "This draft's Eságara is already at or above the threshold: no exception needed."),
  "exc-pendiente": t("Ya hay una solicitud esperando decisión para esta versión.", "There's already a request waiting for a decision on this version."),
  "exc-razon": t("Elige la razón empresarial.", "Pick the business reason."),
  "exc-narrativa": t("Explica la razón con tus palabras (al menos una frase completa).", "Explain the reason in your own words (at least a full sentence)."),
  "exc-beneficio": t("Escribe qué esperamos ganar a cambio.", "Write what we expect to gain in return."),
  "exc-alcance": t("Indica si es solo esta vez, por un periodo o recurrente.", "Say whether it's one time, for a period, or recurring."),
  "exc-vaga": t("«No quiero perder el negocio» sola no alcanza: di por qué este negocio vale la pena con menos Eságara.", "“I don't want to lose the deal” alone isn't enough: say why this deal is worth it with less Eságara."),
  "exc-autoridad": t("Esta decisión la toma Gerencia o Admin, y nunca quien la pidió.", "Management or Admin makes this decision, never the person who asked."),
  "exc-decidida": t("Esta solicitud ya no está esperando esa acción.", "This request is no longer waiting for that action."),
  "exc-accion": t("Elige aprobar, devolver con pregunta o rechazar.", "Choose approve, return with a question, or reject."),
  "exc-comentario": t("Para devolver o rechazar, escribe por qué. Así quien pidió sabe qué hacer.", "To return or reject, write why. That way the requester knows what to do."),
  "exc-vencida": t("La cotización ya no es un borrador: la solicitud quedó vencida.", "The quote is no longer a draft: the request expired."),
  "exc-cambio": t("La venta o la Eságara cambiaron desde la solicitud. Devuélvela para que quien pidió la actualice; se aprueba exactamente lo que verá el cliente.", "Sale or Eságara changed since the request. Return it so the requester refreshes it; you approve exactly what the customer will see."),
  "exc-respuesta": t("Escribe tu respuesta a la pregunta.", "Write your answer to the question."),
  "pol-valor": t("Revisa los valores de la política (números dentro de rango).", "Check the policy values (numbers within range)."),
});
export const EXC_OK = (t: T): Record<string, string> => ({
  "exc-pedida": t("Solicitud enviada a Gerencia con la economía de esta versión. Te avisamos cuando decidan.", "Request sent to Management with this version's economics. You'll be told when they decide."),
  "exc-approved": t("Excepción aprobada. La cotización ya puede presentarse con esta Eságara.", "Exception approved. The quote can now be presented with this Eságara."),
  "exc-returned": t("Devuelta con tu pregunta. Quien pidió la ve en su cotización.", "Returned with your question. The requester sees it on their quote."),
  "exc-rejected": t("Rechazada con tu comentario. La cotización sigue sin poder presentarse por debajo del umbral.", "Rejected with your comment. The quote still can't be presented below the threshold."),
  "exc-respondida": t("Respuesta enviada. La solicitud volvió a Gerencia con la economía actual.", "Answer sent. The request went back to Management with the current economics."),
  "pol-guardada": t("Política guardada como nueva versión. Las decisiones pasadas conservan la versión que usaron.", "Policy saved as a new version. Past decisions keep the version they used."),
  "pol-igual": t("Sin cambios: la política ya tenía esos valores.", "No changes: the policy already had those values."),
});

export const actionText = (t: T, a: string) =>
  ({ REQUESTED: t("Pidió excepción", "Requested exception"), ANSWERED: t("Respondió", "Answered"), APPROVED: t("Aprobó", "Approved"), RETURNED: t("Devolvió con pregunta", "Returned with a question"), REJECTED: t("Rechazó", "Rejected"), EXPIRED: t("Venció", "Expired") })[a] ?? a;

export function History({ h, i }: { h: unknown; i: I18n }) {
  const rows = (Array.isArray(h) ? (h as Hist[]) : []);
  if (!rows.length) return null;
  return (
    <ol className="exc-hist">
      {rows.map((r, n) => (
        <li key={n}><span className="src">{i.dateShort(new Date(r.at))} · {r.by}</span> <b>{actionText(i.t, r.action)}</b>{r.text && <span className="block">«{r.text}»</span>}</li>
      ))}
    </ol>
  );
}

/** Shown on a quote whenever the gate matters: below the threshold, or an exception exists. */
export function ExceptionCard({ quoteId, i, user, editable, draft, gate, threshold, exception: e, outside }: {
  quoteId: string; i: I18n; user: { id: string; role: string }; editable: boolean; draft: boolean;
  gate: { sale: number; esagara: number; pct: number | null; triggered: boolean; sacrificed: number }; threshold: number; exception: Exc | null; outside: boolean;
}) {
  const { t } = i;
  const money = (v: unknown) => `USD ${i.n2(v)}`;
  const reason = e ? REASONS[e.reasonCode] : null;
  const open = e && (e.status === "REQUESTED" || e.status === "RETURNED");
  const canAsk = editable && draft && gate.triggered && !open && (!e || e.status !== "APPROVED" || outside);
  if (!gate.triggered && !e) return null;

  return (
    <section className="jblock exc" id="esagara">
      <div className="jbh"><b>{t("PROTECCIÓN DE ESÁGARA", "ESÁGARA PROTECTION")}</b><span className="grow" />
        {e?.status === "REQUESTED" && <span className="sig info">{t("Esperando decisión", "Waiting for decision")}</span>}
        {e?.status === "RETURNED" && <span className="sig attn">{t("Te devolvieron una pregunta", "Returned with a question")}</span>}
        {e?.status === "APPROVED" && !outside && <span className="sig ok">{t("Excepción aprobada", "Exception approved")}</span>}
        {e?.status === "APPROVED" && outside && <span className="sig attn">{t("La aprobación ya no cubre esta economía", "The approval no longer covers these economics")}</span>}
        {e?.status === "REJECTED" && <span className="sig wait">{t("Rechazada", "Rejected")}</span>}
        {e?.status === "EXPIRED" && <span className="sig dash">{t("Vencida", "Expired")}</span>}
      </div>

      <p className="exc-num">
        {t("Eságara de esta versión", "This version's Eságara")}: <b>{money(gate.esagara)}</b> · <b>{i.pct2(gate.pct)}</b> {t("de", "of")} {money(gate.sale)}
        <span className="src block">{gate.triggered
          ? t(`El umbral es ${i.pct2(threshold)}. Venderla así deja ${money(gate.sacrificed)} menos que en el umbral. No está prohibido: la empresa lo decide a conciencia, con una razón.`, `The threshold is ${i.pct2(threshold)}. Selling it like this leaves ${money(gate.sacrificed)} less than at the threshold. It isn't forbidden: the company decides consciously, with a reason.`)
          : t(`Ya está en o por encima del umbral (${i.pct2(threshold)}).`, `It's already at or above the threshold (${i.pct2(threshold)}).`)}</span>
      </p>

      {e && (
        <div className="exc-req">
          <p><b>{reason ? t(reason.es, reason.en) : e.reasonCode}</b> · {SCOPES[e.scope] ? t(SCOPES[e.scope].es, SCOPES[e.scope].en) : e.scope}</p>
          <p>«{e.narrative}»</p>
          <p className="src">{t("Beneficio esperado", "Expected benefit")}: {e.expectedBenefit}</p>
          {e.alternatives && <p className="src">{t("Alternativas consideradas", "Alternatives considered")}: {e.alternatives}</p>}
          <p className="src">{t(`Pedida por ${e.requestedByName} el ${i.day(e.requestedAt)} a ${i.pct2(Number(e.esagaraPct))} sobre ${money(e.saleAmount)}.`, `Requested by ${e.requestedByName} on ${i.day(e.requestedAt)} at ${i.pct2(Number(e.esagaraPct))} on ${money(e.saleAmount)}.`)}
            {e.decidedByName && e.decidedAt && ` ${t(`Decidió ${e.decidedByName} el ${i.day(e.decidedAt)}.`, `Decided by ${e.decidedByName} on ${i.day(e.decidedAt)}.`)}`}</p>
          {e.status === "APPROVED" && outside && <p className="qv-alert">{t("La venta o la Eságara se movieron más de lo que la política tolera desde la aprobación. Pide una nueva excepción con la economía actual.", "Sale or Eságara moved more than the policy tolerates since the approval. Request a new exception with the current economics.")}</p>}
          <History h={e.history} i={i} />
          {e.status === "REQUESTED" && canApprove(user, e) && <Link className="qa-btn" href={`/comercial/esagara#e-${e.id}`}>{t("Decidir con el contexto completo", "Decide with the full context")}</Link>}
          {e.status === "RETURNED" && e.requestedById === user.id && draft && (
            <form action={answerException.bind(null, e.id)} className="qa-form" style={{ marginTop: 8 }}>
              <label>{t("Tu respuesta", "Your answer")}<textarea name="answer" rows={3} maxLength={1200} required /></label>
              <span className="src">{t("Si cambiaste precio o costos, se envía la economía actual.", "If you changed price or costs, the current economics are sent.")}</span>
              <button type="submit">{t("Responder y reenviar", "Answer and resend")}</button>
            </form>
          )}
        </div>
      )}

      {canAsk && (
        <details className="exc-ask" open={!e}>
          <summary className="qa-btn">{e ? t("Pedir una nueva excepción", "Request a new exception") : t("Pedir excepción a Gerencia", "Ask Management for an exception")}</summary>
          <form action={requestException.bind(null, quoteId)} className="qa-form">
            <label>{t("Razón empresarial", "Business reason")}
              <select name="reasonCode" required defaultValue="">
                <option value="" disabled>{t("Elige…", "Choose…")}</option>
                {Object.entries(REASONS).map(([k, r]) => <option key={k} value={k}>{t(r.es, r.en)}</option>)}
              </select>
            </label>
            <details className="src"><summary>{t("¿Qué pregunta responde cada razón?", "What question does each reason answer?")}</summary>
              <ul>{Object.values(REASONS).map((r, n) => <li key={n}><b>{t(r.es, r.en)}:</b> {t(r.hint.es, r.hint.en)}</li>)}</ul>
            </details>
            <label>{t("Explícalo con tus palabras", "Explain it in your own words")}<textarea name="narrative" rows={3} minLength={20} maxLength={1200} required placeholder={t("Por qué este negocio vale la pena con menos Eságara…", "Why this deal is worth it with less Eságara…")} /></label>
            <label>{t("¿Qué esperamos ganar a cambio?", "What do we expect to gain in return?")}<input name="expectedBenefit" minLength={10} maxLength={600} required /></label>
            <label>{t("Alcance", "Scope")}
              <select name="scope" required defaultValue="ONE_TIME">{Object.entries(SCOPES).map(([k, s]) => <option key={k} value={k}>{t(s.es, s.en)}</option>)}</select>
            </label>
            <label>{t("Alternativas que consideraste (opcional)", "Alternatives you considered (optional)")}<input name="alternatives" maxLength={600} placeholder={t("Otro proveedor, otro plazo, menos cantidad…", "Another supplier, another lead time, less quantity…")} /></label>
            <button type="submit">{t("Enviar a Gerencia", "Send to Management")}</button>
            <span className="src">{t("Gerencia ve esta misma economía, el crédito y el comportamiento de pago del cliente. Tú no puedes aprobar tu propia solicitud.", "Management sees these same economics, the customer's credit and payment behavior. You can't approve your own request.")}</span>
          </form>
        </details>
      )}
    </section>
  );
}
