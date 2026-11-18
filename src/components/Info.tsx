"use client";

import { useState } from "react";

// The small "i" next to a field's name: says in plain words what to write there, with an example.
// It opens on hover and on click (a click also works on a phone); it never moves the cursor out of the field.
export function Info({ text, example, lang }: { text: string; example?: string; lang: "ES" | "EN" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`inf-w${open ? " open" : ""}`}>
      <button
        type="button" className="inf" aria-expanded={open}
        aria-label={lang === "EN" ? "What do I write here?" : "¿Qué escribo aquí?"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onBlur={() => setOpen(false)}
      >i</button>
      <span className="inf-pop" role="note">
        {text}
        {example && <span className="inf-ex"><b>{lang === "EN" ? "Example: " : "Ejemplo: "}</b>{example}</span>}
      </span>
    </span>
  );
}
