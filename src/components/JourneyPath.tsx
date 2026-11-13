// The life of an order as one strip of steps (audit 2026-11-12). Colour is the guide:
// green = done · blue = the step that is yours now (a button) · amber = yours and its date has passed · red = at risk ·
// solid grey with a pause = waiting with control (someone else has it) · hollow grey = later · dashed = never written
// down. Same code as the rest of SOLU: blue is action, amber is attention, grey is waiting. The state is also written in words, never colour alone.
// A risk sits on its own step, so a path can show one red step and one blue (or amber) step at the same time.

import Link from "next/link";
import type { PathState, PathStep } from "@/lib/journey";

type Path = {
  over: boolean; lost: boolean; closed: boolean; steps: PathStep[];
  current: { key: string; state: PathState; what: string; noted: string | null; late: boolean; tab: string; label: string } | null;
  risk: { key: string; what: string; tab: string; label: string } | null;
};

export function pathWords(es: boolean): Record<PathState, string> {
  return es
    ? { done: "Hecho", now: "Tu paso ahora", late: "Tu paso, se pasó la fecha", wait: "Esperando con control", risk: "En riesgo", later: "Después", gap: "Sin registrar" }
    : { done: "Done", now: "Your step now", late: "Your step, past its date", wait: "Waiting with control", risk: "At risk", later: "Later", gap: "Not recorded" };
}

export function JourneyPath({ path, self, es }: { path: Path; self: string; es: boolean }) {
  const W = pathWords(es);
  const cur = path.current, risk = path.risk;
  const same = !!cur && !!risk && cur.key === risk.key;
  return (
    <nav className="jp" aria-label={es ? "Camino del pedido" : "Path of the order"}>
      <ol className="jp-steps">
        {path.steps.map((s, n) => (
          <li key={s.key} className="jp-step" data-st={s.state} aria-current={cur?.key === s.key ? "step" : undefined}>
            <Link href={`${self}?tab=${s.tab}`} title={`${s.label}: ${W[s.state]}`}>
              <span className="jp-dot" aria-hidden="true">{s.state === "done" ? "✓" : s.state === "risk" ? "!" : s.state === "wait" ? "⏸" : n + 1}</span>
              <span className="jp-l">{s.label}</span>
              <span className="jp-s">{W[s.state]}</span>
            </Link>
          </li>
        ))}
      </ol>
      {risk && (
        <div className="jp-now" data-st="risk">
          <span className="jp-k">{W.risk} · {risk.label}</span>
          <b>{risk.what}</b>
          <span className="grow" />
          {!same && <Link className="btn secondary" href={`${self}?tab=${risk.tab}`}>{es ? "Ver este paso" : "See this step"} →</Link>}
        </div>
      )}
      {cur ? (
        <div className="jp-now" data-st={cur.state}>
          <span className="jp-k">{W[cur.state]} · {cur.label}</span>
          <span className="jp-w"><b>{cur.what}</b>{cur.noted && <span className={`jp-n${cur.late ? " late" : ""}`}>{cur.noted}</span>}</span>
          <span className="grow" />
          <Link className={`btn${cur.state === "wait" ? " secondary" : ""}`} href={`${self}?tab=${cur.tab}`}>{cur.state !== "wait" ? (es ? "Ir a este paso" : "Go to this step") : es ? "Ver este paso" : "See this step"} →</Link>
        </div>
      ) : (
        <div className="jp-now" data-st="later">
          <span className="jp-k">{path.lost ? (es ? "Necesidad perdida" : "Necessity lost") : path.closed ? (es ? "Necesidad cerrada" : "Necessity closed") : es ? "Camino completo" : "Path complete"}</span>
          <b>{es ? "No queda ningún paso por mover." : "No step is left to move."}</b>
        </div>
      )}
    </nav>
  );
}

/** The key to the colours, for lists and boards. */
export function PathLegend({ es, only }: { es: boolean; only?: PathState[] }) {
  const W = pathWords(es);
  const order: PathState[] = only ?? ["now", "late", "risk", "wait", "later", "done"];
  return <p className="jp-legend">{order.map((k) => <span key={k}><i data-st={k} />{W[k]}</span>)}</p>;
}
