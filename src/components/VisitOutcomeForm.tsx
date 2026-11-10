"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addVisitFiles, draftVisitOutcome, recordOutcome } from "@/app/(app)/visitas/actions";

// Comercial C8d · closing a visit. Three helpers, all optional, and the person always reviews before saving:
//  - Dictate: the browser turns voice into text (free; the audio is never stored or uploaded by SOLU).
//  - Read a photo: the browser reads printed text from a photo (free, stays on this device).
//  - AI draft: proposes learnings, commitments, a new need and the next step from the notes (only when AI is on).

type AiState = "ON" | "OFF" | "CAP";
type Kind = { key: string; label: string };
const OCR_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
type Tess = { recognize: (img: Blob, lang: string, opts?: { logger?: (m: { status: string; progress: number }) => void }) => Promise<{ data: { text: string } }> };
let tessLoad: Promise<Tess> | null = null;
function loadTesseract(): Promise<Tess> {
  const w = window as unknown as { Tesseract?: Tess };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  tessLoad ??= new Promise<Tess>((res, rej) => {
    const s = document.createElement("script");
    s.src = OCR_SRC; s.async = true;
    s.onload = () => (w.Tesseract ? res(w.Tesseract) : rej(new Error("no Tesseract")));
    s.onerror = () => { tessLoad = null; rej(new Error("load")); };
    document.head.appendChild(s);
  });
  return tessLoad;
}

const MAX_SIDE = 1568;
/** Shrinks a photo in the browser so it uploads fast and takes little database space. */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), "image/jpeg", 0.82));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

type Rec = { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void; onend: () => void; onerror: (e: { error: string }) => void; start: () => void; stop: () => void };

export function VisitOutcomeForm({ visitId, lang, aiState, objectives, kinds, defaultDate, canAttach }: { visitId: string; lang: "ES" | "EN"; aiState: AiState; objectives: string[]; kinds: Kind[]; defaultDate: string; canAttach: boolean }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const rec = useRef<Rec | null>(null);
  const [notes, setNotes] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState<null | "ocr" | "ai">(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "attn" | "okn" | "risk"; text: string } | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [needOpen, setNeedOpen] = useState(false);
  const add = (text: string) => setNotes((n) => (n.trim() ? `${n.trim()}\n${text.trim()}` : text.trim()).slice(0, 2000));

  function dictate() {
    if (listening) { rec.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setMsg({ tone: "attn", text: t("Este navegador no dicta. Usa Chrome o Edge, o el micrófono del teclado de tu celular.", "This browser can't dictate. Use Chrome or Edge, or your phone keyboard's microphone.") }); return; }
    const r = new Ctor();
    r.lang = lang === "EN" ? "en-US" : "es-CO"; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { let s = ""; for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) s += e.results[k][0].transcript; if (s.trim()) add(s); };
    r.onend = () => setListening(false);
    r.onerror = (e) => { setListening(false); if (e.error === "not-allowed" || e.error === "service-not-allowed") setMsg({ tone: "attn", text: t("El navegador no tiene permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.", "The browser isn't allowed to use the microphone. Enable it from the padlock in the address bar.") }); };
    rec.current = r; setMsg(null); setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

  async function readPhoto(file: File) {
    if (busy) return;
    setBusy("ocr"); setProgress(null); setMsg(null);
    try {
      const small = await shrinkPhoto(file);
      const tess = await loadTesseract();
      const out = await tess.recognize(small, lang === "EN" ? "eng" : "spa", { logger: (m) => { if (m.status === "recognizing text") setProgress(Math.round(m.progress * 100)); } });
      const text = (out.data.text ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length < 3) setMsg({ tone: "attn", text: t("No encontré texto legible en la foto.", "I found no readable text in the photo.") });
      else { add(text); setMsg({ tone: "okn", text: t("Texto de la foto añadido a tus notas. Revísalo: la lectura puede tener errores.", "Photo text added to your notes. Check it: the reading can have mistakes.") }); }
      if (canAttach) { const fd = new FormData(); fd.append("files", small); const r = await addVisitFiles(visitId, fd); if (r.ok) router.refresh(); }
    } catch {
      setMsg({ tone: "attn", text: t("No se pudo leer la foto. Revisa tu conexión e intenta otra vez.", "Couldn't read the photo. Check your connection and try again.") });
    } finally { setBusy(null); }
  }

  async function aiDraft() {
    if (busy) return;
    setBusy("ai"); setMsg(null); setUnsure([]);
    try {
      const r = await draftVisitOutcome(visitId, notes);
      if (!r.ok) {
        const e: Record<string, string> = {
          CORTO: t("Escribe o dicta primero unas notas (o adjunta una foto) para que la IA tenga de dónde partir.", "Write or dictate some notes first (or attach a photo) so the AI has something to work from."),
          OFF: t("La IA está apagada.", "The AI is off."), CAP: t("Se alcanzó el límite mensual de IA. Vuelve el próximo mes o completa a mano.", "The monthly AI limit was reached. It's back next month, or fill it in by hand."),
          RATE: t("La IA está ocupada. Intenta en un minuto.", "The AI is busy. Try again in a minute."), REFUSED: t("La IA no quiso procesar estas notas. Complétalo a mano.", "The AI declined to process these notes. Fill it in by hand."),
          AUTH: t("La clave de IA no es válida. Avísale al administrador.", "The AI key isn't valid. Tell the admin."),
        };
        setMsg({ tone: "attn", text: e[r.error] ?? t("No se pudo preparar el borrador. Intenta otra vez.", "Couldn't prepare the draft. Try again.") });
        return;
      }
      const d = r.draft; const f = form.current!;
      const set = (name: string, v: string) => { const el = f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null; if (el) el.value = v; };
      setNotes(d.learned);
      for (let k = 0; k < 4; k++) { const c = d.commitments[k]; set(`side_${k}`, c?.side ?? (k % 2 ? "CUSTOMER" : "US")); set(`what_${k}`, c?.what ?? ""); set(`due_${k}`, c?.due ?? ""); }
      if (d.need) { setNeedOpen(true); setTimeout(() => { set("needTitle", d.need!.title); set("needResult", d.need!.result); }, 0); }
      set("nextMove", d.nextMove ?? ""); set("nextMoveDate", d.nextMoveDate ?? ""); set("valueKind", d.valueKind ?? "");
      setUnsure(d.unsure);
      setMsg({ tone: "okn", text: t("Borrador de la IA en el formulario. Nada se ha guardado: revisa cada campo, corrige lo que haga falta y luego cierra la visita.", "AI draft is in the form. Nothing is saved yet: review each field, fix what's needed, then close the visit.") });
    } catch {
      setMsg({ tone: "attn", text: t("No se pudo preparar el borrador. Intenta otra vez.", "Couldn't prepare the draft. Try again.") });
    } finally { setBusy(null); }
  }

  return (
    <form ref={form} action={recordOutcome.bind(null, visitId)} className="qa-form">
      <div className="qa-row"><label>{t("Fecha en que ocurrió", "Date it happened")}<input name="happenedAt" type="date" defaultValue={defaultDate} /></label></div>
      <label>{t("¿Qué aprendiste?", "What did you learn?")}
        <textarea name="learned" rows={5} required maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Escribe, dicta o lee una foto. Pueden ser notas sueltas.", "Type, dictate or read a photo. Loose notes are fine.")} />
      </label>
      <div className="qa-row vo-tools">
        <button type="button" className={`secondary${listening ? " on" : ""}`} onClick={dictate} aria-pressed={listening}>{listening ? t("● Escuchando… tocar para parar", "● Listening… tap to stop") : t("Dictar", "Dictate")}</button>
        <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readPhoto(f); e.target.value = ""; }} />
        <button type="button" className="secondary" onClick={() => photo.current?.click()} disabled={!!busy}>{busy === "ocr" ? (progress == null ? t("Preparando el lector…", "Preparing the reader…") : t(`Leyendo la foto… ${progress}%`, `Reading the photo… ${progress}%`)) : t("Leer texto de una foto", "Read text from a photo")}</button>
        {aiState === "ON" && <button type="button" className="secondary" onClick={aiDraft} disabled={!!busy}>{busy === "ai" ? t("Preparando el borrador…", "Preparing the draft…") : t("Borrador con IA", "AI draft")}</button>}
      </div>
      <span className="src block">
        {t("Dictar y leer fotos son gratis y ocurren en tu navegador; el audio no se guarda.", "Dictating and reading photos are free and happen in your browser; audio isn't saved.")}{" "}
        {aiState === "ON" ? t("El borrador con IA solo llena el formulario: tú lo revisas antes de guardar.", "The AI draft only fills the form: you review it before saving.") : aiState === "CAP" ? t("El borrador con IA está en pausa: se usó el límite mensual.", "The AI draft is paused: the monthly limit is used up.") : t("El borrador con IA está apagado hasta que la empresa active una clave de IA.", "The AI draft is off until the company turns on an AI key.")}
      </span>
      {msg && <p className={`note ${msg.tone}`} role="status">{msg.text}</p>}
      {unsure.length > 0 && <div className="note attn"><b>{t("La IA no está segura de:", "The AI isn't sure about:")}</b><ul className="mk-ul small">{unsure.map((u, k) => <li key={k}>{u}</li>)}</ul></div>}
      {objectives.length > 0 && <div className="qa-row" style={{ flexWrap: "wrap" }}>{objectives.map((o, k) => <label key={k} className="chk"><input type="checkbox" name={`met_${k}`} value="1" /> {t("Logrado", "Met")}: {o}</label>)}</div>}
      <label>{t("¿Qué dejó este contacto?", "What did this contact leave?")}
        <select name="valueKind" defaultValue=""><option value="">{t("Nada útil todavía (sin respuesta, intento)", "Nothing useful yet (no answer, attempt)")}</option>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
      </label>
      <b className="small">{t("Compromisos (de los dos lados)", "Commitments (both sides)")}</b>
      {[0, 1, 2, 3].map((k) => (
        <div key={k} className="qa-row">
          <select name={`side_${k}`} defaultValue={k % 2 ? "CUSTOMER" : "US"} style={{ flex: "0 0 120px" }} aria-label={t("Quién", "Who")}><option value="US">{t("Nosotros", "Us")}</option><option value="CUSTOMER">{t("Cliente", "Customer")}</option></select>
          <input name={`what_${k}`} maxLength={300} style={{ flex: "1 1 200px" }} placeholder={t("Qué se comprometió", "What was committed")} aria-label={t("Compromiso", "Commitment")} />
          <input name={`due_${k}`} type="date" aria-label={t("Para cuándo", "By when")} />
        </div>
      ))}
      <details open={needOpen} onToggle={(e) => setNeedOpen((e.target as HTMLDetailsElement).open)}><summary className="small">{t("¿Apareció una necesidad nueva?", "Did a new need come up?")}</summary>
        <label>{t("Nombre corto", "Short name")}<input name="needTitle" maxLength={200} placeholder={t("Ej.: Variadores para la línea 3", "E.g.: Drives for line 3")} /></label>
        <label>{t("Resultado que busca el cliente", "Result the customer is after")}<input name="needResult" maxLength={600} /></label>
        <span className="src block">{t("Se crea como Journey a tu nombre solo si lo dejas escrito aquí.", "It's created as a Journey in your name only if you leave it written here.")}</span>
      </details>
      <div className="qa-row">
        <label>{t("Próximo paso", "Next step")}<input name="nextMove" maxLength={300} /></label>
        <label style={{ flex: "0 0 auto" }}>{t("Fecha", "Date")}<input name="nextMoveDate" type="date" /></label>
      </div>
      <button type="submit">{t("Cerrar la visita", "Close the visit")}</button>
    </form>
  );
}

/** Photos and documents of a visit: photos are shrunk here before uploading. */
export function VisitFilesAdd({ visitId, lang, room }: { visitId: string; lang: "ES" | "EN"; room: number }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function upload(list: FileList) {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      for (const f of [...list].slice(0, room)) fd.append("files", await shrinkPhoto(f));
      const r = await addVisitFiles(visitId, fd);
      if (!r.ok) setMsg(({ LLENO: t("Esta visita ya tiene el máximo de archivos.", "This visit already has the maximum number of files."), NADA: t("Usa fotos (JPG, PNG, WEBP) o PDF de hasta 5 MB.", "Use photos (JPG, PNG, WEBP) or PDFs up to 5 MB."), PERMISO: t("No tienes permiso para adjuntar aquí.", "You don't have permission to attach here."), CERRADA: t("La visita está cancelada.", "The visit is cancelled.") })[r.error]);
      else { if (r.skipped > 0 || list.length > room) setMsg(t("Algunos archivos no se guardaron (tipo, tamaño o límite por visita).", "Some files weren't saved (type, size or per-visit limit).")); router.refresh(); }
    } catch { setMsg(t("No se pudo subir. Intenta otra vez.", "Couldn't upload. Try again.")); } finally { setBusy(false); }
  }
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
      <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy || room <= 0}>{busy ? t("Subiendo…", "Uploading…") : t("+ Foto o documento", "+ Photo or document")}</button>
      {msg && <p className="note attn" role="status">{msg}</p>}
    </>
  );
}
