"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type State = "ON" | "OFF" | "CAP";
const MAX_SIDE = 1568; // larger images cost more and don't read better

/** Shrinks the photo in the browser (faster upload, lower AI cost) and returns a JPEG. */
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.88));
}

export function PhotoSearch({ lang, state, cap }: { lang: "ES" | "EN"; state: State; cap: number }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const errText = (code: string) =>
    ({
      OFF: t("La búsqueda por foto se activa cuando el administrador agregue la clave de IA en Render (ANTHROPIC_API_KEY).", "Photo search turns on once the admin adds the AI key in Render (ANTHROPIC_API_KEY)."),
      CAP: t(`Se alcanzó el límite mensual de IA (USD ${cap}). Vuelve el mes próximo o pide a administración subir el límite.`, `The monthly AI limit (USD ${cap}) was reached. It resets next month, or ask an admin to raise it.`),
      TOO_BIG: t("La foto es demasiado grande.", "The photo is too large."),
      TYPE: t("Usa una foto JPG, PNG o WEBP.", "Use a JPG, PNG or WEBP photo."),
      REFUSED: t("La IA no quiso analizar esta imagen. Prueba con otra foto.", "The AI declined to analyze this image. Try another photo."),
      BAD_OUTPUT: t("No pude leer la respuesta de la IA. Intenta otra vez.", "I couldn't read the AI's answer. Try again."),
      RATE: t("La IA está ocupada. Intenta en un minuto.", "The AI is busy. Try again in a minute."),
      AUTH: t("La clave de IA no es válida. Avísale al administrador.", "The AI key isn't valid. Tell the admin."),
    })[code] ?? t("No se pudo analizar la foto. Intenta otra vez.", "Couldn't analyze the photo. Try again.");

  async function run(file: File) {
    if (busy) return;
    if (state !== "ON") { setMsg(errText(state)); return; }
    setBusy(true);
    setMsg(null);
    try {
      const blob = await shrink(file);
      setPreview(URL.createObjectURL(blob));
      const fd = new FormData();
      fd.append("file", blob, "foto.jpg");
      const r = await fetch("/localizar/foto", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({ error: "API" }));
      if (!r.ok || j.error) { setMsg(errText(j.error ?? "API")); return; }
      const reading = encodeURIComponent(JSON.stringify(j.reading));
      router.push(`/localizar?${j.query ? `q=${encodeURIComponent(j.query)}&` : ""}foto=${reading}`);
    } catch {
      setMsg(errText("API"));
    } finally {
      setBusy(false);
    }
  }

  // Paste a screenshot (e.g. from WhatsApp Web) anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); run(f); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  return (
    <div className="loc-photo" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) run(f); }}>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ""; }} />
      <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}>
        {busy ? t("Analizando la foto…", "Analyzing the photo…") : t("Buscar por foto", "Search by photo")}
      </button>
      <span className="src">{t("Foto de la placa o de la pieza. También puedes arrastrarla o pegarla (Ctrl+V).", "Photo of the nameplate or the part. You can also drag it here or paste it (Ctrl+V).")}</span>
      {preview && busy && <img src={preview} alt="" className="loc-photo-prev" />}
      {msg && <p className="note attn" role="alert">{msg}</p>}
    </div>
  );
}
