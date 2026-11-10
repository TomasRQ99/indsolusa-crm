// Comercial C8c · pure rules for High-Value Focus (v1.3 §60), the Improvement Engine (§61) and periodic closes (§62).
// No opaque score, no fake precision: comparisons show the counts they come from and say when data is too thin.

export const FOCUS_POLICY_KEY = "focusPolicy";
export type FocusPolicy = { materialEsagaraUsd: number; staleDays: number; decisionsDays: number; closeTime: string };
export const DEFAULT_FOCUS_POLICY: FocusPolicy = { materialEsagaraUsd: 2000, staleDays: 7, decisionsDays: 14, closeTime: "17:00" };
export const validCloseTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** §63: high-value no-movement attention is materiality-aware — only items worth at least the policy's Eságara. */
export const needsAttention = (esagara: number | null, daysQuiet: number | null, p: FocusPolicy) =>
  esagara != null && esagara >= p.materialEsagaraUsd && daysQuiet != null && daysQuiet >= p.staleDays;

// ---------- Improvement Engine ----------

export const IMPROVE_RULES = { version: "improve-v1", windowDays: 90, baselineWindows: 3, minSample: 5, minDeltaPts: 5, minRelative: 0.2 } as const;
export type Ratio = { num: number; den: number };
export type Verdict = "BETTER" | "WORSE" | "SAME" | "THIN";
export type Compare = { cur: Ratio; base: Ratio; curPct: number | null; basePct: number | null; verdict: Verdict };

/** Compare a rate in the current window with the person's own baseline. "Higher is better" unless `lowerBetter`. */
export function compareRate(cur: Ratio, base: Ratio, lowerBetter = false): Compare {
  const curPct = cur.den > 0 ? (cur.num / cur.den) * 100 : null;
  const basePct = base.den > 0 ? (base.num / base.den) * 100 : null;
  if (cur.den < IMPROVE_RULES.minSample || base.den < IMPROVE_RULES.minSample || curPct == null || basePct == null) return { cur, base, curPct, basePct, verdict: "THIN" };
  const d = curPct - basePct;
  const rel = basePct === 0 ? (curPct === 0 ? 0 : 1) : Math.abs(d) / basePct;
  if (Math.abs(d) < IMPROVE_RULES.minDeltaPts || rel < IMPROVE_RULES.minRelative) return { cur, base, curPct, basePct, verdict: "SAME" };
  const up = d > 0;
  return { cur, base, curPct, basePct, verdict: up !== lowerBetter ? "BETTER" : "WORSE" };
}

/** Same idea for durations in days (median now vs baseline median); lower is better. */
export function compareDays(cur: number[], base: number[]): { cur: number | null; base: number | null; n: number; nBase: number; verdict: Verdict } {
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const c = med(cur), b = med(base);
  if (cur.length < IMPROVE_RULES.minSample || base.length < IMPROVE_RULES.minSample || c == null || b == null) return { cur: c, base: b, n: cur.length, nBase: base.length, verdict: "THIN" };
  const d = c - b;
  if (Math.abs(d) < 2 || (b > 0 && Math.abs(d) / b < IMPROVE_RULES.minRelative)) return { cur: c, base: b, n: cur.length, nBase: base.length, verdict: "SAME" };
  return { cur: c, base: b, n: cur.length, nBase: base.length, verdict: d < 0 ? "BETTER" : "WORSE" };
}

// ---------- Periodic closes ----------

export type CloseKind = "day" | "week" | "month";
/** Period-event bounds (UTC days): the day; the Monday-to-Sunday week; the calendar month. End is exclusive. */
export function closeBounds(kind: CloseKind, ref: Date) {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  if (kind === "day") return { start: d, end: new Date(d.getTime() + 864e5) };
  if (kind === "week") { const dow = (d.getUTCDay() + 6) % 7; const start = new Date(d.getTime() - dow * 864e5); return { start, end: new Date(start.getTime() + 7 * 864e5) }; }
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
}
export const shiftClose = (kind: CloseKind, ref: Date, n: number) => {
  const { start } = closeBounds(kind, ref);
  if (kind === "day") return new Date(start.getTime() + n * 864e5);
  if (kind === "week") return new Date(start.getTime() + n * 7 * 864e5);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
};
/** The daily management close is due at the policy time; the final technical snapshot is after the full day ends. */
export const COMPANY_TZ = "America/Bogota";
export function closeState(kind: CloseKind, ref: Date, now: Date, closeTime: string, tz = COMPANY_TZ) {
  const { start, end } = closeBounds(kind, ref);
  if (now >= end) return "FINAL" as const;
  if (now < start) return "FUTURE" as const;
  if (kind !== "day") return "OPEN" as const;
  const [h, m] = closeTime.split(":").map(Number);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) >= h * 60 + m ? ("DUE" as const) : ("OPEN" as const);
}
