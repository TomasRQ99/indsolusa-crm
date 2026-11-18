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
      if (!el || !el.hasAttribute("data-open-on-land")) return;
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
