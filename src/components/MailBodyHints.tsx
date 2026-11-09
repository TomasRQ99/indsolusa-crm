"use client";
// Template emails: live tone check from the Communication Policy while the person edits. Warnings only, never blocks.
import { useMemo, useState } from "react";
import { templateHints } from "@/lib/comm-policy";

export default function MailBodyHints({ original, tpl, ui }: { original: string; tpl: string; ui: "ES" | "EN" }) {
  const [text, setText] = useState(original);
  const hints = useMemo(() => (text === original ? [] : templateHints(text, original, tpl)), [text, original, tpl]);
  return (
    <>
      <textarea name="body" rows={18} value={text} onChange={(e) => setText(e.target.value)} className="mail-body" />
      {hints.length > 0 && (
        <div className="note attn">
          <b>{ui === "EN" ? "Before sending, worth a look (it won't stop the email):" : "Antes de enviar, vale la pena revisar (no impide el envío):"}</b>
          <ul className="mk-ul">{hints.map((h) => <li key={h.code} className="small">{ui === "EN" ? h.en : h.es}</li>)}</ul>
        </div>
      )}
    </>
  );
}
