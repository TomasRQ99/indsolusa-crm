"use client";

import { useEffect } from "react";

// When a link lands on a block (…#solucion, …#condiciones), open that block's edit form and put the cursor in its
// first empty field, so the person arrives at the place where they type, not at a closed "Editar" button.
export function OpenOnLand() {
  useEffect(() => {
    const land = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (!el.hasAttribute("data-open-on-land")) {
        // A field (or anything) inside a closed form: open the forms around it, bring it into view, cursor in it.
        const closed: HTMLDetailsElement[] = [];
        for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) closed.push(d as HTMLDetailsElement);
        if (!closed.length) return;
        closed.forEach((d) => { d.open = true; });
        setTimeout(() => {
          closed.forEach((d) => { d.open = true; });
          el.scrollIntoView({ block: "center" });
          el.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
        }, 120);
        return;
      }
      const d = el.querySelector<HTMLDetailsElement>("details");
      if (!d) return;
      d.open = true;
      // After the page's own handling of an opened pop-up (which focuses its first field), go to the first empty one.
      setTimeout(() => {
        const fields = [...d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=hidden]):not([type=checkbox]), textarea")];
        const f = fields.find((x) => !x.value) ?? fields[0];
        if (!d.matches(".qa")) (f ?? d).scrollIntoView({ block: "center" });
        f?.focus({ preventScroll: true });
      }, 80);
    };
    land();
    window.addEventListener("hashchange", land);
    return () => window.removeEventListener("hashchange", land);
  }, []);
  return null;
}
