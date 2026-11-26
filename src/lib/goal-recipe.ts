// Recetario mensual (2026-11-24, owner's request with a picture): from the sales goal, the average sale and four
// "1 of N" ratios, the closes, quotes, first meetings, decision-maker pitches and prospecting activities a person
// needs in the month, and per working day. Pure: used by the page (server) and the live preview (client).

export type RecipeInput = {
  salesGoal: number; avgSale: number;
  quotesPerClose: number; meetingsPerQuote: number; pitchesPerMeeting: number; activitiesPerPitch: number;
};
/** The picture's ratios: 1 of 2 quotes closes, 1 of 2 first meetings gives a quote, 1 of 3 pitches a meeting, 1 of 3 activities a pitch. */
export const RECIPE_DEFAULTS = { quotesPerClose: 2, meetingsPerQuote: 2, pitchesPerMeeting: 3, activitiesPerPitch: 3 } as const;
export const RATIO_MAX = 50;

export type RecipeKey = "salesGoal" | "avgSale" | "closes" | "quotes" | "meetings" | "pitches" | "activities" | "daily";
export type Recipe = Record<RecipeKey, number>;

const up = (v: number) => Math.ceil(v - 1e-9);

/** Null when the goal or the average sale is missing: nothing can be derived. */
export function recipeOf(r: RecipeInput, workdays: number): Recipe | null {
  if (!(r.salesGoal > 0) || !(r.avgSale > 0)) return null;
  const closes = up(r.salesGoal / r.avgSale);
  const quotes = closes * r.quotesPerClose;
  const meetings = quotes * r.meetingsPerQuote;
  const pitches = meetings * r.pitchesPerMeeting;
  const activities = pitches * r.activitiesPerPitch;
  return { salesGoal: r.salesGoal, avgSale: r.avgSale, closes, quotes, meetings, pitches, activities, daily: workdays > 0 ? up(activities / workdays) : activities };
}

type Txt = { es: string; en: string };
/** The rows of the chart, top to bottom, with the ratio that produces each one (shown as "1 de N"). */
export const RECIPE_ROWS: { k: RecipeKey; label: Txt; ratio?: keyof typeof RECIPE_DEFAULTS; money?: true }[] = [
  { k: "salesGoal", label: { es: "Meta de ventas (personal)", en: "Sales goal (personal)" }, money: true },
  { k: "avgSale", label: { es: "Valor de mi venta promedio", en: "My average sale" }, money: true },
  { k: "closes", label: { es: "Negocios cerrados que necesitas", en: "Closed deals you need" } },
  { k: "quotes", label: { es: "Propuestas / cotizaciones presentadas", en: "Proposals / quotes presented" }, ratio: "quotesPerClose" },
  { k: "meetings", label: { es: "Primeras reuniones (prospectos diferentes)", en: "First meetings (different prospects)" }, ratio: "meetingsPerQuote" },
  { k: "pitches", label: { es: "Tomadores de decisión escuchan tu speech", en: "Decision makers hear your pitch" }, ratio: "pitchesPerMeeting" },
  { k: "activities", label: { es: "Actividades de prospección al mes", en: "Prospecting activities per month" }, ratio: "activitiesPerPitch" },
  { k: "daily", label: { es: "Actividades de prospección diaria", en: "Daily prospecting activities" } },
];

/** The four ratios as the form asks them. */
export const RATIO_FIELDS: { k: keyof typeof RECIPE_DEFAULTS; label: Txt }[] = [
  { k: "quotesPerClose", label: { es: "¿De cada cuántas cotizaciones presentadas cierras 1?", en: "Out of how many presented quotes do you close 1?" } },
  { k: "meetingsPerQuote", label: { es: "¿De cada cuántas primeras reuniones sale 1 cotización?", en: "Out of how many first meetings does 1 quote come?" } },
  { k: "pitchesPerMeeting", label: { es: "¿De cada cuántos tomadores de decisión que escuchan tu speech sale 1 primera reunión?", en: "Out of how many decision makers who hear your pitch does 1 first meeting come?" } },
  { k: "activitiesPerPitch", label: { es: "¿De cada cuántas actividades de prospección llegas a 1 tomador de decisión?", en: "Out of how many prospecting activities do you reach 1 decision maker?" } },
];

/** The full number, "100,000" (owner, 2026-11-26: never "100k"). The name is kept for its callers. */
export function shortMoney(v: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v) || 0);
}
