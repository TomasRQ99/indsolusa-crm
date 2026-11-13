"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Guide } from "@/lib/guide";
import type { CaseStage, GuideCase, GuideExample } from "@/lib/guide-case";
import { IconClose } from "./Icons";

// The on-screen guide: a small panel that stays while the person moves through SOLU, with the steps of
// the Guía de campo, and rings drawn around the things each step names (a tab, a button, a menu entry).
// It never clicks for the person and never blocks the screen: the person does the work, the guide points.
//
// Since 2026-11-13 it follows the Necesidad (the case) the person has open: each stage knows the exact page of
// THAT case, says what the case still needs before a stage, and says why a button is not on screen (a closed
// section, a list with open points) instead of asking for something that is not there.
// A new person can also practise on a sample case instead of creating one.

/** Start a guide from anywhere (search bar, search page, Ask panel). `route` = the whole way from the first need. */
export function startGuide(id: string, route: boolean) {
  window.dispatchEvent(new CustomEvent("solu:guide", { detail: { id, route } }));
}

type Saved = { guide: Guide; si: number; pi: number; min: boolean; caseId?: string | null };
type Ring = { key: string; x: number; y: number; w: number; h: number; kind: "step" | "way" | "see"; n?: number };
const KEY = "solu.guide";

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]+/g, " ").trim();
/** What a step names: its buttons ([[Button]]) and anything it quotes ("Nuevo Journey"). */
const labelsOf = (step: string) => [...[...step.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]), ...[...step.matchAll(/"([^"]{3,40})"/g)].map((m) => m[1])];
/** A stage that lives inside one case can be done from any page of that case (when SOLU cannot tell which). */
const insideJourney = (p: string) => /^\/(deals|cotizaciones|po|compras|logistica)\/[^/]+/.test(p);
const samePage = (href: string, p: string) => href.split(/[?#]/)[0] === p;

function StepText({ text }: { text: string }) {
  const parts = text.split(/\[\[(.+?)\]\]/g);
  return <>{parts.map((p, k) => (k % 2 ? <span className="g-ui" key={k}>{p}</span> : <span key={k}>{p}</span>))}</>;
}

export function GuideOverlay({ lang, path }: { lang: "ES" | "EN"; path: string }) {
  const t = (a: string, b: string) => (lang === "ES" ? a : b);
  const router = useRouter();
  const [s, setS] = useState<Saved | null>(null);
  const [kase, setKase] = useState<GuideCase | null>(null);
  const [examples, setExamples] = useState<GuideExample[] | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [missing, setMissing] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [left, setLeft] = useState(false);
  const [loc, setLoc] = useState("");
  const scrolled = useRef("");
  const panel = useRef<HTMLElement | null>(null);
  const sRef = useRef<Saved | null>(null);

  // The guide survives moving between screens and a reload; it ends when the person closes it.
  useEffect(() => {
    try { const raw = sessionStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); sRef.current = v; setS(v); } } catch {}
  }, []);
  const save = useCallback((next: Saved | null) => {
    sRef.current = next;
    setS(next);
    if (!next) { setKase(null); setExamples(null); }
    try { if (next) sessionStorage.setItem(KEY, JSON.stringify(next)); else sessionStorage.removeItem(KEY); } catch {}
  }, []);

  useEffect(() => {
    const onStart = async (e: Event) => {
      const { id, route } = (e as CustomEvent<{ id: string; route: boolean }>).detail;
      try {
        const r = await fetch(`/guia?id=${encodeURIComponent(id)}${route ? "&route=1" : ""}`, { cache: "no-store" });
        const { guide } = (await r.json()) as { guide: Guide | null };
        if (!guide) return;
        setKase(null); setExamples(null);
        save({ guide, si: 0, pi: 0, min: false, caseId: null });
        const first = guide.stages[0];
        // A stage inside a case starts from the case the person already has open, if there is one.
        const stay = first.href === null || (first.needsJourney ? insideJourney(window.location.pathname) : samePage(first.href, window.location.pathname));
        if (first.href && !first.locked && !stay) router.push(first.href);
      } catch {}
    };
    window.addEventListener("solu:guide", onStart);
    return () => window.removeEventListener("solu:guide", onStart);
  }, [router, save]);

  const guideId = s ? `${s.guide.id}/${s.guide.route ? 1 : 0}` : "";
  const wantsCase = !!s && s.guide.stages.some((st) => st.needsJourney);
  const isOpen = !!s && !s.min;

  // The address as it is now (a saved form comes back to the same page with another query): it tells when to look again.
  useEffect(() => {
    if (!isOpen) return;
    const tick = () => setLoc(window.location.pathname + window.location.search);
    tick();
    const id = window.setInterval(tick, 600);
    return () => window.clearInterval(id);
  }, [isOpen, path]);

  // Where the case on screen is. Asked again after every move, and every few seconds while the panel is open,
  // so the guide notices what the person just did (a quote presented, a PO accepted).
  useEffect(() => {
    if (!wantsCase || !isOpen) return;
    let off = false;
    const ask = async () => {
      const cur = sRef.current;
      if (!cur || cur.min || document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/guia?case=${encodeURIComponent(window.location.pathname)}${cur.caseId ? `&deal=${encodeURIComponent(cur.caseId)}` : ""}`, { cache: "no-store" });
        const { case: c } = (await r.json()) as { case: GuideCase | null };
        if (off) return;
        setKase((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c));
        const now = sRef.current;
        if (!now || !c || now.caseId === c.id) return;
        // A case was just opened. On the board stage of the whole route, go straight to where that case is.
        const k = now.guide.route && now.si === 0 && c.current ? now.guide.stages.findIndex((st) => st.id === c.current) : -1;
        if (k > 0) save({ ...now, caseId: c.id, si: k, pi: Math.min(c.stages[c.current!]?.startStep ?? 0, now.guide.stages[k].steps.length - 1) });
        else {
          const st = now.guide.stages[now.si];
          const x = st?.needsJourney ? c.stages[st.id] : null;
          save({ ...now, caseId: c.id, pi: x && now.pi === 0 ? Math.min(x.startStep, st.steps.length - 1) : now.pi });
        }
      } catch {}
    };
    ask();
    const id = window.setInterval(ask, 8000);
    return () => { off = true; window.clearInterval(id); };
  }, [wantsCase, isOpen, guideId, loc, save]);

  // Sample cases, asked once per guide.
  useEffect(() => {
    if (!wantsCase) return;
    let off = false;
    fetch("/guia?examples=1", { cache: "no-store" }).then((r) => r.json()).then((j: { examples?: GuideExample[] }) => { if (!off) setExamples(j.examples ?? []); }).catch(() => {});
    return () => { off = true; };
  }, [wantsCase, guideId]);

  const stage = s?.guide.stages[s.si] ?? null;
  const step = stage?.steps[s!.pi] ?? null;
  const cs: CaseStage | null = stage?.needsJourney && kase ? kase.stages[stage.id] ?? null : null;
  const here = !stage ? true
    : stage.href === null ? true
    : cs ? cs.at.includes(path)
    : stage.needsJourney ? insideJourney(path)
    : path === stage.href || path.startsWith(stage.href + "/");

  // Rings: look for what the current step names, on the screen as it is right now.
  useEffect(() => {
    if (!s || !stage || s.min) { setRings([]); setMissing(false); setHints([]); return; }
    const es = lang === "ES";
    // On another screen the step's buttons are not there yet: only the way is marked.
    const want = step && here ? labelsOf(step).map((l) => ({ raw: l, p: plain(l) })).filter((l) => l.p) : [];
    const way = here ? [] : stage.way.map(plain).filter(Boolean);
    const stepKey = `${s.guide.id}/${s.si}/${s.pi}/${path}`;

    const compute = () => {
      const root = document.querySelector(".app");
      if (!root) return;
      const out: Ring[] = [];
      const say: string[] = [];
      const vh = window.innerHeight, vw = window.innerWidth;
      const els = Array.from(root.querySelectorAll<HTMLElement>("a, button, summary, [role=tab], input[type=submit]")).filter((el) => !el.closest(".guide"));
      const seen = els.map((el) => {
        // A menu entry carries a counter next to its name: read the name alone.
        const raw = el instanceof HTMLInputElement ? el.value : (el.querySelector(".lbl") ?? el).textContent ?? "";
        return { el, text: raw.length > 90 ? "" : plain(raw).replace(/ \d+$/, "") };
      }).filter((x) => x.text);
      const whys = Array.from(root.querySelectorAll<HTMLElement>("[data-guide-for]"));
      const boxOf = (el: HTMLElement) => {
        if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return null;
        const fixed = !!el.closest(".hdr, .side, .bottombar, .drawer");
        if (!fixed && r.top < 52) return { r, inView: false }; // under the top bar
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return { r, inView: false };
        return { r, inView: true };
      };
      let firstOff: HTMLElement | null = null, anyStep = false;
      const put = (el: HTMLElement, key: string, kind: Ring["kind"]) => {
        const b = boxOf(el);
        if (!b) return false;
        if (!b.inView) { firstOff ??= el; return true; }
        if (!out.some((o) => Math.abs(o.x - b.r.left) < 1 && Math.abs(o.y - b.r.top) < 1)) out.push({ key, x: b.r.left, y: b.r.top, w: b.r.width, h: b.r.height, kind, n: kind === "step" ? s.pi + 1 : undefined });
        return true;
      };
      want.forEach((label, li) => {
        // "Emitir factura · USD 1.480,00" is the button "Emitir factura": a name may carry a short tail.
        const cands = seen.filter((x) => x.text === label.p || (x.text.startsWith(label.p + " ") && x.text.length <= label.p.length + 26));
        let n = 0, found = false;
        const closedTitles = new Map<HTMLElement, string>();
        for (const x of cands) {
          const closed = x.el.matches("summary") ? x.el.parentElement?.parentElement?.closest("details:not([open])") : x.el.closest("details:not([open])");
          if (closed) { const sum = closed.querySelector<HTMLElement>(":scope > summary"); if (sum) closedTitles.set(sum, (sum.textContent ?? "").replace(/\s+/g, " ").trim()); continue; }
          if (n >= 4) break;
          if (!put(x.el, `s${li}-${n}`, "step")) continue;
          n++; found = true;
          if ((x.el as HTMLButtonElement).disabled || x.el.getAttribute("aria-disabled") === "true") say.push(es ? `«${label.raw}» está desactivado todavía: la lista de esa sección tiene puntos pendientes.` : `“${label.raw}” is still disabled: the list in that section has open points.`);
        }
        // Inside a closed section: point at the title that opens it. A plain "Guardar" lives in too many sections,
        // so a one-word name is only followed when a single closed section holds it.
        if (!found && closedTitles.size && (label.p.includes(" ") || closedTitles.size === 1)) {
          let k = 0;
          for (const [sum, title] of closedTitles) {
            if (k >= 4 || !put(sum, `c${li}-${k}`, "step")) continue;
            k++; found = true;
            if (k === 1 && title && title.length <= 70 && plain(title) !== label.p) say.push(es ? `«${label.raw}» está dentro de «${title}»: haz clic ahí para abrirlo.` : `“${label.raw}” is inside “${title}”: click there to open it.`);
          }
        }
        // The page itself says why this button is not here for this case.
        if (!found) {
          const why = whys.find((w) => plain(w.dataset.guideFor ?? "") === label.p);
          if (why) {
            found = true;
            const txt = (why.textContent ?? "").trim();
            if (txt) say.push(txt);
            const blk = why.closest<HTMLElement>("[data-guide-block]") ?? why.parentElement;
            if (blk) put(blk, `y${li}`, "see");
          }
        }
        if (found) anyStep = true;
      });
      way.forEach((label, li) => {
        const x = seen.find((c) => c.text === label && !c.el.classList.contains("on") && !c.el.getAttribute("aria-current") && boxOf(c.el)?.inView);
        if (!x) return;
        const r = x.el.getBoundingClientRect();
        out.push({ key: `w${li}`, x: r.left, y: r.top, w: r.width, h: r.height, kind: "way" });
      });
      // The first time a step is shown, bring what it names into view.
      if (firstOff && !out.some((r) => r.kind !== "way") && scrolled.current !== stepKey) {
        scrolled.current = stepKey;
        (firstOff as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
      }
      // The panel never sits on top of what it points at: it moves to the other side.
      const pw = (panel.current?.offsetWidth ?? 372) + 24, ph = (panel.current?.offsetHeight ?? 420) + 24;
      setLeft(vw >= 900 && out.some((r) => r.kind !== "way" && r.x + r.w > vw - pw && r.y + r.h > vh - ph && r.x > pw));
      setMissing(here && want.length > 0 && !anyStep);
      setHints((prev) => (prev.join("|") === say.join("|") ? prev : say));
      setRings((prev) => (prev.length === out.length && prev.every((p, k) => p.key === out[k].key && Math.abs(p.x - out[k].x) < 1 && Math.abs(p.y - out[k].y) < 1 && Math.abs(p.w - out[k].w) < 1 && Math.abs(p.h - out[k].h) < 1) ? prev : out));
    };
    compute();
    const id = window.setInterval(compute, 500);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => { window.clearInterval(id); window.removeEventListener("scroll", compute, true); window.removeEventListener("resize", compute); };
  }, [s, stage, step, here, path, lang]);

  if (!s || !stage) return null;
  const { guide, si, pi } = s;
  const lastStage = si === guide.stages.length - 1;
  const lastStep = pi >= stage.steps.length - 1;
  /** The first step of a stage that still applies to the case on screen. */
  const startOf = (k: number) => { const st = guide.stages[k]; const x = st.needsJourney && kase ? kase.stages[st.id] : null; return x ? Math.min(x.startStep, st.steps.length - 1) : 0; };
  const go = (nsi: number, npi: number) => save({ ...s, si: nsi, pi: npi });
  const next = () => (lastStep ? (lastStage ? save(null) : go(si + 1, startOf(si + 1))) : go(si, pi + 1));
  const back = () => (pi > 0 ? go(si, pi - 1) : si > 0 ? go(si - 1, Math.max(0, guide.stages[si - 1].steps.length - 1)) : undefined);
  const target = stage.way[stage.way.length - 1] ?? stage.title;

  // Where the case on screen really is, against the stage the guide is showing.
  const curIdx = guide.route && kase?.current ? guide.stages.findIndex((st) => st.id === kase.current) : -1;
  const apart = curIdx >= 0 && curIdx !== si && (stage.needsJourney || si === 0) ? curIdx : -1;
  const stageName = (id: string | null) => guide.stages.find((st) => st.id === id)?.title ?? "";

  // Sample cases for this stage: first the ones that are exactly here, then the ones that already passed it.
  const exFor = (): GuideExample[] => {
    if (!examples?.length) return [];
    if (!stage.needsJourney) {
      // The board stage of the whole route: one sample per stage of the way, so any stage can be practised.
      const got = new Set<string>();
      return examples.filter((e) => { if (!e.current || got.has(e.current) || !guide.stages.some((st) => st.id === e.current)) return false; got.add(e.current); return true; }).slice(0, 5);
    }
    return [...examples.filter((e) => e.stages[stage.id]?.state === "now"), ...examples.filter((e) => e.stages[stage.id]?.state === "done")].slice(0, 3);
  };
  const pickExample = (e: GuideExample) => {
    const k = stage.needsJourney ? si : Math.max(0, guide.stages.findIndex((st) => st.id === e.current));
    save({ ...s, caseId: e.id, si: k, pi: 0 });
    router.push(e.stages[guide.stages[k].id]?.href ?? `/deals/${e.id}`);
  };
  const showExamples = wantsCase && !kase && ((stage.needsJourney && !here) || (guide.route && si === 0));
  const ex = showExamples ? exFor() : [];

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
      <aside ref={panel} className={`guide guide-panel${left ? " left" : ""}`} role="complementary" aria-label={t("Guía en pantalla", "On-screen guide")} data-mod={stage.mod ?? undefined}>
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
            {guide.stages.map((st, k) => {
              // With a case on screen, a tick means "done in this case"; without one, "the guide already went past it".
              const done = kase && guide.route ? (st.needsJourney ? kase.stages[st.id]?.state === "done" : k === 0) : k < si;
              return (
                <li key={st.id}>
                  <button type="button" className={k === si ? "on" : done ? "done" : undefined} onClick={() => go(k, startOf(k))} title={st.title} aria-current={k === si ? "step" : undefined}>
                    {k !== si && done ? "✓" : k + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <div className="g-body">
          {kase && wantsCase && <p className="g-case"><small>{t("Siguiendo la Necesidad", "Following Necessity")}{kase.demo ? t(" · ejemplo", " · sample") : ""}</small>{kase.name}</p>}
          <div className="g-stage">
            {guide.stages.length > 1 && <small>{t(`Etapa ${si + 1} de ${guide.stages.length}`, `Stage ${si + 1} of ${guide.stages.length}`)}</small>}
            <b>{stage.title}</b>
            <span className="g-path">{stage.path}</span>
            <p>{stage.why}</p>
          </div>
          {guide.route && si === 0 && !kase && (
            <p className="g-tip">{t("Si tu caso ya va adelantado, ábrelo: la guía salta sola a la etapa en la que está.", "If your case is already further along, open it: the guide jumps by itself to the stage it is in.")}</p>
          )}
          {apart >= 0 && (
            <div className="g-tip g-jump">
              <p>{apart > si
                ? t(`En esta Necesidad esta etapa ya quedó atrás. Va en la etapa ${apart + 1}: ${stageName(kase!.current)}.`, `On this Necessity this stage is already behind. It is at stage ${apart + 1}: ${stageName(kase!.current)}.`)
                : t(`Esta Necesidad todavía va en la etapa ${apart + 1}: ${stageName(kase!.current)}. Lo de aquí viene después.`, `This Necessity is still at stage ${apart + 1}: ${stageName(kase!.current)}. This part comes later.`)}</p>
              <button type="button" className="sm" onClick={() => { const c = kase!.stages[kase!.current!]; go(apart, startOf(apart)); if (c && !c.at.includes(path)) router.push(c.href); }}>{t(`Ir a la etapa ${apart + 1}`, `Go to stage ${apart + 1}`)}</button>
            </div>
          )}
          {cs?.note && <p className={`g-tip${cs.state === "later" ? " g-notyet" : ""}`}>{cs.note}</p>}

          {stage.locked ? (
            <p className="g-where">{t("Tu rol no abre esta pantalla: esta parte la hace otra persona. Puedes leer los pasos para saber qué pedir.", "Your role does not open this screen: someone else does this part. You can read the steps to know what to ask for.")}</p>
          ) : !here && (
            <div className="g-where">
              {cs ? (
                <><p>{t("Esta etapa está en otra página de esta Necesidad.", "This stage is on another page of this Necessity.")}</p><button type="button" className="sm" onClick={() => router.push(cs.href)}>{t("Llévame a esa página", "Take me to that page")}</button></>
              ) : stage.needsJourney ? (
                path === "/deals"
                  ? <p>{t("Esta etapa se hace dentro de una Necesidad. Haz clic en el título de la tarjeta de la Necesidad que quieres avanzar.", "This stage happens inside a Necessity. Click the title of the card of the Necessity you want to move.")}</p>
                  : <><p>{t("Esta etapa se hace dentro de una Necesidad. Abre la que quieres avanzar.", "This stage happens inside a Necessity. Open the one you want to move.")}</p><button type="button" className="sm" onClick={() => router.push("/deals")}>{t("Llévame a Necesidades", "Take me to Necessities")}</button></>
              ) : (
                <><p>{t("Esto está en otra pantalla. Sigue lo que está marcado con línea punteada, o:", "This is on another screen. Follow what is marked with a dashed line, or:")}</p><button type="button" className="sm" onClick={() => router.push(stage.href!)}>{t(`Llévame a ${target}`, `Take me to ${target}`)}</button></>
              )}
            </div>
          )}

          {showExamples && examples && (
            <div className="g-ex">
              <b>{stage.needsJourney ? t("O practica con un ejemplo", "Or practise with a sample") : t("¿Prefieres practicar? Abre un ejemplo", "Rather practise? Open a sample")}</b>
              {ex.length === 0
                ? <p>{examples.length === 0 ? t("No hay datos de ejemplo cargados. Gerencia los carga en «Usuarios y datos».", "No sample data is loaded. Management loads it in “Users and data”.") : t("Ningún ejemplo ha llegado a esta etapa todavía.", "No sample has reached this stage yet.")}</p>
                : ex.map((e) => (
                  <button key={e.id} type="button" className="g-exb" onClick={() => pickExample(e)}>
                    <span>{e.name}</span>
                    <small>{stage.needsJourney
                      ? (e.stages[stage.id]?.state === "now" ? t("está en esta etapa", "is at this stage") : t("ya pasó esta etapa: sirve para verla", "already past this stage: good for looking"))
                      : t(`va en: ${stageName(e.current)}`, `is at: ${stageName(e.current)}`)}</small>
                  </button>
                ))}
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
          {hints.map((h) => <p key={h} className="g-why">{h}</p>)}
          {missing && hints.length === 0 && <p className="g-miss">{t("No veo ese botón en esta pantalla todavía. Puede estar en otra pestaña o aparecer después del paso anterior.", "I can't see that button on this screen yet. It may be on another tab or show up after the previous step.")}</p>}
          {lang === "EN" && <p className="g-miss">The guide text is in Spanish for now, and buttons are only marked when the screen is in Spanish.</p>}

          {lastStep && stage.expect && <p className="g-expect"><b>{t("Qué deberías ver", "What you should see")}</b><StepText text={stage.expect} /></p>}
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
