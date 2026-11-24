"use client";

import { useRef } from "react";

// "Crear Necesidad con IA" (owner, 2026-11-24): the option is visible from now on; until the company connects its
// AI key it only opens a notice that says so. Describing the case by voice or text, SOLU taking the relevant facts,
// asking for what is missing, proposing a course of action and drafting the reply to the customer comes with the key.

export function AiNeedButton({ lang, configured }: { lang: "ES" | "EN"; configured: boolean }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="btn secondary ai-need-btn" onClick={() => ref.current?.showModal()}>
        <span aria-hidden>✦</span> {t("Crear Necesidad con IA", "Create Need with AI")}
      </button>
      <dialog ref={ref} className="ai-need-dlg" aria-labelledby="ai-need-h" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="ai-need-box">
          <h2 id="ai-need-h"><span aria-hidden>✦</span> {t("Crear Necesidad con IA", "Create Need with AI")}</h2>
          {configured ? (
            <p className="ai-need-msg"><b>{t("La llave de IA ya está conectada.", "The AI key is already connected.")}</b> {t("Esta función se activa en la próxima entrega de SOLU. Mientras tanto, usa el formulario «Nueva Necesidad».", "This feature is switched on in the next SOLU release. Meanwhile, use the «New Need» form.")}</p>
          ) : (
            <p className="ai-need-msg"><b>{t("Necesita la llave de IA (API key).", "Needs the AI key (API key).")}</b> {t("Todavía no está conectada. Gerencia la conecta en Render, en la variable ANTHROPIC_API_KEY. Mientras tanto, usa el formulario «Nueva Necesidad».", "It is not connected yet. Management connects it in Render, in the ANTHROPIC_API_KEY variable. Meanwhile, use the «New Need» form.")}</p>
          )}
          <p className="src">{t("Con la llave podrás dictar o escribir el caso: SOLU toma lo importante, pregunta lo que falta, crea la Necesidad, propone qué hacer y prepara la respuesta al cliente.", "With the key you will dictate or type the case: SOLU takes what matters, asks for what is missing, creates the Need, proposes what to do and drafts the reply to the customer.")}</p>
          <div className="ai-need-act"><button type="button" className="btn" autoFocus onClick={() => ref.current?.close()}>{t("Entendido", "Got it")}</button></div>
        </div>
      </dialog>
    </>
  );
}
