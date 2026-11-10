// Working days for SOLU (decision C-18, 2026-11-10): Monday to Friday, skipping Colombia's official holidays.
// The holidays are calculated, not downloaded: Ley 51 de 1983 fixes them by rule (some stay on their date, some move
// to the following Monday, some depend on Easter), so every year works without anyone maintaining a list.

const DAY = 864e5;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const key = (d: Date) => d.toISOString().slice(0, 10);
/** The same date if it is a Monday, otherwise the following Monday ("Ley Emiliani"). */
const toMonday = (d: Date) => new Date(d.getTime() + ((8 - d.getUTCDay()) % 7) * DAY);

/** Easter Sunday (Gregorian), anonymous algorithm. */
export function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

const cache = new Map<number, Set<string>>();
/** Colombia's 18 official holidays of a year, as YYYY-MM-DD. */
export function colombianHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const E = easter(year).getTime();
  const days = [
    // Fixed on their date
    utc(year, 1, 1), utc(year, 5, 1), utc(year, 7, 20), utc(year, 8, 7), utc(year, 12, 8), utc(year, 12, 25),
    // Moved to the following Monday
    ...[[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => toMonday(utc(year, m, d))),
    // Easter: Holy Thursday, Good Friday; then Ascension, Corpus Christi and Sacred Heart on Mondays
    new Date(E - 3 * DAY), new Date(E - 2 * DAY), new Date(E + 43 * DAY), new Date(E + 64 * DAY), new Date(E + 71 * DAY),
  ];
  const set = new Set(days.map(key));
  cache.set(year, set);
  return set;
}

export const isHoliday = (d: Date) => colombianHolidays(d.getUTCFullYear()).has(key(d));
/** Monday–Friday and not a Colombian holiday (UTC day, as SOLU stores dates). */
export const isWorkingDay = (d: Date) => { const w = d.getUTCDay(); return w !== 0 && w !== 6 && !isHoliday(d); };

/** Working days after `a` up to and including `b`. */
export function workingDaysBetween(a: Date, b: Date) {
  const n = Math.round((b.getTime() - a.getTime()) / DAY);
  let w = 0;
  for (let k = 1; k <= n; k++) if (isWorkingDay(new Date(a.getTime() + k * DAY))) w++;
  return w;
}

/** The date `n` working days after `from` (time of day kept). */
export function addWorkingDays(from: Date, n: number) {
  let d = new Date(from.getTime());
  while (n > 0) { d = new Date(d.getTime() + DAY); if (isWorkingDay(d)) n--; }
  return d;
}
