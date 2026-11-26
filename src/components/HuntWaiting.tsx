"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Shown while an internet search runs: asks the server again every few seconds and counts the time. */
export function HuntWaiting({ startedAt, lang }: { startedAt: string; lang: "ES" | "EN" }) {
  const router = useRouter();
  const [sec, setSec] = useState(() => Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)));
  useEffect(() => {
    const tick = setInterval(() => setSec(Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))), 1000);
    const poll = setInterval(() => router.refresh(), 5000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [router, startedAt]);
  const mm = Math.floor(sec / 60), ss = String(sec % 60).padStart(2, "0");
  const step = sec < 20
    ? (lang === "EN" ? "Understanding which piece it is…" : "Entendiendo qué pieza es…")
    : sec < 90
      ? (lang === "EN" ? "Searching sellers on the internet…" : "Buscando vendedores en internet…")
      : (lang === "EN" ? "Opening each seller's page to check the part number…" : "Abriendo la página de cada vendedor para comprobar el número de parte…");
  return (
    <div className="wl-wait" role="status" aria-live="polite">
      <span className="wl-spin" aria-hidden />
      <div>
        <b>{step}</b>
        <div className="src">{lang === "EN" ? `Time: ${mm}:${ss}. It usually takes 1 to 3 minutes.` : `Tiempo: ${mm}:${ss}. Suele tardar de 1 a 3 minutos.`}</div>
      </div>
    </div>
  );
}
