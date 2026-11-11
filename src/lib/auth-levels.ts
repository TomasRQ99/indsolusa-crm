// Authorisation by level. Pure: no database.
// Starting values are the company's 2025 table ("Rangos de autorización por nivel"), kept in minimum wages (SMLV) as the
// table itself asks, so a new year only needs the new SMLV. Everything here is a versioned policy Gerencia can change.

type Txt = { es: string; en: string };
export const AUTH_POLICY_KEY = "authPolicy";
export type Level = "EMPRENDEDOR" | "JUNIOR" | "SENIOR";
export const LEVELS: Record<Level, Txt> = { EMPRENDEDOR: { es: "Emprendedor", en: "Entrepreneur" }, JUNIOR: { es: "Junior", en: "Junior" }, SENIOR: { es: "Senior", en: "Senior" } };
export const LEVEL_KEYS = Object.keys(LEVELS) as Level[];
export type Step = "PERSONAL" | "PEER" | "SENIOR_PEER" | "MMS_MENTOR" | "GERENCIA";
export const STEPS: Record<Step, Txt & { who: Txt }> = {
  PERSONAL: { es: "Personal", en: "Personal", who: { es: "La persona puede autorizarlo sola", en: "The person can authorise it alone" } },
  PEER: { es: "Compañero de nivel", en: "Peer of the same level", who: { es: "Un compañero de su mismo nivel, con el mentor informado", en: "A peer of the same level, with the mentor informed" } },
  SENIOR_PEER: { es: "Compañero superior", en: "Senior peer", who: { es: "Un compañero de nivel superior, con el mentor informado", en: "A peer of a higher level, with the mentor informed" } },
  MMS_MENTOR: { es: "MMS y mentor", en: "MMS and mentor", who: { es: "MMS y el mentor", en: "MMS and the mentor" } },
  GERENCIA: { es: "Gerencia", en: "Management", who: { es: "Gerencia", en: "Management" } },
};
/** Caps in SMLV for one level; `seniorPeer` is null when that step doesn't exist for the level (Senior). */
export type Ladder = { personal: number; peer: number; seniorPeer: number | null; mmsMentor: number };
export type AuthPolicy = { smlvCop: number; ladder: Record<Level, Ladder> };
export const DEFAULT_AUTH_POLICY: AuthPolicy = {
  smlvCop: 1423500, // SMLV 2025, as on the table
  ladder: { EMPRENDEDOR: { personal: 14, peer: 28, seniorPeer: 49, mmsMentor: 70 }, JUNIOR: { personal: 39, peer: 49, seniorPeer: 63, mmsMentor: 91 }, SENIOR: { personal: 63, peer: 91, seniorPeer: null, mmsMentor: 105 } },
};

export type AuthRead = { step: Step; capCop: number | null; fromCop: number; caps: { step: Step; cop: number }[] };
/** Which step a business of `amountCop` needs for a person of `level`. Above the last cap it is Gerencia's. */
export function authStep(level: Level, amountCop: number, p: AuthPolicy): AuthRead {
  const l = p.ladder[level];
  const caps = ([["PERSONAL", l.personal], ["PEER", l.peer], ["SENIOR_PEER", l.seniorPeer], ["MMS_MENTOR", l.mmsMentor]] as [Step, number | null][]).filter((x): x is [Step, number] => x[1] != null).map(([step, n]) => ({ step, cop: Math.round(n * p.smlvCop) }));
  let from = 0;
  for (const c of caps) { if (amountCop <= c.cop) return { step: c.step, capCop: c.cop, fromCop: from, caps }; from = c.cop; }
  return { step: "GERENCIA", capCop: null, fromCop: from, caps };
}

/** Reads the settings form. Caps must grow from step to step; anything else refuses the whole change. */
export function cleanAuthPolicy(raw: Record<string, unknown>): AuthPolicy | null {
  // Pesos are typed with dots as thousands ("1.423.500"); the ladder is in wages, where a dot or comma is a decimal.
  const n = (k: string, pesos = false) => { const s0 = String(raw[k] ?? "").trim(); const s = pesos ? s0.replace(/[.\s]/g, "").replace(",", ".") : s0.replace(",", "."); const x = Number(s); return s && Number.isFinite(x) ? x : null; };
  const smlv = n("smlvCop", true);
  if (smlv == null || smlv < 100000 || smlv > 100000000) return null;
  const ladder = {} as Record<Level, Ladder>;
  for (const lv of LEVEL_KEYS) {
    const personal = n(`${lv}_personal`), peer = n(`${lv}_peer`), mms = n(`${lv}_mmsMentor`);
    const sRaw = String(raw[`${lv}_seniorPeer`] ?? "").trim();
    const senior = sRaw ? n(`${lv}_seniorPeer`) : null;
    if (personal == null || peer == null || mms == null || (sRaw && senior == null)) return null;
    const seq = [personal, peer, ...(senior != null ? [senior] : []), mms];
    if (seq.some((x) => x <= 0 || x > 100000) || seq.some((x, k) => k > 0 && x <= seq[k - 1])) return null;
    ladder[lv] = { personal, peer, seniorPeer: senior, mmsMentor: mms };
  }
  return { smlvCop: Math.round(smlv), ladder };
}
