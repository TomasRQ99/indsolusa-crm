import type { Lang } from "@prisma/client";
import { getCurrentUser } from "./auth";

// Every SOLU-written text is given in both languages at the call site: t("Hola", "Hello").
// People's own text, part numbers and customer documents are never translated.
export type I18n = ReturnType<typeof makeI18n>;

// Calendar days (due dates, promises, deliveries) are stored at UTC midnight and shown as such.
// Real timestamps (created, verified, approved…) are shown in Bogotá time.
const DAY_TZ = "UTC";
const TS_TZ = "America/Bogota";
const isDay = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

export function makeI18n(lang: Lang) {
  const es = lang === "ES";
  const locale = es ? "es-CO" : "en-US";
  const num0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const num2 = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct1 = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    const day = new Intl.DateTimeFormat(locale, { ...o, timeZone: DAY_TZ });
    const ts = new Intl.DateTimeFormat(locale, { ...o, timeZone: TS_TZ });
    return (d: Date) => (isDay(d) ? day : ts).format(d);
  };
  const dLong = fmt({ day: "numeric", month: "short", year: "numeric" });
  const dShort = fmt({ weekday: "short", day: "numeric", month: "short" });
  const dDay = fmt({ day: "numeric", month: "short" });
  const wd = fmt({ weekday: "short" });

  return {
    lang,
    es,
    t: (esText: string, enText: string) => (es ? esText : enText),
    /** 17.900 (es) / 17,900 (en) */
    n: (v: unknown) => num0.format(Number(v ?? 0)),
    /** 125,60 (es) / 125.60 (en) */
    n2: (v: unknown) => num2.format(Number(v ?? 0)),
    /** USD 17.900 */
    money: (v: unknown, currency = "USD") => `${currency} ${num0.format(Number(v ?? 0))}`,
    money2: (v: unknown, currency = "USD") => `${currency} ${num2.format(Number(v ?? 0))}`,
    /** 18,4 % */
    pct: (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : `${pct1.format(v)} %`),
    /** 19,99 % — where a policy threshold is read with two decimals (Eságara gate). */
    pct2: (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : `${num2.format(v)} %`),
    date: (d: Date | null | undefined) => (d ? dLong(d) : "—"),
    dateShort: (d: Date | null | undefined) => (d ? dShort(d) : "—"),
    day: (d: Date | null | undefined) => (d ? dDay(d) : "—"),
    weekday: (d: Date) => wd(d),
  };
}

export const LANG_COOKIE = "solu_lang";

/** The person's language: their profile when signed in, otherwise the last choice in this browser, otherwise Spanish. */
export async function getLang(): Promise<Lang> {
  const user = await getCurrentUser();
  if (user) return user.lang;
  const { cookies } = await import("next/headers");
  return (await cookies()).get(LANG_COOKIE)?.value === "EN" ? "EN" : "ES";
}

export async function getI18n() {
  return makeI18n(await getLang());
}
