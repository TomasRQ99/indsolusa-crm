"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PendingFeedback } from "./PendingFeedback";
import type { ModuleKey } from "@/lib/nav";
import type { Alert, Counter } from "@/lib/attention";
import { setLanguage } from "@/app/(app)/profile/actions";
import { logout } from "@/app/login/actions";
import { ReportSignal } from "@/components/ReportSignal";
import { GuideOverlay, startGuide } from "./GuideOverlay";
import { GlossaryLayer } from "./GlossaryLayer";
import type { GuideMatch } from "@/lib/guide";
import { IconBell, IconChevron, IconClose, IconMenu, IconSearch, IconSparkle, MODULE_ICONS } from "./Icons";

export type ShellModule = {
  key: ModuleKey;
  label: string;
  href: string;
  match: string[];
  tabs: { href: string; label: string; group?: string }[];
  counter?: Counter;
};

type Hit = { kind: string; id: string; label: string; sub: string; href: string };

export type ShellProps = {
  lang: "ES" | "EN";
  /** On-screen guide (training). Each person turns it off in Mi perfil. */
  guideOn: boolean;
  user: { name: string; role: string; initials: string };
  modules: ShellModule[];
  children: React.ReactNode;
};

type Side = "" | "expanded" | "collapsed";

export function ShellClient({ lang, guideOn, user, modules: baseModules, children }: ShellProps) {
  const [att, setAtt] = useState<{ counters: Partial<Record<ModuleKey, Counter>>; alerts: Alert[] }>({ counters: {}, alerts: [] });
  const path = usePathname() ?? "/";
  // Counters and bell load after the page is visible. They refresh whenever the server
  // sends new content (every navigation and every save re-renders the layout, which hands
  // the shell new children), so they never hold anything up.
  useEffect(() => {
    let live = true;
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch("/shell-attention", { signal: ctl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((a) => { if (live && a) setAtt(a); })
        .catch(() => {});
    }, 50);
    return () => { live = false; clearTimeout(id); ctl.abort(); };
  }, [children]);
  const alerts = att.alerts;
  const modules = baseModules.map((m) => ({ ...m, counter: att.counters[m.key] }));
  const es = lang === "ES";
  const t = (a: string, b: string) => (es ? a : b);

  const current = modules.find((m) => m.match.some((p) => path === p || path.startsWith(p + "/")));
  const activeTab = current?.tabs
    .filter((tab) => path === tab.href || path.startsWith(tab.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  // Modules with many sections show one group of tabs at a time.
  const groups = [...new Set((current?.tabs ?? []).map((x) => x.group).filter((g): g is string => !!g))];
  const activeGroup = groups.length > 1 ? activeTab?.group ?? groups[0] : null;
  const shownTabs = (current?.tabs ?? []).filter((x) => !activeGroup || x.group === activeGroup);

  const [side, setSide] = useState<Side>("");
  const [drawer, setDrawer] = useState(false);
  const [ask, setAsk] = useState(false);
  const [bell, setBell] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const userMenu = useRef<HTMLDetailsElement>(null);

  // Remember the person's sidebar choice; otherwise the screen width decides.
  useEffect(() => {
    try {
      const v = localStorage.getItem("solu.side");
      if (v === "expanded" || v === "collapsed") setSide(v);
    } catch {}
  }, []);
  const toggleSide = () => {
    const collapsed = side === "collapsed" || (side === "" && window.innerWidth < 1440);
    const next: Side = collapsed ? "expanded" : "collapsed";
    setSide(next);
    try {
      localStorage.setItem("solu.side", next);
    } catch {}
  };

  const closeAll = useCallback(() => {
    setDrawer(false);
    setAsk(false);
    setBell(false);
    setSearchOpen(false);
    if (userMenu.current) userMenu.current.open = false;
  }, []);
  useEffect(closeAll, [path, closeAll]);

  // The search box also answers "what do I need to do": as the person types, SOLU offers the
  // matching guides of the Guía de campo, to be followed on screen.
  const [sq, setSq] = useState("");
  const [sug, setSug] = useState<GuideMatch[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const [sugSel, setSugSel] = useState(-1);
  const [starters, setStarters] = useState<GuideMatch[] | null>(null);
  useEffect(() => {
    const q = sq.trim();
    setSugSel(-1);
    if (!guideOn) { setSug([]); return; }
    // Nothing typed: the everyday work, loaded the first time the box is opened.
    if (!q) { setSug(starters ?? []); return; }
    if (q.length < 3) { setSug([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/guia?q=${encodeURIComponent(q)}`, { signal: ctl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { guides: [] }))
        .then((d) => setSug(d.guides ?? []))
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [sq, starters, guideOn]);
  // Training guide turned off: a guide left open goes away with it.
  useEffect(() => {
    if (!guideOn) try { sessionStorage.removeItem("solu.guide"); } catch {}
  }, [guideOn]);
  useEffect(() => {
    if (!guideOn || !sugOpen || starters) return;
    fetch("/guia", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { guides: [] })).then((d) => setStarters(d.guides ?? [])).catch(() => {});
  }, [sugOpen, starters, guideOn]);
  const pickGuide = (g: GuideMatch, route: boolean) => {
    setSugOpen(false);
    setSearchOpen(false);
    setSq("");
    searchRef.current?.blur();
    startGuide(g.id, route);
  };

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  // Ctrl K or "/" jumps to the search box from anywhere; Esc closes panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        openSearch();
      } else if (e.key === "Escape") {
        closeAll();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSearch, closeAll]);

  useEffect(() => {
    if (ask) setTimeout(() => askRef.current?.focus(), 0);
  }, [ask]);

  const midia = modules.find((m) => m.key === "midia")?.counter;

  const pill = (c?: Counter) => (c ? <span className={`pill ${c.tone}`}>{c.n > 99 ? "99+" : c.n}</span> : null);

  const navList = (inDrawer: boolean) => (
    <ul className="nav">
      {modules.map((m) => {
        const on = current?.key === m.key;
        return (
          <li key={m.key}>
            <Link href={m.href} data-mod={m.key} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} title={inDrawer ? undefined : m.label}>
              <span className="mico">{MODULE_ICONS[m.key]}</span>
              <span className="lbl">{m.label.replace("/", "/​")}</span>
              {pill(m.counter)}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const langSwitch = (
    <form action={setLanguage} className="seg" aria-label={t("Idioma", "Language")}>
      <button type="submit" name="lang" value="ES" className={es ? "on" : undefined} aria-pressed={es} title="Español">ES</button>
      <button type="submit" name="lang" value="EN" className={!es ? "on" : undefined} aria-pressed={!es} title="English">EN</button>
    </form>
  );

  return (
    <div className="app" data-side={side || undefined} data-mod={current?.key}>
      <Suspense fallback={null}>
        <PendingFeedback lang={lang} />
      </Suspense>
      <header className="hdr">
        <button type="button" className="ibtn menu-btn" onClick={() => setDrawer(true)} aria-label={t("Abrir menú", "Open menu")}>
          <IconMenu />
        </button>
        <Link href="/mi-dia" className="wordmark">
          SOLU USA<small>Industry Solutions</small>
        </Link>
        {current && <span className="cur-module">{current.label}</span>}

        <form
          className={`search${searchOpen ? " open" : ""}`}
          action="/buscar"
          role="search"
          onSubmit={(e) => { if (sugSel >= 0 && sug[sugSel]) { e.preventDefault(); pickGuide(sug[sugSel], sug[sugSel].routeLen > 0); } }}
        >
          <IconSearch />
          <input
            ref={searchRef}
            name="q"
            type="search"
            autoComplete="off"
            value={sq}
            onChange={(e) => { setSq(e.target.value); setSugOpen(true); }}
            onFocus={() => setSugOpen(true)}
            onKeyDown={(e) => {
              if (!sugOpen || !sug.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setSugSel((v) => Math.min(sug.length - 1, v + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSugSel((v) => Math.max(-1, v - 1)); }
              else if (e.key === "Escape") setSugOpen(false);
            }}
            placeholder={guideOn ? t("Busca un registro o escribe qué necesitas hacer: «hacer factura»…", "Search a record or type what you need to do: “make invoice”…") : t("Buscar o pegar: pedido, AWB, cliente, proveedor, NIT…", "Search or paste: order, AWB, customer, supplier, tax ID…")}
            aria-label={t("Buscar o pedir una guía", "Search or ask for a guide")}
            aria-expanded={sugOpen && sug.length > 0}
            aria-controls="search-sug"
            onBlur={() => setTimeout(() => { setSearchOpen(false); setSugOpen(false); }, 180)}
          />
          <kbd>Ctrl K</kbd>
          {sugOpen && sug.length > 0 && (
            <div className="search-sug" id="search-sug" role="listbox" aria-label={t("Guías", "Guides")} onMouseDown={(e) => e.preventDefault()}>
              <div className="ss-head">{sq.trim() ? t("Te guío en pantalla, paso a paso", "I'll guide you on screen, step by step") : t("¿Qué necesitas hacer? El trabajo de todos los días, con guía en pantalla", "What do you need to do? Everyday work, with an on-screen guide")}</div>
              {sug.map((g, k) => (
                <div key={g.id} className={`ss-item${k === sugSel ? " sel" : ""}`} data-mod={g.mod ?? undefined} role="option" aria-selected={k === sugSel}>
                  <span className="mico">{g.mod ? MODULE_ICONS[g.mod] : <IconSearch />}</span>
                  <div className="ss-txt">
                    <b>{g.title}</b>
                    <small>{g.path}</small>
                  </div>
                  <div className="ss-act">
                    {g.routeLen > 0 && (
                      <button type="button" className="sm" onClick={() => pickGuide(g, true)} title={t("Desde la primera necesidad del cliente hasta aquí", "From the customer's first need up to here")}>
                        {t(`Desde el inicio · ${g.routeLen} etapas`, `From the start · ${g.routeLen} stages`)}
                      </button>
                    )}
                    <button type="button" className={`sm${g.routeLen > 0 ? " secondary" : ""}`} onClick={() => pickGuide(g, false)}>
                      {g.routeLen > 0 ? t("Solo esta parte", "Only this part") : t("Guíame", "Guide me")}
                    </button>
                  </div>
                </div>
              ))}
              <div className="ss-foot">
                <span>{t("Enter busca registros: clientes, Necesidades, facturas, repuestos.", "Enter searches records: customers, Necessities, invoices, parts.")}</span>
                <Link href="/profile#guia">{t("Apagar la guía de entrenamiento", "Turn off the training guide")}</Link>
              </div>
            </div>
          )}
        </form>
        <button type="button" className="ibtn search-btn" onClick={openSearch} aria-label={t("Buscar", "Search")}>
          <IconSearch />
        </button>

        <button type="button" className={`ask-btn${ask ? " on" : ""}`} onClick={() => { setBell(false); setAsk((v) => !v); }} aria-expanded={ask}>
          <IconSparkle />
          <span>{t("Pregúntale a SOLU", "Ask SOLU")}</span>
        </button>

        <div className="grow" />

        <div className="bell-wrap">
          <button type="button" className="ibtn bell" onClick={() => { setAsk(false); setBell((v) => !v); }} aria-expanded={bell} aria-label={t(`Alertas: ${alerts.length}`, `Alerts: ${alerts.length}`)}>
            <IconBell />
            {alerts.length > 0 && <span className="badge">{alerts.length > 9 ? "9+" : alerts.length}</span>}
          </button>
        </div>

        <div className="hdr-lang">{langSwitch}</div>

        <details className="who" ref={userMenu}>
          <summary aria-label={t("Menú de usuario", "User menu")}>
            <span className="avatar">{user.initials}</span>
            <span className="who-txt">
              <b>{user.name}</b>
              <small>{user.role}</small>
            </span>
          </summary>
          <div className="menu-pop">
            <div className="menu-head"><b>{user.name}</b><small>{user.role}</small></div>
            <Link href="/profile">{t("Mi perfil y preferencias", "My profile & preferences")}</Link>
            <Link href="/glosario">{t("Glosario de términos", "Glossary of terms")}</Link>
            <div className="menu-lang">
              <span>{t("Idioma", "Language")}</span>
              {langSwitch}
            </div>
            <form action={logout}>
              <button type="submit" className="menu-item">{t("Salir", "Sign out")}</button>
            </form>
          </div>
        </details>
      </header>

      <aside className="side" aria-label={t("Navegación principal", "Main navigation")}>
        <nav>{navList(false)}</nav>
        <div className="side-foot">
          <span className="lbl">v0.1 · {t("sistema base", "base system")}</span>
          <button type="button" className="ibtn collapse" onClick={toggleSide} aria-label={t("Contraer o expandir menú", "Collapse or expand menu")}>
            <IconChevron />
          </button>
        </div>
      </aside>

      <main className="main" id="contenido">
        {/* Module band: its colour, its name and where you are inside it. One colour per module, everywhere. */}
        {current && (
          <div className="modhead">
            <div className="modrib">
              <span className="mico">{MODULE_ICONS[current.key]}</span>
              <b>{current.label}</b>
              {activeGroup && <><i aria-hidden>›</i><span>{activeGroup}</span></>}
              {activeTab && <><i aria-hidden>›</i><span className="here">{activeTab.label}</span></>}
            </div>
            {groups.length > 1 && (
              <nav className="tab-groups" aria-label={current.label}>
                {groups.map((g) => (
                  <Link key={g} href={current.tabs.find((x) => x.group === g)!.href} className={g === activeGroup ? "on" : undefined} aria-current={g === activeGroup ? "true" : undefined}>{g}</Link>
                ))}
              </nav>
            )}
            {shownTabs.length > 1 && (
              <nav className="tabs" aria-label={activeGroup ?? current.label}>
                {shownTabs.map((tab) => (
                  <Link key={tab.href} href={tab.href} className={activeTab?.href === tab.href ? "on" : undefined} aria-current={activeTab?.href === tab.href ? "page" : undefined}>
                    {tab.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        )}
        {children}
      </main>

      {/* Tablet / mobile: the 8 modules in a drawer */}
      {drawer && (
        <div className="scrim" onClick={() => setDrawer(false)}>
          <div className="drawer" role="dialog" aria-modal="true" aria-label={t("Menú", "Menu")} onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="wordmark">SOLU USA<small>Industry Solutions</small></span>
              <button type="button" className="ibtn" onClick={() => setDrawer(false)} aria-label={t("Cerrar", "Close")}><IconClose /></button>
            </div>
            <nav>{navList(true)}</nav>
          </div>
        </div>
      )}

      {/* Alerts: only events that need human judgment */}
      {bell && (
        <div className="pop alerts" role="dialog" aria-label={t("Alertas", "Alerts")}>
          <div className="pop-head">
            <b>{t("Necesita tu criterio", "Needs your judgment")}</b>
            <button type="button" className="ibtn" onClick={() => setBell(false)} aria-label={t("Cerrar", "Close")}><IconClose /></button>
          </div>
          {alerts.length === 0 ? (
            <p className="pop-empty">{t("Nada necesita tu criterio ahora.", "Nothing needs your judgment right now.")}</p>
          ) : (
            <ul>
              {alerts.slice(0, 8).map((a) => (
                <li key={a.key}>
                  <Link href={a.href}><span className={`dot ${a.tone}`} />{a.text}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ask && <AskPanel es={es} where={current ? `${current.label}${activeTab ? ` · ${activeTab.label}` : ""}` : ""} inputRef={askRef} onClose={() => setAsk(false)} />}

      {guideOn && <GuideOverlay lang={lang} path={path} />}
      <GlossaryLayer lang={lang === "ES" ? "es" : "en"} path={path} />

      {/* Mobile: bottom bar */}
      <nav className="bottombar" aria-label={t("Accesos", "Shortcuts")}>
        <Link href="/mi-dia" className={current?.key === "midia" ? "on" : undefined}>
          {MODULE_ICONS.midia}
          <span>{t("Mi día", "My day")}</span>
          {midia && <i className={`bb-count ${midia.tone}`}>{midia.n}</i>}
        </Link>
        <button type="button" onClick={openSearch}><IconSearch /><span>{t("Buscar", "Search")}</span></button>
        <button type="button" onClick={() => { setBell(false); setAsk(true); }} className="bb-ask"><IconSparkle size={20} /><span>{t("Pregúntale", "Ask")}</span></button>
        <button type="button" onClick={() => { setAsk(false); setBell(true); }}>
          <IconBell /><span>{t("Alertas", "Alerts")}</span>
          {alerts.length > 0 && <i className="bb-count attn">{alerts.length}</i>}
        </button>
        <button type="button" onClick={() => setDrawer(true)}><IconMenu /><span>{t("Menú", "Menu")}</span></button>
      </nav>
    </div>
  );
}

function AskPanel({ es, where, inputRef, onClose }: { es: boolean; where: string; inputRef: React.RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const t = (a: string, b: string) => (es ? a : b);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ q: string; hits: Hit[]; screens: { href: string; label: string }[]; guides?: GuideMatch[]; guideOff?: boolean } | null>(null);
  const guides = res?.guides ?? [];
  const guide = (g: GuideMatch, route: boolean) => { onClose(); startGuide(g.id, route); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/ask?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      setRes({ q, ...data });
    } catch {
      setRes({ q, hits: [], screens: [], guides: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="ask-panel" role="dialog" aria-label={t("Pregúntale a SOLU", "Ask SOLU")}>
      <div className="pop-head">
        <b><IconSparkle size={16} /> {t("Pregúntale a SOLU", "Ask SOLU")}</b>
        <button type="button" className="ibtn" onClick={onClose} aria-label={t("Cerrar", "Close")}><IconClose /></button>
      </div>
      {where && <p className="ask-where">{t("Estás en", "You are in")}: <b>{where}</b></p>}
      <form onSubmit={submit} className="ask-form" data-no-pending>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Ej.: ¿cómo hago una factura? · ¿qué pasa con la OC 4500-221?", "E.g.: how do I make an invoice? · what's going on with PO 4500-221?")} aria-label={t("Tu pregunta", "Your question")} />
        <button type="submit" disabled={busy}>{busy ? "…" : t("Preguntar", "Ask")}</button>
      </form>
      <p className="ask-note">
        {t(
          "Las respuestas escritas por IA aún no están conectadas. Por ahora SOLU te muestra los registros y pantallas que coinciden con tu pregunta, y si preguntas cómo hacer algo, te ofrece la guía en pantalla.",
          "AI-written answers are not connected yet. For now SOLU shows the records and screens that match your question, and if you ask how to do something, it offers the on-screen guide.",
        )}
      </p>
      <ReportSignal es={es} screen={where} />
      {res && (
        <div className="ask-res">
          {guides.length > 0 && (
            <>
              <h3 className="ask-gh">{t("Te guío en pantalla, paso a paso", "I'll guide you on screen, step by step")}</h3>
              <ul className="ask-guides">
                {guides.map((g) => (
                  <li key={g.id} data-mod={g.mod ?? undefined}>
                    <span className="mico">{g.mod ? MODULE_ICONS[g.mod] : <IconSearch />}</span>
                    <div className="ss-txt"><b>{g.title}</b><small>{g.path}</small></div>
                    <div className="ss-act">
                      {g.routeLen > 0 && <button type="button" className="sm" onClick={() => guide(g, true)}>{t(`Desde el inicio · ${g.routeLen} etapas`, `From the start · ${g.routeLen} stages`)}</button>}
                      <button type="button" className={`sm${g.routeLen > 0 ? " secondary" : ""}`} onClick={() => guide(g, false)}>{g.routeLen > 0 ? t("Solo esta parte", "Only this part") : t("Guíame", "Guide me")}</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {res.guideOff && <p className="ask-where">{t("La guía de entrenamiento está apagada.", "The training guide is off.")} <Link href="/profile#guia">{t("Encenderla en Mi perfil", "Turn it on in My profile")}</Link></p>}
          {guides.length === 0 && res.hits.length === 0 && res.screens.length === 0 && <p className="pop-empty">{t(`No encontré nada para "${res.q}".`, `I found nothing for "${res.q}".`)}</p>}
          {res.hits.length > 0 && (
            <>
              <h3>{t("Registros", "Records")}</h3>
              <ul>{res.hits.map((h) => <li key={h.kind + h.id}><Link href={h.href}><b>{h.label}</b>{h.sub && <small>{h.sub}</small>}</Link></li>)}</ul>
            </>
          )}
          {res.screens.length > 0 && (
            <>
              <h3>{t("Pantallas", "Screens")}</h3>
              <ul>{res.screens.map((s) => <li key={s.href}><Link href={s.href}>{s.label}</Link></li>)}</ul>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
