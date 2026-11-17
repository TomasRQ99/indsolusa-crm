"use client";

import { useEffect, useState } from "react";
import { startGuide } from "@/components/shell/GuideOverlay";

// First day in SOLU: four things to try, each one starts the on-screen guide (with the sample cases to practise on).
// Shown on Mi Día until the person hides it; the choice is kept in this browser.

const KEY = "solu.primerdia.off";

export function FirstDay({ lang, name }: { lang: "ES" | "EN"; name: string }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== "1"); } catch { setShow(true); } }, []);
  if (!show) return null;
  const hide = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private window: hidden for this page only */ } setShow(false); };
  const items: { n: number; title: string; what: string; id: string; route: boolean }[] = [
    { n: 1, title: t("Conoce tu día", "Get to know your day"), what: t("Qué te necesita hoy, por qué, y cómo atenderlo desde esta misma pantalla.", "What needs you today, why, and how to handle it from this same screen."), id: "midia-today", route: false },
    { n: 2, title: t("Sigue un pedido de principio a fin", "Follow an order from start to finish"), what: t("De la necesidad del cliente hasta el resultado, con un caso de ejemplo. Es el camino de casi todo en SOLU.", "From the customer's need to the result, on a sample case. It is the path of almost everything in SOLU."), id: "resultado", route: true },
    { n: 3, title: t("Haz una cotización de práctica", "Make a practice quote"), what: t("Productos, liquidación de costos, Eságara y presentar, sobre una Necesidad de ejemplo.", "Products, cost settlement, Eságara and presenting, on a sample Need."), id: "quote", route: false },
    { n: 4, title: t("Registra el mensaje de un cliente", "Record a customer's message"), what: t("Pega un WhatsApp o el resumen de una llamada y mira qué entiende SOLU.", "Paste a WhatsApp or a call summary and see what SOLU understands."), id: "comunicacion", route: false },
  ];
  return (
    <section className="first-day" aria-label={t("Primer día en SOLU", "First day in SOLU")} data-noglossary>
      <div className="fd-head">
        <div>
          <b>{t(`¿Primera vez en SOLU, ${name}? Empieza por aquí`, `First time in SOLU, ${name}? Start here`)}</b>
          <span>{t("Cuatro cosas para probar. En cada una SOLU te guía paso a paso sobre la pantalla; nada de lo que hagas en un registro que dice (ejemplo) afecta a un cliente real.", "Four things to try. In each one SOLU guides you step by step on the screen; nothing you do on a record marked (ejemplo) affects a real customer.")}</span>
        </div>
        <button type="button" className="secondary sm" onClick={hide}>{t("Ya conozco SOLU: ocultar", "I know SOLU: hide")}</button>
      </div>
      <ol className="fd-list">
        {items.map((x) => (
          <li key={x.id}>
            <span className="fd-n" aria-hidden>{x.n}</span>
            <div><b>{x.title}</b><span>{x.what}</span></div>
            <button type="button" className="sm" onClick={() => startGuide(x.id, x.route)}>{t("Guíame", "Guide me")}</button>
          </li>
        ))}
      </ol>
      <p className="fd-tip">{t("Para cualquier otra cosa, usa «¿Cómo hago…?» en la barra de arriba. Las palabras con subrayado de puntos se pueden tocar para ver qué significan aquí.", "For anything else, use “How do I…?” in the top bar. Words with a dotted underline can be clicked to see what they mean here.")}</p>
    </section>
  );
}
