import { money2 } from "./money";

// Reading a submitted form, the same way everywhere: trimmed text, money with comma or point, calendar days as
// UTC midnight (the way SOLU stores every "day").

export const fText = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
/** A non-negative amount to the cent; null when empty or not a number. */
export const fMoney = (fd: FormData, k: string, maxValue = 1e9) => { const raw = String(fd.get(k) ?? "").trim().replace(/\s/g, "").replace(",", "."); const n = Number(raw); return raw && Number.isFinite(n) && n >= 0 && n <= maxValue ? money2(n) : null; };
export const fInt = (fd: FormData, k: string, lo = 0, hi = 1e6) => { const raw = String(fd.get(k) ?? "").trim(); const n = Math.round(Number(raw)); return raw && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
/** YYYY-MM-DD → that calendar day; null when empty or not a real date. */
export const fDay = (fd: FormData, k: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fd.get(k) ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100 ? d : null;
};
export const fPick = <T extends string>(fd: FormData, k: string, allowed: Record<T, unknown>): T | null => { const v = String(fd.get(k) ?? ""); return v in allowed ? (v as T) : null; };
