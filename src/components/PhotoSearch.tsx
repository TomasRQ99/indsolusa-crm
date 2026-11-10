"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { queryFromText, readingFromText } from "@/lib/nameplate-text";

type State = "ON" | "OFF" | "CAP";
const MAX_SIDE = 1568; // larger images cost more and don't read better

// Free reading (decision 2026-11-10): when the AI is off or at its monthly cap, the browser reads the
// nameplate text itself with Tesseract (open source, runs on this computer, no cost, the photo never leaves it).
const OCR_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
type Tess = { recognize: (img: Blob, lang: string, opts?: { logger?: (m: { status: string; progress: number }) => void }) => Promise<{ data: { text: string } }> };
let tessLoad: Promise<Tess> | null = null;
function loadTesseract(): Promise<Tess> {
  const w = window as unknown as { Tesseract?: Tess };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  tessLoad ??= new Promise<Tess>((res, rej) => {
    const s = document.createElement("script");
    s.src = OCR_SRC;
    s.async = true;
    s.onload = () => (w.Tesseract ? res(w.Tesseract) : rej(new Error("no Tesseract")));
    s.onerror = () => { tessLoad = null; rej(new Error("load")); };
    document.head.appendChild(s);
  });
  return tessLoad;
}

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
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const free = state !== "ON";

  const errText = (code: string) =>
    ({
      TOO_BIG: t("La foto es demasiado grande.", "The photo is too large."),
      TYPE: t("Usa una foto JPG, PNG o WEBP.", "Use a JPG, PNG or WEBP photo."),
      REFUSED: t("La IA no quiso analizar esta imagen. Prueba con otra foto.", "The AI declined to analyze this image. Try another photo."),
      BAD_OUTPUT: t("No pude leer la respuesta de la IA. Intenta otra vez.", "I couldn't read the AI's answer. Try again."),
      RATE: t("La IA está ocupada. Intenta en un minuto.", "The AI is busy. Try again in a minute."),
      AUTH: t("La clave de IA no es válida. Avísale al administrador.", "The AI key isn't valid. Tell the admin."),
      OCR_LOAD: t("No se pudo cargar el lector de texto. Revisa tu conexión a internet e intenta otra vez.", "Couldn't load the text reader. Check your internet connection and try again."),
      OCR: t("No se pudo leer el texto de la foto. Intenta otra vez.", "Couldn't read the text in the photo. Try again."),
    })[code] ?? t("No se pudo analizar la foto. Intenta otra vez.", "Couldn't analyze the photo. Try again.");

  function show(reading: unknown, query: string) {
    const r = encodeURIComponent(JSON.stringify(reading));
    router.push(`/localizar?${query ? `q=${encodeURIComponent(query)}&` : ""}foto=${r}`);
  }

  async function readFree(blob: Blob) {
    let tess: Tess;
    try { tess = await loadTesseract(); } catch { setMsg(errText("OCR_LOAD")); return; }
    try {
      const out = await tess.recognize(blob, "eng", { logger: (m) => { if (m.status === "recognizing text") setProgress(Math.round(m.progress * 100)); } });
      const reading = readingFromText(out.data.text ?? "");
      show(reading, queryFromText(reading));
    } catch { setMsg(errText("OCR")); }
  }

  async function run(file: File) {
    if (busy) return;
    setBusy(true);
    setProgress(null);
    setMsg(null);
    try {
      const blob = await shrink(file);
      setPreview(URL.createObjectURL(blob));
      if (free) { await readFree(blob); return; }
      const fd = new FormData();
      fd.append("file", blob, "foto.jpg");
      const r = await fetch("/localizar/foto", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({ error: "API" }));
      // The AI hit its cap or lost its key mid-month: fall back to the free reader instead of failing.
      if (j.error === "CAP" || j.error === "OFF" || j.error === "AUTH") { await readFree(blob); return; }
      if (!r.ok || j.error) { setMsg(errText(j.error ?? "API")); return; }
      show({ ...j.reading, via: "AI" }, j.query ?? "");
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

  const busyText = free
    ? progress == null ? t("Preparando el lector de texto…", "Preparing the text reader…") : t(`Leyendo el texto de la placa… ${progress}%`, `Reading the nameplate text… ${progress}%`)
    : t("Analizando la foto…", "Analyzing the photo…");
  const hint = free
    ? state === "CAP"
      ? t(`Se usó el límite mensual de IA (USD ${cap}); por ahora la foto se lee gratis en tu navegador: lee el texto de la placa (números, marca, kW, V…), no reconoce la pieza por su forma.`, `The monthly AI limit (USD ${cap}) is used up; for now the photo is read for free in your browser: it reads the nameplate text (numbers, brand, kW, V…), not the part's shape.`)
      : t("Foto de la placa, de frente y con buena luz. Se lee gratis en tu navegador (la foto no sale de tu equipo): lee números, marca y datos impresos; no reconoce la pieza por su forma. También puedes arrastrarla o pegarla (Ctrl+V).", "Photo of the nameplate, straight on and well lit. It's read for free in your browser (the photo stays on your device): it reads printed numbers, brand and ratings; it can't recognize a part by its shape. You can also drag it here or paste it (Ctrl+V).")
    : t("Foto de la placa o de la pieza. También puedes arrastrarla o pegarla (Ctrl+V).", "Photo of the nameplate or the part. You can also drag it here or paste it (Ctrl+V).");

  return (
    <div className="loc-photo" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) run(f); }}>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ""; }} />
      <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}>
        {busy ? busyText : free ? t("Leer placa desde foto", "Read nameplate from photo") : t("Buscar por foto", "Search by photo")}
      </button>
      <span className="src">{hint}</span>
      {preview && busy && <img src={preview} alt="" className="loc-photo-prev" />}
      {msg && <p className="note attn" role="alert">{msg}</p>}
    </div>
  );
}
