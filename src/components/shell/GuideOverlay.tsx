"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Guide, GuideStage } from "@/lib/guide";
import { IconClose } from "./Icons";

// The on-screen guide: a small panel that stays while the person moves through SOLU, with the steps of
// the Guía de campo, and rings drawn around the things each step names (a tab, a button, a menu entry).
// It never clicks for the person and never blocks the screen: the person does the work, the guide points.

/** Start a guide from anywhere (search bar, search page, Ask panel). `route` = the whole way from the first need. */
export function startGuide(id: string, route: boolean) {
  window.dispatchEvent(new CustomEvent("solu:guide", { detail: { id, route } }));
}

type Saved = { guide: Guide; si: number; pi: number; min: boolean };
type Ring = { key: string; x: number; y: number; w: number; h: number; kind: "step" | "way"; n?: number };
const KEY = "solu.guide";

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]+/g, " ").trim();
/** What a step names: its buttons ([[Button]]) and anything it quotes ("Nuevo Journey"). */
const labelsOf = (step: string) => [...[...step.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]), ...[...step.matchAll(/"([^"]{3,40})"/g)].map((m) => m[1])];
/** A stage that lives inside one Journey can be done from any page of that Journey. */
const insideJourney = (p: string) => /^\/(deals|cotizaciones|po|compras|logistica)\/[^/]+/.test(p);
const isHere = (st: GuideStage, p: string) => (st.href === null ? true : st.needsJourney ? insideJourney(p) : p === st.href || p.startsWith(st.href + "/"));

function StepText({ text }: { text: string }) {
  const parts = text.split(/\[\[(.+?)\]\]/g);
  return <>{parts.map((p, k) => (k % 2 ? <span className="g-ui" key={k}>{p}</span> : <span key={k}>{p}</span>))}</>;
}

export function GuideOverlay({ lang, path }: { lang: "ES" | "EN"; path: string }) {
  const t = (a: string, b: string) => (lang === "ES" ? a : b);
  const router = useRouter();
  const [s, setS] = useState<Saved | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [missing, setMissing] = useState(false);
  const scrolled = useRef("");

  // The guide survives moving between screens and a reload; it ends when the person closes it.
  useEffect(() => {
    try { const raw = sessionStorage.getItem(KEY); if (raw) setS(JSON.parse(raw)); } catch {}
  }, []);
  const save = useCallback((next: Saved | null) => {
    setS(next);
    try { if (next) sessionStorage.setItem(KEY, JSON.stringify(next)); else sessionStorage.removeItem(KEY); } catch {}
  }, []);

  useEffect(() => {
    const onStart = async (e: Event) => {
      const { id, route } = (e as CustomEvent<{ id: string; route: boolean }>).detail;
      try {
        const r = await fetch(`/guia?id=${encodeURIComponent(id)}${route ? "&route=1" : ""}`, { cache: "no-store" });
        const { guide } = (await r.json()) as { guide: Guide | null };
        if (!guide) return;
        save({ guide, si: 0, pi: 0, min: false });
        const first = guide.stages[0];
        if (first.href && !first.locked && !isHere(first, window.location.pathname)) router.push(first.href);
      } catch {}
    };
    window.addEventListener("solu:guide", onStart);
    return () => window.removeEventListener("solu:guide", onStart);
  }, [router, save]);

  const stage = s?.guide.stages[s.si] ?? null;
  const step = stage?.steps[s!.pi] ?? null;
  const here = stage ? isHere(stage, path) : true;

  // Rings: look for what the current step names, on the screen as it is right now.
  useEffect(() => {
    if (!s || !stage || s.min) { setRings([]); setMissing(false); return; }
    // On another screen the step's buttons are not there yet: only the way is marked.
    const want = step && here ? labelsOf(step).map(plain).filter(Boolean) : [];
    const way = here ? [] : stage.way.map(plain).filter(Boolean);
    const stepKey = `${s.guide.id}/${s.si}/${s.pi}/${path}`;

    const compute = () => {
      const root = document.querySelector(".app");
      if (!root) return;
      const out: Ring[] = [];
      const vh = window.innerHeight, vw = window.innerWidth;
      const els = Array.from(root.querySelectorAll<HTMLElement>("a, button, summary, [role=tab], input[type=submit]")).filter((el) => !el.closest(".guide"));
      const seen = els.map((el) => {
        // A menu entry carries a counter next to its name: read the name alone.
        const raw = el instanceof HTMLInputElement ? el.value : (el.querySelector(".lbl") ?? el).textContent ?? "";
        return { el, text: raw.length > 90 ? "" : plain(raw).replace(/ \d+$/, "") };
      }).filter((x) => x.text);
      const boxOf = (target: HTMLElement, viaTitle = false) => {
        // A button inside a closed section cannot be seen: point at the title that opens the section.
        // Only for a button with a name of its own; a plain "Guardar" lives in too many sections.
        const closed = target.closest("details:not([open])");
        if (closed && !target.matches("summary") && !viaTitle) return null;
        const el = closed && !target.matches("summary") ? closed.querySelector<HTMLElement>(":scope > summary") ?? target : target;
        if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return null;
        const fixed = !!el.closest(".hdr, .side, .bottombar, .drawer");
        if (!fixed && r.top < 52) return null; // hidden under the top bar
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return { r, inView: false };
        return { r, inView: true };
      };
      let firstOff: HTMLElement | null = null, anyStep = false;
      want.forEach((label, li) => {
        let n = 0;
        for (const x of seen) {
          if (!(x.text === label || (x.text.startsWith(label + " ") && x.text.length <= label.length + 14))) continue;
          const b = boxOf(x.el, label.includes(" "));
          if (!b) continue;
          anyStep = true;
          if (!b.inView) { firstOff ??= x.el; continue; }
          if (out.some((o) => Math.abs(o.x - b.r.left) < 1 && Math.abs(o.y - b.r.top) < 1)) continue; // same section title twice
          if (n++ >= 4) break;
          out.push({ key: `s${li}-${n}`, x: b.r.left, y: b.r.top, w: b.r.width, h: b.r.height, kind: "step", n: s.pi + 1 });
        }
      });
      way.forEach((label, li) => {
        const x = seen.find((c) => c.text === label && !c.el.classList.contains("on") && !c.el.getAttribute("aria-current") && boxOf(c.el)?.inView);
        if (!x) return;
        const r = x.el.getBoundingClientRect();
        out.push({ key: `w${li}`, x: r.left, y: r.top, w: r.width, h: r.height, kind: "way" });
      });
      // The first time a step is shown, bring what it names into view.
      if (firstOff && !out.some((r) => r.kind === "step") && scrolled.current !== stepKey) {
        scrolled.current = stepKey;
        (firstOff as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
      }
      setMissing(here && want.length > 0 && !anyStep);
      setRings((prev) => (prev.length === out.length && prev.every((p, k) => p.key === out[k].key && Math.abs(p.x - out[k].x) < 1 && Math.abs(p.y - out[k].y) < 1 && Math.abs(p.w - out[k].w) < 1) ? prev : out));
    };
    compute();
    const id = window.setInterval(compute, 500);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => { window.clearInterval(id); window.removeEventListener("scroll", compute, true); window.removeEventListener("resize", compute); };
  }, [s, stage, step, here, path]);

  if (!s || !stage) return null;
  const { guide, si, pi } = s;
  const lastStage = si === guide.stages.length - 1;
  const lastStep = pi >= stage.steps.length - 1;
  const go = (nsi: number, npi: number) => save({ ...s, si: nsi, pi: npi });
  const next = () => (lastStep ? (lastStage ? save(null) : go(si + 1, 0)) : go(si, pi + 1));
  const back = () => (pi > 0 ? go(si, pi - 1) : si > 0 ? go(si - 1, Math.max(0, guide.stages[si - 1].steps.length - 1)) : undefined);
  const target = stage.way[stage.way.length - 1] ?? stage.title;

  if (s.min) {
    return (
      <button type="button" className="guide guide-min" onClick={() => save({ ...s, min: false })} aria-label={t("Abrir la guía", "Open the guide")}>
        <span className="g-compass" aria-hidden>➜</span>
        <span>{t("Guía", "Guide")}: {stage.title}</span>
        {guide.stages.length > 1 && <b>{si + 1}/{guide.stages.length}</b>}
      </button>
    );
  }

  return (
    <>
      <div className="guide-rings" aria-hidden>
        {rings.map((r) => (
          <i key={r.key} className={`g-ring ${r.kind}`} style={{ left: r.x - 5, top: r.y - 5, width: r.w + 10, height: r.h + 10 }}>
            {r.kind === "step" && <b>{r.n}</b>}
          </i>
        ))}
      </div>
      <aside className="guide guide-panel" role="complementary" aria-label={t("Guía en pantalla", "On-screen guide")} data-mod={stage.mod ?? undefined}>
        <header className="g-head">
          <span className="g-compass" aria-hidden>➜</span>
          <div className="g-title">
            <small>{guide.route ? t("Guía · el camino completo", "Guide · the whole way") : t("Guía paso a paso", "Step-by-step guide")}</small>
            <b>{guide.route ? t(`Hasta: ${guide.title}`, `Up to: ${guide.title}`) : guide.title}</b>
          </div>
          <button type="button" className="ibtn" onClick={() => save({ ...s, min: true })} aria-label={t("Minimizar", "Minimise")} title={t("Minimizar", "Minimise")}>–</button>
          <button type="button" className="ibtn" onClick={() => save(null)} aria-label={t("Cerrar la guía", "Close the guide")} title={t("Cerrar la guía", "Close the guide")}><IconClose /></button>
        </header>

        {guide.stages.length > 1 && (
          <ol className="g-stages" aria-label={t("Etapas", "Stages")}>
            {guide.stages.map((st, k) => (
              <li key={st.id}>
                <button type="button" className={k === si ? "on" : k < si ? "done" : undefined} onClick={() => go(k, 0)} title={st.title} aria-current={k === si ? "step" : undefined}>
                  {k < si ? "✓" : k + 1}
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="g-body">
          <div className="g-stage">
            {guide.stages.length > 1 && <small>{t(`Etapa ${si + 1} de ${guide.stages.length}`, `Stage ${si + 1} of ${guide.stages.length}`)}</small>}
            <b>{stage.title}</b>
            <span className="g-path">{stage.path}</span>
            <p>{stage.why}</p>
          </div>
          {guide.route && si === 0 && (
            <p className="g-tip">{t("Si tu caso ya va adelantado, toca el número de su etapa arriba y sigue desde ahí.", "If your case is already further along, tap its stage number above and continue from there.")}</p>
          )}

          {stage.locked ? (
            <p className="g-where">{t("Tu rol no abre esta pantalla: esta parte la hace otra persona. Puedes leer los pasos para saber qué pedir.", "Your role does not open this screen: someone else does this part. You can read the steps to know what to ask for.")}</p>
          ) : !here && (
            <div className="g-where">
              {stage.needsJourney ? (
                path === "/deals"
                  ? <p>{t("Esta etapa se hace dentro de un Journey. Haz clic en el título de la tarjeta del Journey que quieres avanzar.", "This stage happens inside a Journey. Click the title of the card of the Journey you want to move.")}</p>
                  : <><p>{t("Esta etapa se hace dentro de un Journey. Abre el que quieres avanzar.", "This stage happens inside a Journey. Open the one you want to move.")}</p><button type="button" className="sm" onClick={() => router.push("/deals")}>{t("Llévame a Journeys", "Take me to Journeys")}</button></>
              ) : (
                <><p>{t("Esto está en otra pantalla. Sigue lo que está marcado con línea punteada, o:", "This is on another screen. Follow what is marked with a dashed line, or:")}</p><button type="button" className="sm" onClick={() => router.push(stage.href!)}>{t(`Llévame a ${target}`, `Take me to ${target}`)}</button></>
              )}
            </div>
          )}

          <ol className="g-steps">
            {stage.steps.map((st, k) => (
              <li key={k} className={k === pi ? "on" : k < pi ? "done" : undefined}>
                <button type="button" onClick={() => go(si, k)} aria-current={k === pi ? "step" : undefined}>
                  <i>{k < pi ? "✓" : k + 1}</i>
                  <span><StepText text={st} /></span>
                </button>
              </li>
            ))}
          </ol>
          {missing && <p className="g-miss">{t("No veo ese botón en esta pantalla todavía. Puede estar en otra pestaña, dentro de una sección cerrada, o aparecer después del paso anterior.", "I can't see that button on this screen yet. It may be on another tab, inside a closed section, or show up after the previous step.")}</p>}
          {lang === "EN" && <p className="g-miss">The guide text is in Spanish for now, and buttons are only marked when the screen is in Spanish.</p>}

          {lastStep && stage.expect && <p className="g-expect"><b>{t("Qué deberías ver", "What you should see")}</b>{stage.expect}</p>}
          {lastStep && stage.also.length > 0 && (
            <p className="g-also">{t("Los casos que ya llegaron aquí:", "Cases that already got here:")} {stage.also.map((a) => <button key={a.href} type="button" className="link" onClick={() => router.push(a.href)}>{a.label}</button>)}</p>
          )}
        </div>

        <footer className="g-foot">
          <button type="button" className="secondary sm" onClick={back} disabled={si === 0 && pi === 0}>{t("Anterior", "Back")}</button>
          <span className="grow" />
          <button type="button" className="sm" onClick={next}>
            {lastStep ? (lastStage ? t("Terminar", "Finish") : t("Siguiente etapa →", "Next stage →")) : t("Siguiente paso", "Next step")}
          </button>
        </footer>
      </aside>
    </>
  );
}
