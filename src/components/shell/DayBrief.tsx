"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefGroup, DayBrief as Brief } from "@/lib/day-brief";
import { IconClose } from "./Icons";

// RESUMEN DEL DÍA: opens by itself the first time a person enters SOLU each day (only when there is something
// to show), and again whenever they ask for it from Mi Día. The most serious group comes first; inside each
// group, what has waited longest. "Seen today" and the person's choice to stop it are kept in this browser.

const EVENT = "solu:brief";
const OFF_KEY = "solu.brief.off";
const SHOWN = 4;

/** Open the summary from anywhere (the button on Mi Día). */
export function BriefButton({ lang }: { lang: "ES" | "EN" }) {
  const t = (a: string, b: string) => (lang === "ES" ? a : b);
  return (
    <button type="button" className="secondary sm dbr-open" onClick={() => window.dispatchEvent(new Event(EVENT))}>
      {t("Ver el resumen de hoy", "See today's summary")}
    </button>
  );
}

// ---------- The walk: the cases of the summary, one after another ----------
// Kept for this browser tab only: closing the tab ends it.
const WALK_KEY = "solu.brief.walk";
const WALK_EVENT = "solu:walk";
type WalkCase = { g: string; tone: string; code: string; who: string; href: string };
type Walk = { cases: WalkCase[]; at: number };
const readWalk = (): Walk | null => {
  try {
    const w = JSON.parse(sessionStorage.getItem(WALK_KEY) ?? "null") as Walk | null;
    return w && Array.isArray(w.cases) && w.cases.length ? w : null;
  } catch { return null; }
};
const writeWalk = (w: Walk | null) => {
  try { if (w) sessionStorage.setItem(WALK_KEY, JSON.stringify(w)); else sessionStorage.removeItem(WALK_KEY); } catch { /* no walk in a private window */ }
  window.dispatchEvent(new Event(WALK_EVENT));
};
const walkOf = (groups: BriefGroup[]): WalkCase[] => groups.flatMap((g) => g.rows.map((r) => ({ g: g.title, tone: g.tone, code: r.code, who: r.who, href: r.href })));

/** The bar that stays on screen during the walk: where you are, the next case, and the whole list on request. */
export function BriefWalk({ lang, path }: { lang: "ES" | "EN"; path: string }) {
  const t = (a: string, b: string) => (lang === "ES" ? a : b);
  const router = useRouter();
  const [walk, setWalk] = useState<Walk | null>(null);
  const [list, setList] = useState(false);
  useEffect(() => {
    const sync = () => setWalk(readWalk());
    sync();
    window.addEventListener(WALK_EVENT, sync);
    return () => window.removeEventListener(WALK_EVENT, sync);
  }, []);
  useEffect(() => setList(false), [path]);
  if (!walk) return null;
  const n = walk.cases.length;
  const cur = walk.cases[Math.min(walk.at, n - 1)];
  const go = (k: number) => { writeWalk({ cases: walk.cases, at: k }); router.push(walk.cases[k].href); };
  const end = () => writeWalk(null);
  const last = walk.at >= n - 1;
  return (
    <div className="dbw" role="region" aria-label={t("Recorrido de hoy", "Today's walk")} data-noglossary>
      {list && (
        <ol className="dbw-list">
          {walk.cases.map((c, k) => (
            <li key={`${c.href}-${k}`}>
              {(k === 0 || walk.cases[k - 1].g !== c.g) && <span className="dbw-g" data-tone={c.tone}>{c.g}</span>}
              <button type="button" className={k === walk.at ? "on" : undefined} aria-current={k === walk.at ? "step" : undefined} onClick={() => go(k)}><i>{k + 1}</i><b>{c.code}</b> {c.who}</button>
            </li>
          ))}
        </ol>
      )}
      <div className="dbw-bar">
        <button type="button" className="dbw-where" onClick={() => setList((v) => !v)} aria-expanded={list} title={t("Ver todos los casos del recorrido", "See every case of the walk")}>
          <b>{t(`Recorrido de hoy · caso ${walk.at + 1} de ${n}`, `Today's walk · case ${walk.at + 1} of ${n}`)}</b>
          <span>{[cur.code, cur.who].filter(Boolean).join(" · ")}</span>
        </button>
        <button type="button" className="secondary sm" disabled={walk.at === 0} onClick={() => go(walk.at - 1)}>{t("← Anterior", "← Previous")}</button>
        {last
          ? <button type="button" className="sm" onClick={() => { end(); router.push("/mi-dia"); }}>{t("Terminar el recorrido", "Finish the walk")}</button>
          : <button type="button" className="sm" onClick={() => go(walk.at + 1)}>{t("Siguiente caso →", "Next case →")}</button>}
        <button type="button" className="ibtn" onClick={end} aria-label={t("Salir del recorrido", "Leave the walk")} title={t("Salir del recorrido", "Leave the walk")}><IconClose /></button>
      </div>
    </div>
  );
}

const bogotaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function DayBrief({ lang, uid, name, path }: { lang: "ES" | "EN"; uid: string; name: string; path: string }) {
  const es = lang === "ES";
  const t = (a: string, b: string) => (es ? a : b);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [always, setAlways] = useState(true);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const startRef = useRef<HTMLButtonElement>(null);
  const seenKey = `solu.brief.day.${uid}`;

  const load = useCallback((scope: "mine" | "team") => {
    setBusy(true);
    setFailed(false);
    return fetch(`/shell-brief?scope=${scope}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("brief"))))
      .then((d: Brief) => { setData(d); return d; })
      .catch(() => { setFailed(true); return null; })
      .finally(() => setBusy(false));
  }, []);

  // First entry of the day: look, and open only when something is waiting. Normal days stay silent.
  useEffect(() => {
    let off = false, seen = false, guiding = false;
    try {
      off = localStorage.getItem(OFF_KEY) === "1";
      seen = localStorage.getItem(seenKey) === bogotaDay();
      guiding = !!sessionStorage.getItem("solu.guide");
    } catch { /* private window: it simply shows once per page load */ }
    setAlways(!off);
    if (off || seen || guiding) return;
    let live = true;
    const id = setTimeout(() => {
      load("mine").then((d) => {
        if (!live || !d || d.groups.length === 0) return;
        setOpen(true);
        try { localStorage.setItem(seenKey, bogotaDay()); } catch { /* shown again on the next load */ }
      });
    }, 600);
    return () => { live = false; clearTimeout(id); };
  }, [load, seenKey]);

  // Asked for by hand: always opens, with fresh data.
  useEffect(() => {
    const on = () => { setOpen(true); setMore({}); void load("mine"); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const id = setTimeout(() => startRef.current?.focus(), 0);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(id); };
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);
  const toggleAlways = (v: boolean) => {
    setAlways(v);
    try { if (v) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, "1"); } catch { /* kept for this page only */ }
  };
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Bogota" }).format(new Date()));
  const hello = hour < 12 ? t("Buenos días", "Good morning") : hour < 19 ? t("Buenas tardes", "Good afternoon") : t("Buenas noches", "Good evening");
  const dateText = new Intl.DateTimeFormat(es ? "es-CO" : "en-US", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(new Date());
  const groups = data?.groups ?? [];
  const n = groups.length;
  const sub = !data
    ? dateText
    : n === 0
      ? `${dateText} · ${t("nada atrasado", "nothing overdue")}`
      : `${dateText} · ${n === 1 ? t("1 sugerencia para organizar tu día", "1 suggestion to organise your day") : t(`${n} sugerencias para organizar tu día`, `${n} suggestions to organise your day`)}`;

  // Opening a case starts the walk at that case: the bar at the bottom then offers the next one.
  const startWalk = (href?: string) => {
    const cases = walkOf(groups);
    const at = href ? Math.max(0, cases.findIndex((c) => c.href === href)) : 0;
    if (cases.length) writeWalk({ cases, at });
    close();
    return cases[at]?.href ?? null;
  };

  const Group = ({ g }: { g: BriefGroup }) => {
    const all = !!more[g.key];
    const rows = all ? g.rows : g.rows.slice(0, SHOWN);
    const hidden = g.rows.length - SHOWN;
    return (
      <section className="dbr-group" data-tone={g.tone} aria-label={g.title}>
        <header>
          <b>{g.title}</b>
          <span>{g.advice}</span>
        </header>
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <div className="dbr-row">
                <div className="dbr-top">
                  {r.code && <b>{r.code}</b>}
                  <span className="dbr-who">{r.who}</span>
                  {r.owner && <span className="dbr-owner">{r.owner}</span>}
                  {r.badge && <span className="dbr-days" title={t("Tiempo que lleva así", "How long it has been like this")}>{r.badge}</span>}
                </div>
                <p>{r.text}</p>
              </div>
              <Link className="dbr-go" href={r.href} onClick={() => startWalk(r.href)}>{r.cta}</Link>
            </li>
          ))}
        </ul>
        <div className="dbr-foot">
          {!all && hidden > 0 && <button type="button" className="secondary sm" onClick={() => setMore((m) => ({ ...m, [g.key]: true }))}>{t(`Ver ${hidden} más`, `See ${hidden} more`)}</button>}
          {(all || hidden <= 0) && g.total > g.rows.length && <span className="src">{t(`y ${g.total - g.rows.length} más en la lista`, `and ${g.total - g.rows.length} more in the list`)}</span>}
          <Link href={g.all.href} onClick={close}>{g.all.label} →</Link>
        </div>
      </section>
    );
  };

  return (
    <div className="dbr-scrim" onClick={close}>
      <div className="dbr" role="dialog" aria-modal="true" aria-labelledby="dbr-title" data-mod="midia" data-noglossary onClick={(e) => e.stopPropagation()}>
        <div className="dbr-head">
          <div className="dbr-hello">
            <b id="dbr-title">{hello}, {name}</b>
            <span>{sub}</span>
          </div>
          {data?.canTeam && (
            <div className="seg" role="group" aria-label={t("De quién", "Whose")}>
              <button type="button" className={data.scope === "mine" ? "on" : undefined} aria-pressed={data.scope === "mine"} onClick={() => { setMore({}); void load("mine"); }}>{t("Mío", "Mine")}</button>
              <button type="button" className={data.scope === "team" ? "on" : undefined} aria-pressed={data.scope === "team"} onClick={() => { setMore({}); void load("team"); }}>{t("Equipo", "Team")}</button>
            </div>
          )}
          <button type="button" className="ibtn" onClick={close} aria-label={t("Cerrar", "Close")}><IconClose /></button>
        </div>

        <div className="dbr-body" aria-busy={busy}>
          {!data && busy && <p className="dbr-note">{t("Reuniendo lo de hoy…", "Gathering today's work…")}</p>}
          {failed && <p className="dbr-note">{t("No se pudo cargar el resumen. Puedes cerrarlo y abrirlo otra vez desde Mi Día.", "The summary could not be loaded. You can close it and open it again from My Day.")}</p>}
          {data && n === 0 && !failed && (
            <p className="dbr-calm"><span className="sig ok">{t("Todo al día", "All up to date")}</span> {data.scope === "team" ? t("Nada del equipo quedó atrás ni lleva días sin seguimiento.", "Nothing in the team is overdue or has gone days without follow-up.") : t("Nada tuyo quedó atrás ni lleva días sin seguimiento. Buen momento para adelantar lo que viene.", "Nothing of yours is overdue or has gone days without follow-up. A good moment to get ahead.")}</p>
          )}
          {groups.map((g) => <Group key={g.key} g={g} />)}
          {n > 0 && <p className="dbr-order">{t("Orden: primero lo que pone en riesgo un resultado, luego lo que necesita un movimiento. Dentro de cada grupo, primero lo que lleva más tiempo esperando.", "Order: first what puts a result at risk, then what needs a move. Inside each group, what has waited longest comes first.")}</p>}
        </div>

        <div className="dbr-actions">
          <label className="dbr-always"><input type="checkbox" checked={always} onChange={(e) => toggleAlways(e.target.checked)} /> {t("Mostrar al entrar cada día", "Show when I enter each day")}</label>
          <span className="grow" />
          <Link className="btn secondary" href="/mi-plan" onClick={close}>{t("Planear mi semana", "Plan my week")}</Link>
          {n > 0 && <button type="button" className="secondary" onClick={() => { close(); if (path !== "/mi-dia") router.push("/mi-dia"); }}>{t("Ir a Mi Día", "Go to My Day")}</button>}
          <button type="button" ref={startRef} onClick={() => { const first = startWalk(); if (first) router.push(first); else if (path !== "/mi-dia") router.push("/mi-dia"); }}>{n > 0 ? t("Empezar por el primer caso", "Start with the first case") : t("Empezar mi día", "Start my day")}</button>
        </div>
      </div>
    </div>
  );
}
