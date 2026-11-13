"use client";

// Glossary bubbles. Every term of src/lib/glossary.ts found in the page gets a dotted underline and, once per
// block, a small "i" bubble; a click opens what the term means on THIS screen and in general.
// The page itself is never modified (React owns it): the underline is a CSS highlight over text ranges and the
// bubbles live in a fixed layer on top, repositioned as the page scrolls or changes.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GLOSS_RE, contextFor, termFor, type GlossCtx, type GlossTerm } from "@/lib/glossary";

type Hit = { range: Range; term: GlossTerm; el: Element };
type Bubble = { k: string; x: number; y: number; n: number };
type Open = { term: GlossTerm; ctx: GlossCtx | null; x: number; y: number };

const KEY = "solu.glosario.off";
const SKIP = "script,style,textarea,select,input,code,.mono,.gl-layer,.guide,.guide-rings,.guide-panel,.guide-min,.search-sug,[data-noglossary]";
const BLOCK = "section,article,table,details,form,.card,.ph,.sum,.mblock,.modhead";
const NO_TEXT_CLICK = "a,button,input,select,textarea,summary,label,[role=tab],.gl-layer,.guide,.guide-panel";
const MAX = 700;

export const glossaryOff = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export function setGlossaryOff(off: boolean) {
  try { if (off) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* private window: the choice lasts for this page only */ }
  window.dispatchEvent(new CustomEvent("solu:glosario", { detail: off }));
}

/** The on/off button shown on the glossary page. */
export function GlossarySwitch({ lang }: { lang: "es" | "en" }) {
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const [off, setOff] = useState(false);
  useEffect(() => {
    setOff(glossaryOff());
    const on = (e: Event) => setOff(!!(e as CustomEvent).detail);
    window.addEventListener("solu:glosario", on);
    return () => window.removeEventListener("solu:glosario", on);
  }, []);
  return (
    <button type="button" className="secondary sm" onClick={() => setGlossaryOff(!off)}>
      {off ? t("Mostrar los globos en las pantallas", "Show the bubbles on screens") : t("Ocultar los globos en las pantallas", "Hide the bubbles on screens")}
    </button>
  );
}

export function GlossaryLayer({ lang, path }: { lang: "es" | "en"; path: string }) {
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const hits = useRef<Hit[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [open, setOpen] = useState<Open | null>(null);
  const [off, setOff] = useState(false);
  const sig = useRef("");

  /** Where the bubbles go: the first visible mention of each term in each block. */
  const place = useCallback(() => {
    const seen = new Map<Element, Set<string>>();
    const root = document.getElementById("contenido");
    const out: Bubble[] = [];
    const top = 58, h = window.innerHeight, w = window.innerWidth;
    hits.current.forEach((hit, n) => {
      if (!hit.el.isConnected) return;
      const r = hit.range.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const block = hit.el.closest(BLOCK) ?? root ?? document.body;
      let set = seen.get(block);
      if (!set) seen.set(block, (set = new Set()));
      if (set.has(hit.term.id)) return;
      if (r.top < top || r.bottom > h || r.right < 0 || r.right > w - 4) return;
      // only where the word is really on screen: not hidden, not transparent, not covered by something else
      const vis = (hit.el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
      if (vis && !vis.call(hit.el, { checkOpacity: true, checkVisibilityCSS: true })) return;
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!at || !(at === hit.el || hit.el.contains(at))) return;
      // above the end of the word, so it never covers the words that follow
      set.add(hit.term.id);
      out.push({ k: `${hit.term.id}-${n}`, x: Math.round(r.right - 4), y: Math.round(r.top - 9), n });
    });
    const s = out.map((b) => `${b.k}:${b.x}:${b.y}`).join("|");
    if (s !== sig.current) { sig.current = s; setBubbles(out); }
  }, []);

  /** Find every term in the page text. */
  const scan = useCallback(() => {
    const root = document.getElementById("contenido");
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const found: Hit[] = [];
    if (root && !glossaryOff()) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node && found.length < MAX; node = walker.nextNode()) {
        const text = node.nodeValue ?? "", el = node.parentElement;
        if (text.length < 2 || !el || el.closest(SKIP)) continue;
        GLOSS_RE.lastIndex = 0;
        for (let m = GLOSS_RE.exec(text); m && found.length < MAX; m = GLOSS_RE.exec(text)) {
          const term = termFor(m[0], path);
          if (!term) continue;
          const range = document.createRange();
          range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          found.push({ range, term, el });
        }
      }
    }
    hits.current = found;
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (reg && H) { if (found.length) reg.set("gl-term", new H(...found.map((f) => f.range))); else reg.delete("gl-term"); }
    place();
  }, [path, place]);

  const show = useCallback((hit: Hit, x: number, y: number) => {
    const ctx = contextFor(hit.term, path, window.location.search, (sel) => { try { return !!hit.el.closest(sel); } catch { return false; } });
    const W = Math.min(340, window.innerWidth - 16);
    setOpen({ term: hit.term, ctx, x: Math.max(8, Math.min(x - 20, window.innerWidth - W - 8)), y: y + 14 });
  }, [path]);

  useEffect(() => {
    setOff(glossaryOff());
    const onOff = (e: Event) => { setOff(!!(e as CustomEvent).detail); setOpen(null); scan(); };
    window.addEventListener("solu:glosario", onOff);
    return () => window.removeEventListener("solu:glosario", onOff);
  }, [scan]);

  useEffect(() => {
    setOpen(null);
    const root = document.getElementById("contenido");
    let timer = 0, frame = 0;
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(scan, 250); };
    const move = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    later();
    const mo = root ? new MutationObserver(later) : null;
    mo?.observe(root!, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    document.addEventListener("toggle", move, true);
    const tick = window.setInterval(place, 900);
    return () => {
      mo?.disconnect(); window.clearTimeout(timer); cancelAnimationFrame(frame); window.clearInterval(tick);
      window.removeEventListener("scroll", move, true); window.removeEventListener("resize", move); document.removeEventListener("toggle", move, true);
      (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete("gl-term");
    };
  }, [scan, place]);

  // A click on the underlined word itself (when it is plain text, not a link or a button) opens it too.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest) return;
      if (target.closest(".gl-pop")) return;
      if (target.closest(NO_TEXT_CLICK)) { if (!target.closest(".gl-layer")) setOpen(null); return; }
      if (window.getSelection()?.toString()) return;
      for (const hit of hits.current) {
        if (!hit.el.contains(target) && hit.el !== target) continue;
        for (const r of hit.range.getClientRects()) {
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { show(hit, r.left + 20, r.bottom - 8); return; }
        }
      }
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, [show]);

  if (off) return null;
  const name = (x: GlossTerm) => (lang === "es" ? x.name.es : x.name.en);
  return (
    <div className="gl-layer">
      {bubbles.map((b) => {
        const hit = hits.current[b.n];
        if (!hit) return null;
        return (
          <button key={b.k} type="button" className="gl-b" style={{ left: b.x, top: b.y }} aria-label={t(`Qué significa ${name(hit.term)}`, `What ${name(hit.term)} means`)} title={t("Qué significa aquí", "What it means here")}
            onClick={(e) => { e.stopPropagation(); if (open?.term.id === hit.term.id) setOpen(null); else show(hit, b.x, b.y + 8); }}>i</button>
        );
      })}
      {open && (
        <div className="gl-pop" role="dialog" aria-label={name(open.term)} style={{ left: open.x, top: Math.min(open.y, Math.max(60, window.innerHeight - 260)) }}>
          <div className="gl-h"><b>{name(open.term)}</b><button type="button" className="gl-x" onClick={() => setOpen(null)} aria-label={t("Cerrar", "Close")}>×</button></div>
          {open.ctx && <p className="gl-here"><span>{t("En esta pantalla", "On this screen")}</span>{lang === "es" ? open.ctx.es : open.ctx.en}</p>}
          <p className="gl-gen">{open.ctx && <span>{t("En general", "In general")}</span>}{lang === "es" ? open.term.def.es : open.term.def.en}</p>
          <div className="gl-f">
            <Link href={`/glosario#${open.term.id}`} onClick={() => setOpen(null)}>{t("Ver el glosario completo", "See the full glossary")}</Link>
            <button type="button" className="gl-hide" onClick={() => setGlossaryOff(true)}>{t("Ocultar los globos", "Hide the bubbles")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
