// The currencies SOLU's suppliers are paid in. The bank prefers paying each supplier in the currency of the
// country we buy from (China → CNY, Germany → EUR…), so the quote keeps the supplier's cost in that currency
// and converts it to USD with a market rate. No dependencies: safe on the server and in the browser.

export type Currency = {
  code: string;
  es: string;
  en: string;
  /** Where it is used, to help pick it by the supplier's country. */
  whereEs: string;
  whereEn: string;
  /** Yahoo quotes it as "1 unit = x USD" (EURUSD=X) instead of "1 USD = x units" (CNY=X). */
  direct?: boolean;
};

export const BASE_CURRENCY = "USD";

export const CURRENCIES: Currency[] = [
  { code: "USD", es: "dólar estadounidense", en: "US dollar", whereEs: "Estados Unidos", whereEn: "United States" },
  { code: "EUR", es: "euro", en: "euro", whereEs: "Alemania, Italia, España, Francia…", whereEn: "Germany, Italy, Spain, France…", direct: true },
  { code: "CNY", es: "yuan chino", en: "Chinese yuan", whereEs: "China", whereEn: "China" },
  { code: "JPY", es: "yen japonés", en: "Japanese yen", whereEs: "Japón", whereEn: "Japan" },
  { code: "GBP", es: "libra esterlina", en: "pound sterling", whereEs: "Reino Unido", whereEn: "United Kingdom", direct: true },
  { code: "CHF", es: "franco suizo", en: "Swiss franc", whereEs: "Suiza", whereEn: "Switzerland" },
  { code: "CAD", es: "dólar canadiense", en: "Canadian dollar", whereEs: "Canadá", whereEn: "Canada" },
  { code: "MXN", es: "peso mexicano", en: "Mexican peso", whereEs: "México", whereEn: "Mexico" },
  { code: "BRL", es: "real brasileño", en: "Brazilian real", whereEs: "Brasil", whereEn: "Brazil" },
  { code: "COP", es: "peso colombiano", en: "Colombian peso", whereEs: "Colombia", whereEn: "Colombia" },
  { code: "KRW", es: "won surcoreano", en: "South Korean won", whereEs: "Corea del Sur", whereEn: "South Korea" },
  { code: "INR", es: "rupia india", en: "Indian rupee", whereEs: "India", whereEn: "India" },
  { code: "TWD", es: "dólar taiwanés", en: "Taiwan dollar", whereEs: "Taiwán", whereEn: "Taiwan" },
  { code: "HKD", es: "dólar de Hong Kong", en: "Hong Kong dollar", whereEs: "Hong Kong", whereEn: "Hong Kong" },
  { code: "SGD", es: "dólar de Singapur", en: "Singapore dollar", whereEs: "Singapur", whereEn: "Singapore" },
  { code: "AUD", es: "dólar australiano", en: "Australian dollar", whereEs: "Australia", whereEn: "Australia", direct: true },
  { code: "SEK", es: "corona sueca", en: "Swedish krona", whereEs: "Suecia", whereEn: "Sweden" },
  { code: "DKK", es: "corona danesa", en: "Danish krone", whereEs: "Dinamarca", whereEn: "Denmark" },
  { code: "PLN", es: "esloti polaco", en: "Polish zloty", whereEs: "Polonia", whereEn: "Poland" },
  { code: "TRY", es: "lira turca", en: "Turkish lira", whereEs: "Turquía", whereEn: "Turkey" },
];

export const FOREIGN_CURRENCIES = CURRENCIES.filter((c) => c.code !== BASE_CURRENCY);
export const currencyOf = (code: string | null | undefined) => CURRENCIES.find((c) => c.code === code) ?? null;
/** A three-letter code, upper case; anything else is USD. */
export const cleanCurrency = (v: unknown): string => {
  const s = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : BASE_CURRENCY;
};

/** A rate as plain decimal text: 6 decimals from 1 up, 10 below (a peso is worth 0.00025974 USD). Never "2.6e-4". */
export const rateText = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return "";
  return v >= 1 ? String(Number(v.toFixed(6))) : v.toFixed(10).replace(/0+$/, "");
};

/** How far `rate` is from the market, in percent (positive = the quote's rate is above the market). */
export const rateGapPct = (rate: number, market: number): number => (market > 0 ? ((rate - market) / market) * 100 : 0);
/** True when the typed rate looks like the market rate written the other way round (USD→currency). */
export const looksInverted = (rate: number, usdPerUnit: number): boolean => {
  if (!(rate > 0) || !(usdPerUnit > 0)) return false;
  const near = (a: number, b: number) => Math.abs(a - b) / b < 0.05;
  return near(rate, 1 / usdPerUnit) && !near(rate, usdPerUnit);
};
