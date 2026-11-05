"use client";

import { useEffect } from "react";

// Quick-action popovers are plain <details class="qa">. This keeps only one open at a time
// and closes it on an outside click or Esc.
export function Popovers() {
  useEffect(() => {
    const closeAll = (except?: Element | null) =>
      document.querySelectorAll<HTMLDetailsElement>("details.qa[open]").forEach((d) => {
        if (d !== except) d.open = false;
      });
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (d.matches?.("details.qa") && d.open) {
        closeAll(d);
        setTimeout(() => d.querySelector<HTMLElement>("input:not([type=hidden]), select, button[type=submit]")?.focus(), 0);
      }
    };
    const onClick = (e: MouseEvent) => {
      const inside = (e.target as Element).closest?.("details.qa");
      closeAll(inside);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAll();
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
