"use client";

// Nobody should type a form twice. While a person fills a form, what they type is kept in this browser tab;
// if the form comes back with an error (the page returns with ?err=…), the fields are filled again and the
// person only fixes what was wrong. Once the form is saved without an error, the copy is thrown away.
// Nothing leaves the browser: it lives in sessionStorage and ends with the tab. Passwords and files are never kept.

import { useEffect, useRef, useState } from "react";

type Draft = { path: string; at: number; v: Record<string, string | string[] | boolean> };
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const PRE = "solu.form:", SENT = "solu.form.sent", MAX_AGE = 2 * 60 * 60 * 1000, SENT_AGE = 3 * 60 * 1000;
const SKIP_TYPES = new Set(["password", "file", "hidden", "submit", "button", "reset", "image"]);
const SECRET = /pass|token|secret|clave|contrase/i;

const fields = (form: HTMLFormElement) =>
  ([...form.elements] as Field[]).filter((el) => el.name && !SKIP_TYPES.has((el as HTMLInputElement).type) && !SECRET.test(el.name) && !el.disabled);
/** The same form gives the same signature on every render: its field names, in order. */
const signature = (form: HTMLFormElement) => { const n = [...new Set(fields(form).map((f) => f.name))]; return n.length ? n.join("|") : ""; };
const keyOf = (path: string, sig: string) => PRE + path + "::" + sig;
const store = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* full or blocked: the form still works */ } }, del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* same */ } } };

function read(form: HTMLFormElement): Draft["v"] {
  const v: Draft["v"] = {};
  for (const el of fields(form)) {
    const i = el as HTMLInputElement;
    if (i.type === "checkbox") { if (form.querySelectorAll(`[name="${CSS.escape(el.name)}"]`).length > 1) { const a = (v[el.name] as string[] | undefined) ?? []; if (i.checked) a.push(i.value); v[el.name] = a; } else v[el.name] = i.checked; }
    else if (i.type === "radio") { if (i.checked) v[el.name] = i.value; }
    else if (el instanceof HTMLSelectElement && el.multiple) v[el.name] = [...el.selectedOptions].map((o) => o.value);
    else v[el.name] = el.value;
  }
  return v;
}

/** Set a value the way a person would, so React-controlled fields notice too. */
function setValue(el: Field, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fill the form again. Only fields the server sent back untouched are filled. Returns how many changed. */
function restore(form: HTMLFormElement, v: Draft["v"]) {
  let n = 0;
  for (const el of fields(form)) {
    if (!(el.name in v)) continue;
    const saved = v[el.name], i = el as HTMLInputElement;
    if (i.type === "checkbox") {
      const want = Array.isArray(saved) ? saved.includes(i.value) : saved === true;
      if (i.checked === i.defaultChecked && i.checked !== want) { i.click(); n++; }
    } else if (i.type === "radio") {
      if (saved === i.value && !i.checked && ![...form.querySelectorAll<HTMLInputElement>(`[name="${CSS.escape(el.name)}"]`)].some((r) => r.checked !== r.defaultChecked)) { i.click(); n++; }
    } else if (el instanceof HTMLSelectElement) {
      if (el.multiple || typeof saved !== "string") continue;
      const def = [...el.options].find((o) => o.defaultSelected)?.value ?? el.options[0]?.value ?? "";
      if (el.value === def && saved !== el.value && [...el.options].some((o) => o.value === saved)) { setValue(el, saved); n++; }
    } else if (typeof saved === "string" && el.value === (el as HTMLInputElement | HTMLTextAreaElement).defaultValue && saved !== el.value) { setValue(el, saved); n++; }
  }
  return n;
}

export function FormKeeper({ lang, path }: { lang: "es" | "en"; path: string }) {
  const [note, setNote] = useState<{ x: number; y: number; n: number } | null>(null);
  const href = useRef("");

  // keep what is being typed
  useEffect(() => {
    let timer = 0, pending: HTMLFormElement | null = null;
    const save = () => {
      const form = pending; pending = null;
      if (!form || !form.isConnected) return;
      const sig = signature(form); if (!sig) return;
      const d: Draft = { path, at: Date.now(), v: read(form) };
      store.set(keyOf(path, sig), JSON.stringify(d));
    };
    const usable = (form: HTMLFormElement | null | undefined): form is HTMLFormElement => !!form && !!form.closest("#contenido") && form.method !== "get" && !form.hasAttribute("data-nokeep");
    const onInput = (e: Event) => {
      const form = (e.target as Field | null)?.form;
      if (!e.isTrusted || !usable(form)) return;
      pending = form; window.clearTimeout(timer); timer = window.setTimeout(save, 300);
    };
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!usable(form)) return;
      pending = form; window.clearTimeout(timer); save();
      const sig = signature(form); if (sig) store.set(SENT, JSON.stringify({ key: keyOf(path, sig), path, at: Date.now() }));
    };
    document.addEventListener("input", onInput, true); document.addEventListener("change", onInput, true); document.addEventListener("submit", onSubmit, true);
    return () => { window.clearTimeout(timer); document.removeEventListener("input", onInput, true); document.removeEventListener("change", onInput, true); document.removeEventListener("submit", onSubmit, true); };
  }, [path]);

  // after each arrival: an error brings the typed values back; a clean arrival throws the copy away
  useEffect(() => {
    const tries: number[] = [];
    const arrive = () => {
      if (href.current === window.location.href) return;
      const first = href.current === "";
      href.current = window.location.href;
      tries.forEach((t) => window.clearTimeout(t)); tries.length = 0;
      // a link that ends in #something opens the closed section that holds it, so "+ Nuevo" lands on the form itself
      if (window.location.hash.length > 1) window.setTimeout(() => { try { const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); if (!el) return; const d = el instanceof HTMLDetailsElement ? el : el.querySelector("details"); for (let p: Element | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true; if (d && !d.open) d.open = true; el.scrollIntoView({ block: "start", behavior: "smooth" }); } catch { /* no such place */ } }, 350);
      let sent: { key: string; path: string; at: number } | null = null;
      try { sent = JSON.parse(store.get(SENT) ?? "null"); } catch { sent = null; }
      if (first || !sent || Date.now() - sent.at > SENT_AGE) return;
      const failed = [...new URLSearchParams(window.location.search).keys()].some((k) => /^err/i.test(k));
      if (!failed) { store.del(sent.key); store.del(SENT); return; }
      if (sent.path !== window.location.pathname) return;
      const key = sent.key;
      const attempt = (last: boolean) => {
        let d: Draft | null = null;
        try { d = JSON.parse(store.get(key) ?? "null"); } catch { d = null; }
        if (!d) return;
        const form = [...document.querySelectorAll<HTMLFormElement>("#contenido form")].find((f) => keyOf(window.location.pathname, signature(f)) === key);
        if (!form) { if (last) store.del(SENT); return; }
        tries.forEach((t) => window.clearTimeout(t)); tries.length = 0;
        store.del(SENT);
        for (let p = form.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;
        const n = restore(form, d.v);
        if (!n) return;
        const r = form.getBoundingClientRect();
        setNote({ x: Math.max(12, Math.min(r.left, window.innerWidth - 340)), y: Math.max(70, Math.min(r.top - 44, window.innerHeight - 80)), n });
        window.setTimeout(() => setNote(null), 7000);
      };
      tries.push(window.setTimeout(() => attempt(false), 250), window.setTimeout(() => attempt(false), 900), window.setTimeout(() => attempt(true), 2200));
    };
    arrive();
    const tick = window.setInterval(arrive, 350);
    // old copies do not pile up
    try { for (let k = sessionStorage.length - 1; k >= 0; k--) { const name = sessionStorage.key(k); if (!name?.startsWith(PRE)) continue; const d = JSON.parse(sessionStorage.getItem(name) ?? "null") as Draft | null; if (!d || Date.now() - d.at > MAX_AGE) sessionStorage.removeItem(name); } } catch { /* nothing to clean */ }
    return () => { window.clearInterval(tick); tries.forEach((t) => window.clearTimeout(t)); };
  }, []);

  if (!note) return null;
  return (
    <div className="fk-note" role="status" style={{ left: note.x, top: note.y }}>
      {lang === "es" ? "Recuperé lo que habías escrito. Corrige solo lo que marca el aviso y guarda de nuevo." : "I brought back what you had typed. Fix only what the notice says and save again."}
      <button type="button" onClick={() => setNote(null)} aria-label={lang === "es" ? "Cerrar" : "Close"}>×</button>
    </div>
  );
}
