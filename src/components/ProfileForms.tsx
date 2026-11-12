"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrinkPhoto } from "@/components/VisitOutcomeForm";
import { addProfileItem } from "@/app/(app)/comercial/perfiles/actions";
import { DIARY_FIELDS, DIARY_ISSUE_TEXT, DIARY_MAX, ECSA, ITEM_KINDS, MAX_ITEM_FILE_BYTES, diaryIssue, type DiaryIssue, type DiaryKey } from "@/lib/profile-rules";

// Comercial · Perfiles: the two forms that need the browser. The diary entry is checked here before it is sent, so
// nobody loses what they wrote over a missing date; the server checks it again with the same rule.

type Opt = { id: string; label: string };

export function DiaryForm({ es, action, todayInput, contacts, meetings }: {
  es: boolean;
  action: (fd: FormData) => void | Promise<void>;
  todayInput: string;
  contacts: Opt[];
  /** Conversations SOLU already has for this customer; `used` = already in the diary. */
  meetings: (Opt & { used: boolean })[];
}) {
  const t = (a: string, b: string) => (es ? a : b);
  const [meeting, setMeeting] = useState("");
  const [issue, setIssue] = useState<DiaryIssue | null>(null);
  const existing = meeting.startsWith("act:");

  function check(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "");
    const text = Object.fromEntries(DIARY_FIELDS.map((f) => [f.key, s(f.key)])) as Record<DiaryKey, string>;
    const found = diaryIssue({ ...text, meeting: s("meeting"), happenedOn: s("happenedOn") || todayInput, followUp: s("followUp"), followUpOn: s("followUpOn"), today: todayInput });
    setIssue(found);
    if (found) e.preventDefault();
  }
  const field = (f: (typeof DIARY_FIELDS)[number]) => (
    <label key={f.key} className="pf-q">
      <b>{t(f.label.es, f.label.en)}</b>
      <span>{t(f.ask.es, f.ask.en)}</span>
      <textarea name={f.key} rows={f.key === "notes" ? 3 : 2} maxLength={DIARY_MAX} placeholder={t(f.ph.es, f.ph.en)} />
    </label>
  );

  return (
    <form action={action} onSubmit={check} className="qa-form pf-form">
      <div className="pf-row">
        <label>{t("¿De qué conversación sale?", "Which conversation is this from?")}
          <select name="meeting" value={meeting} onChange={(e) => setMeeting(e.target.value)} required>
            <option value="" disabled>{t("Elige una…", "Choose one…")}</option>
            <optgroup label={t("Registrar una nueva", "Register a new one")}>
              <option value="new:CALL">{t("Llamada nueva", "New call")}</option>
              <option value="new:VIDEO">{t("Videollamada nueva", "New video call")}</option>
              <option value="new:MEETING">{t("Visita nueva", "New visit")}</option>
            </optgroup>
            {meetings.length > 0 && (
              <optgroup label={t("Ya registradas en SOLU", "Already recorded in SOLU")}>
                {meetings.map((m) => <option key={m.id} value={`act:${m.id}`}>{m.label}{m.used ? t(" · ya en el diario", " · already in the diary") : ""}</option>)}
              </optgroup>
            )}
            <optgroup label={t("Otra cosa", "Something else")}>
              <option value="none">{t("Ninguna: es solo una nota", "None: it is only a note")}</option>
            </optgroup>
          </select>
        </label>
        {!existing && <label>{t("Fecha", "Date")}<input name="happenedOn" type="date" defaultValue={todayInput} max={todayInput} /></label>}
        {contacts.length > 0 && (
          <label>{t("Con quién (opcional)", "With whom (optional)")}
            <select name="contactId" defaultValue=""><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
        )}
        <label>{t("Momento ECSA (opcional)", "ECSA moment (optional)")}
          <select name="ecsa" defaultValue=""><option value="">—</option>{Object.entries(ECSA).map(([k, v]) => <option key={k} value={k}>{t(`${v.es}: ${v.hint.es}`, `${v.en}: ${v.hint.en}`)}</option>)}</select>
        </label>
      </div>
      {existing && <span className="src">{t("Se usa la fecha de esa conversación. No hay que registrarla otra vez.", "That conversation's date is used. There is no need to register it again.")}</span>}
      {meeting.startsWith("new:") && <span className="src">{t("La conversación queda también en la historia del cliente y cuenta en la Línea de comunicaciones.", "The conversation is also saved in the customer's history and counts in the Communication line.")}</span>}

      <div className="pf-qs">{DIARY_FIELDS.filter((f) => !f.more && f.key !== "notes").map(field)}</div>
      <details className="pf-more">
        <summary>{t("Presupuesto, decisión y acuerdo", "Budget, decision and agreement")}</summary>
        <div className="pf-qs">{DIARY_FIELDS.filter((f) => f.more).map(field)}</div>
      </details>
      {field(DIARY_FIELDS.find((f) => f.key === "notes")!)}

      <fieldset className="pf-plan">
        <legend>{t("Plan de seguimiento", "Follow-up plan")}</legend>
        <div className="pf-row">
          <label className="grow">{t("¿Qué vas a hacer después? (opcional)", "What will you do next? (optional)")}<input name="followUp" maxLength={300} placeholder={t("Ej.: Llamarlo con las dos opciones de variador", "E.g.: Call with the two drive options")} /></label>
          <label>{t("¿Cuándo?", "When?")}<input name="followUpOn" type="date" min={todayInput} /></label>
        </div>
        <span className="src">{t("Queda como un pendiente tuyo con esa fecha, en Mi Día.", "It becomes one of your to-dos on that date, in My Day.")}</span>
      </fieldset>

      {issue && <p className="note attn" role="alert">{t(DIARY_ISSUE_TEXT[issue].es, DIARY_ISSUE_TEXT[issue].en)}</p>}
      <div><button type="submit">{t("Guardar en el diario", "Save to the diary")}</button></div>
    </form>
  );
}

/** A document, a product they may need or a brand they use: a name, and optionally a photo or PDF, a link and a note. */
export function ProfileItemAdd({ es, accountId, kind, room }: { es: boolean; accountId: string; kind: keyof typeof ITEM_KINDS; room: number }) {
  const t = (a: string, b: string) => (es ? a : b);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const k = ITEM_KINDS[kind];
  const isDoc = kind === "DOCUMENT";
  const ERR: Record<string, string> = {
    CLIENTE: t("Ese cliente no existe.", "That customer doesn't exist."),
    TITULO: t("Falta el nombre.", "The name is missing."),
    ENLACE: t("Ese enlace no parece una dirección web. Ejemplo: https://www.sew-eurodrive.com", "That link doesn't look like a web address. Example: https://www.sew-eurodrive.com"),
    ARCHIVO: t("Usa una foto (JPG, PNG, WEBP) o un PDF de hasta 5 MB.", "Use a photo (JPG, PNG, WEBP) or a PDF up to 5 MB."),
    FALTA: t("Un documento necesita el archivo o un enlace.", "A document needs the file or a link."),
    LLENO: t("Este perfil ya tiene el máximo de archivos. Puedes guardar un enlace, o quitar un archivo que ya no sirva.", "This profile already has the maximum number of files. You can save a link, or remove a file that is no longer useful."),
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(e.currentTarget);
      const f = fd.get("file");
      if (f instanceof File && f.size > 0) {
        const small = await shrinkPhoto(f);
        if (small.size > MAX_ITEM_FILE_BYTES) { setMsg(ERR.ARCHIVO); return; }
        fd.set("file", small);
      } else fd.delete("file");
      const r = await addProfileItem(accountId, fd);
      if (!r.ok) setMsg(ERR[r.error]);
      else { form.current?.reset(); router.refresh(); }
    } catch { setMsg(t("No se pudo guardar. Intenta otra vez.", "Couldn't save. Try again.")); } finally { setBusy(false); }
  }

  return (
    <details className="pf-add">
      <summary className="qa-btn">+ {t(k.add.es, k.add.en)}</summary>
      <form ref={form} onSubmit={submit} className="qa-form pf-form">
        <input type="hidden" name="kind" value={kind} />
        <label>{t(k.title.es, k.title.en)}<input name="title" maxLength={160} required={!isDoc} placeholder={t(k.ph.es, k.ph.en)} /></label>
        <label>{isDoc ? t("Archivo (foto o PDF)", "File (photo or PDF)") : t("Foto (opcional)", "Photo (optional)")}
          <input name="file" type="file" accept={isDoc ? "image/jpeg,image/png,image/webp,application/pdf" : "image/jpeg,image/png,image/webp"} disabled={room <= 0} />
        </label>
        <label>{t("Enlace (opcional)", "Link (optional)")}<input name="url" inputMode="url" maxLength={500} placeholder="https://" /></label>
        <label>{t("Nota (opcional)", "Note (optional)")}<input name="note" maxLength={500} placeholder={kind === "BRAND_USED" ? t("Ej.: En toda la línea de empaque", "E.g.: Across the packaging line") : kind === "PRODUCT_NEED" ? t("Ej.: Lo pidió para la parada de enero", "E.g.: Asked for it for the January shutdown") : t("Ej.: Nos lo entregó en la visita", "E.g.: Handed to us during the visit")} /></label>
        {room <= 0 && <span className="src">{ERR.LLENO}</span>}
        {msg && <p className="note attn" role="alert">{msg}</p>}
        <div><button type="submit" disabled={busy}>{busy ? t("Guardando…", "Saving…") : t("Guardar", "Save")}</button></div>
      </form>
    </details>
  );
}
