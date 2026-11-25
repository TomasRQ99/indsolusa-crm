"use client";

import { useEffect, useRef, useState } from "react";
import { draftNeedWithAi, type NeedAiResult } from "@/app/(app)/deals/ai-actions";

// "Crear Necesidad con IA" (owner, 2026-11-24): the person tells the case by voice or text; SOLU takes what matters,
// asks for what is missing, proposes what to do and drafts the reply to the customer. The result only fills the
// "Nueva Necesidad" form: the person reviews it there and presses the form's own button. Until the company connects
// its AI key, the button opens a notice that says so.

export type NeedAiFill = Extract<NeedAiResult, { ok: true }>;

// Dictation uses the browser's own speech recognition (Chrome and Edge): free, and nothing is recorded by SOLU.
type Recognizer = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const recognizerClass = () => (typeof window === "undefined" ? null : ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition ?? null)) as (new () => Recognizer) | null;

export function AiNeedButton({ lang, configured, onUse, seed }: { lang: "ES" | "EN"; configured: boolean; onUse?: (r: NeedAiFill) => void; seed?: { text: string; from: string } | null }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const ref = useRef<HTMLDialogElement>(null);
  const rec = useRef<Recognizer | null>(null);
  const [text, setText] = useState(seed?.text ?? "");
  // Coming from a conversation in Comunicación: the window opens by itself with that conversation as the case.
  useEffect(() => { if (seed && configured && !ref.current?.open) ref.current?.showModal(); }, [seed, configured]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<NeedAiFill | null>(null);
  const canDictate = !!recognizerClass();

  const errText: Record<string, string> = {
    CORTO: t("Cuenta un poco más del caso: quién pide, qué necesita y para qué.", "Tell a bit more of the case: who is asking, what they need and what for."),
    OFF: t("La IA no está conectada todavía. Usa el formulario «Nueva Necesidad».", "AI is not connected yet. Use the «New Need» form."),
    CAP: t("La IA llegó al tope de gasto de este mes. Usa el formulario «Nueva Necesidad».", "AI reached this month's spending cap. Use the «New Need» form."),
    AUTH: t("La llave de IA no fue aceptada. Avisa a Gerencia: se revisa en ADMINISTRACIÓN → Configuración → Inteligencia artificial.", "The AI key was not accepted. Tell Management: it is checked in ADMINISTRATION → Settings → Artificial intelligence."),
    RATE: t("La IA está ocupada en este momento. Espera un minuto e intenta de nuevo.", "AI is busy right now. Wait a minute and try again."),
    FALLO: t("La IA no pudo armar la Necesidad esta vez. Intenta de nuevo, o usa el formulario «Nueva Necesidad».", "AI could not build the Need this time. Try again, or use the «New Need» form."),
  };

  const stop = () => { rec.current?.stop(); rec.current = null; setListening(false); };
  const dictate = () => {
    if (listening) return stop();
    const C = recognizerClass();
    if (!C) return;
    const r = new C();
    r.lang = lang === "EN" ? "en-US" : "es-CO"; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { let add = ""; for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) add += e.results[k][0].transcript; if (add.trim()) setText((v) => `${v}${v && !/\s$/.test(v) ? " " : ""}${add.trim()}`.slice(0, 8000)); };
    r.onend = () => { rec.current = null; setListening(false); };
    r.onerror = () => { rec.current = null; setListening(false); };
    rec.current = r; setListening(true);
    try { r.start(); } catch { rec.current = null; setListening(false); }
  };
  const close = () => { stop(); ref.current?.close(); };
  const run = async () => {
    stop(); setErr(null); setBusy(true);
    try {
      const r = await draftNeedWithAi(text);
      if (r.ok) setRes(r); else setErr(errText[r.error] ?? errText.FALLO);
    } catch { setErr(errText.FALLO); }
    setBusy(false);
  };
  const use = () => { if (res) onUse?.(res); close(); setRes(null); setText(""); };
  const d = res?.draft;
  const rows: [string, string | null][] = d ? [
    [t("Cliente", "Customer"), res!.accountName ?? (d.customerName ? t(`${d.customerName} · no está en la lista: elígelo en el formulario`, `${d.customerName} · not on the list: pick it on the form`) : null)],
    [t("Contacto", "Contact"), d.contactName ? (res!.contactId ? d.contactName : t(`${d.contactName} · elígelo en el formulario`, `${d.contactName} · pick it on the form`)) : null],
    [t("Asunto", "Subject"), d.title || null],
    [t("Resultado que busca", "Result they want"), d.desiredResult],
    [t("Detalle", "Detail"), d.needSpecs],
    [t("Código o número de parte", "Code or part number"), d.itemCode],
    [t("Cantidad", "Quantity"), d.itemQty ? String(d.itemQty) : null],
    [t("Producto o repuesto", "Product or spare part"), d.itemDescription],
    [t("Máquina o equipo", "Machine or equipment"), d.machine],
    [t("Observaciones (uso interno)", "Notes (internal use)"), d.internalNotes],
  ] : [];

  return (
    <>
      <button type="button" className="btn secondary ai-need-btn" onClick={() => ref.current?.showModal()}>
        <span aria-hidden>✦</span> {t("Crear Necesidad con IA", "Create Need with AI")}
      </button>
      <dialog ref={ref} className={`ai-need-dlg${configured ? " wide" : ""}`} aria-labelledby="ai-need-h" onClose={stop} onClick={(e) => { if (e.target === ref.current && !busy) close(); }}>
        <div className="ai-need-box">
          <h2 id="ai-need-h"><span aria-hidden>✦</span> {t("Crear Necesidad con IA", "Create Need with AI")}</h2>
          {!configured ? (
            <>
              <p className="ai-need-msg"><b>{t("Necesita la llave de IA (API key).", "Needs the AI key (API key).")}</b> {t("Todavía no está conectada. Gerencia la conecta en Render, en la variable ANTHROPIC_API_KEY. Mientras tanto, usa el formulario «Nueva Necesidad».", "It is not connected yet. Management connects it in Render, in the ANTHROPIC_API_KEY variable. Meanwhile, use the «New Need» form.")}</p>
              <p className="src">{t("Con la llave podrás dictar o escribir el caso: SOLU toma lo importante, pregunta lo que falta, propone qué hacer y prepara la respuesta al cliente.", "With the key you will dictate or type the case: SOLU takes what matters, asks for what is missing, proposes what to do and drafts the reply to the customer.")}</p>
              <div className="ai-need-act"><button type="button" className="btn" autoFocus onClick={close}>{t("Entendido", "Got it")}</button></div>
            </>
          ) : !d ? (
            <>
              <label className="ai-need-l">{t("Cuenta el caso como se lo contarías a un compañero", "Tell the case as you would tell a colleague")}
                <textarea rows={7} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus placeholder={t("Ej.: Me llamó Jorge de Lácteos del Valle. Se les dañó el variador de la envasadora de la línea 3, un Siemens G120C de 7,5 kW. Necesitan uno cuanto antes porque la línea está parada.", "E.g.: Jorge from Lácteos del Valle called. The drive on the line 3 filler failed, a 7.5 kW Siemens G120C. They need one as soon as possible because the line is stopped.")} />
              </label>
              {seed && <p className="ai-need-msg">{t(`Este es el texto de la conversación con ${seed.from}. Puedes agregar lo que sepas del caso antes de armar la Necesidad.`, `This is the text of the conversation with ${seed.from}. You can add what you know about the case before building the Need.`)}</p>}
              <p className="src">{canDictate ? t("Puedes escribir o dictar. El dictado lo hace tu navegador; revisa los números de parte, que al dictar suelen quedar mal.", "You can type or dictate. Dictation is done by your browser; check part numbers, which often come out wrong when dictated.") : t("Escribe el caso. El dictado funciona en Chrome y Edge.", "Type the case. Dictation works in Chrome and Edge.")}</p>
              {err && <p className="note attn" role="alert">{err}</p>}
              <div className="ai-need-act">
                {canDictate && <button type="button" className={`btn secondary${listening ? " on" : ""}`} onClick={dictate} disabled={busy}>{listening ? t("Detener el dictado", "Stop dictating") : t("Dictar", "Dictate")}</button>}
                <span className="grow" />
                <button type="button" className="btn secondary" onClick={close} disabled={busy}>{t("Cancelar", "Cancel")}</button>
                <button type="button" className="btn" onClick={run} disabled={busy || text.trim().length < 20}>{busy ? t("Armando la Necesidad…", "Building the Need…") : t("Armar la Necesidad", "Build the Need")}</button>
              </div>
            </>
          ) : (
            <>
              <p className="ai-need-msg">{t("Esto entendió SOLU. Nada se ha creado ni enviado: al pasarlo al formulario lo revisas casilla por casilla.", "This is what SOLU understood. Nothing has been created or sent: once it is on the form you review it box by box.")}</p>
              <dl className="ai-need-dl">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              {d.missing.length > 0 && <div className="ai-need-sec"><b>{t("Lo que falta preguntar al cliente", "What still needs asking the customer")}</b><ul>{d.missing.map((x, n) => <li key={n}>{x}</li>)}</ul></div>}
              {d.plan.length > 0 && <div className="ai-need-sec"><b>{t("Qué propone SOLU", "What SOLU proposes")}</b><ul>{d.plan.map((x, n) => <li key={n}>{x}</li>)}</ul></div>}
              {d.replyBody && <details className="ai-need-sec"><summary>{t("Ver la respuesta preparada para el cliente", "See the reply prepared for the customer")}</summary><p className="ai-need-reply">{d.replyBody}</p></details>}
              <p className="src">{t("Lo que falta y la propuesta quedan en «Observaciones (uso interno)». La respuesta al cliente se abre para que la revises después de crear la Necesidad, si dejas marcada la casilla del correo.", "What is missing and the proposal go into “Notes (internal use)”. The reply to the customer opens for your review after the Need is created, if you leave the email box ticked.")}</p>
              <div className="ai-need-act">
                <button type="button" className="btn secondary" onClick={() => setRes(null)}>{t("Volver a contar el caso", "Tell the case again")}</button>
                <span className="grow" />
                <button type="button" className="btn" autoFocus onClick={use}>{t("Pasar al formulario", "Move to the form")}</button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
