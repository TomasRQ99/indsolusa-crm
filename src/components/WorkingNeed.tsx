"use client";

import { useEffect, useState } from "react";

// "Volver a la Necesidad": working an order takes a person out of the Need (to the quote, the supplier order, the
// payment…), in other modules of the menu. The Need they are working on is remembered in this browser, and a button
// in the bottom corner of every other screen takes them straight back to it (owner, 2026-11-18).

const KEY = "solu:need";
const EVT = "solu:need-changed";
type Saved = { id: string; label: string };

const read = (): Saved | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.id === "string" ? { id: v.id, label: String(v.label ?? "") } : null;
  } catch { return null; }
};

/** Rendered by the Need and by every record that belongs to one: "this is the Need being worked on". */
export function MarkNeed({ id, label }: { id: string; label: string }) {
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ id, label })); window.dispatchEvent(new Event(EVT)); } catch { /* private window: the button just does not show */ }
  }, [id, label]);
  return null;
}

/** The button itself, mounted once in the shell. Hidden on the Need's own page. */
export function BackToNeed({ lang, path }: { lang: "ES" | "EN"; path: string }) {
  const [need, setNeed] = useState<Saved | null>(null);
  useEffect(() => {
    const sync = () => setNeed(read());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, [path]);
  if (!need || path === `/deals/${need.id}`) return null;
  const es = lang !== "EN";
  const forget = () => { try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ } setNeed(null); };
  return (
    <div className="back-need" role="navigation" aria-label={es ? "Volver a la Necesidad en la que trabajas" : "Back to the Need you are working on"}>
      <a href={`/deals/${need.id}`}>
        <span aria-hidden>←</span>
        <span className="bn-t"><b>{es ? "Volver a la Necesidad" : "Back to the Need"}</b>{need.label && <small>{need.label}</small>}</span>
      </a>
      <button type="button" onClick={forget} title={es ? "Quitar este botón" : "Remove this button"} aria-label={es ? "Quitar este botón" : "Remove this button"}>×</button>
    </div>
  );
}
