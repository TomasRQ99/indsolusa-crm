"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

// Feedback while the server works: a thin bar at the top on navigation and on
// form submits, the clicked button shows "Guardando…" and can't be pressed twice,
// and forms with data-confirm ask before doing something that can't be undone.
export function PendingFeedback({ lang }: { lang: "ES" | "EN" }) {
  const path = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  // The bar is toggled on the DOM directly, never through React state: a React update
  // made while a server action is pending held back the action's result for seconds.
  const bar = useRef<HTMLDivElement>(null);
  const setBusy = (on: boolean) => {
    const el = bar.current;
    if (!el) return;
    el.classList.toggle("on", on);
    el.setAttribute("aria-hidden", String(!on));
  };
  const held = useRef<{ btn: HTMLButtonElement; text: string | null }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observer = useRef<MutationObserver | null>(null);

  const clear = () => {
    setBusy(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    observer.current?.disconnect();
    observer.current = null;
    for (const h of held.current) {
      if (!h.btn.isConnected) continue;
      h.btn.disabled = false;
      h.btn.removeAttribute("aria-busy");
      if (h.text !== null) h.btn.textContent = h.text;
    }
    held.current = [];
  };
  const clearRef = useRef(clear);
  clearRef.current = clear;

  // Any change of address means the new screen arrived.
  useEffect(() => {
    clearRef.current();
  }, [path, search]);

  useEffect(() => {
    const start = (ms: number) => {
      setBusy(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => clearRef.current(), ms);
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/documentos")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start(8000);
    };

    // Capture phase: runs before React, so a "Cancel" stops the action entirely.
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement)) return;
      const msg = form.getAttribute("data-confirm");
      if (msg && !window.confirm(msg)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (form.target === "_blank" || form.hasAttribute("data-no-pending")) return;
      const action = form.getAttribute("action") ?? "";
      if (action.startsWith("/api") || action.startsWith("/documentos")) return;
      const get = (form.getAttribute("method") || "get").toLowerCase() === "get" && !action.startsWith("javascript:");
      start(get ? 8000 : 10000);
      if (get) return;
      const btn = e.submitter instanceof HTMLButtonElement ? e.submitter : null;
      // Wait one tick so React still reads the button's name/value before it is disabled.
      setTimeout(() => {
        if (btn && btn.isConnected && !btn.disabled) {
          const simple = btn.children.length === 0;
          held.current.push({ btn, text: simple ? btn.textContent : null });
          btn.disabled = true;
          btn.setAttribute("aria-busy", "true");
          if (simple && (btn.textContent ?? "").trim().length > 2) btn.textContent = lang === "ES" ? "Guardando…" : "Saving…";
        }
        // When the page updates in place (no new address), the work is done.
        const main = document.querySelector("main") ?? document.body;
        observer.current?.disconnect();
        let first = true;
        observer.current = new MutationObserver((records) => {
          const real = records.some((r) => !held.current.some((h) => h.btn === r.target || h.btn.contains(r.target)));
          if (!real) return;
          if (first) {
            first = false;
            setTimeout(() => clearRef.current(), 120);
          }
        });
        observer.current.observe(main, { childList: true, subtree: true, characterData: true });
      }, 0);
    };

    // Capture phase: Next's <Link> cancels the native click before it bubbles to the document.
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [lang]);

  return <div ref={bar} className="topbar-progress" role="progressbar" aria-hidden="true" aria-label={lang === "ES" ? "Cargando" : "Loading"} />;
}
