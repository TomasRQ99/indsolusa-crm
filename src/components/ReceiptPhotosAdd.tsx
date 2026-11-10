"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrinkPhoto } from "@/components/VisitOutcomeForm";
import { addReceiptPhotos } from "@/app/(app)/compras/recepcion-actions";

/** Photos of received goods: shrunk here before uploading, so each takes little database space. */
export function ReceiptPhotosAdd({ receiptId, lang, room }: { receiptId: string; lang: "ES" | "EN"; room: number }) {
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
      const r = await addReceiptPhotos(receiptId, fd);
      if (!r.ok) setMsg(r.error === "LLENO" ? t("Esta recepción ya tiene el máximo de fotos.", "This receipt already has the maximum number of photos.") : r.error === "NADA" ? t("Usa fotos JPG, PNG o WEBP.", "Use JPG, PNG or WEBP photos.") : t("No tienes permiso para adjuntar aquí.", "You don't have permission to attach here."));
      else router.refresh();
    } catch { setMsg(t("No se pudo subir. Intenta otra vez.", "Couldn't upload. Try again.")); } finally { setBusy(false); }
  }
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
      <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy || room <= 0}>{busy ? t("Subiendo…", "Uploading…") : t("+ Fotos (empaque, placa, serial, daños)", "+ Photos (packaging, nameplate, serial, damage)")}</button>
      {msg && <p className="note attn" role="status">{msg}</p>}
    </>
  );
}
