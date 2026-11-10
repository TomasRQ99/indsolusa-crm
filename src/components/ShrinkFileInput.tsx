"use client";

import { useState } from "react";
import { shrinkPhoto } from "@/components/VisitOutcomeForm";

/** A file input that shrinks a photo in the browser before the form sends it (phone photos are several MB). */
export function ShrinkFileInput({ name, accept, lang }: { name: string; accept: string; lang: "ES" | "EN" }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        name={name} type="file" accept={accept} aria-busy={busy}
        onChange={async (e) => {
          const el = e.currentTarget; const f = el.files?.[0];
          if (!f || !f.type.startsWith("image/")) return;
          setBusy(true);
          try { const small = await shrinkPhoto(f); if (small !== f) { const dt = new DataTransfer(); dt.items.add(small); el.files = dt.files; } } catch { /* keep the original */ } finally { setBusy(false); }
        }}
      />
      {busy && <span className="src">{lang === "EN" ? "Preparing the photo…" : "Preparando la foto…"}</span>}
    </>
  );
}
