// Comercial · Línea de comunicaciones (user request 2026-11-12). Pure rules: every customer company falls in one
// band according to the last time we were in contact. The cut points are months, decided by management (versioned).

export const CONTACT_LINE_KEY = "contactLine";
export type ContactLinePolicy = { cutsMonths: number[] };
export const DEFAULT_CONTACT_LINE: ContactLinePolicy = { cutsMonths: [1, 3, 6, 12] };
export const CONTACT_LINE_LIMITS = { minCuts: 2, maxCuts: 6, maxMonths: 60 } as const;

/** "1, 3, 6, 12" → [1, 3, 6, 12]. Null when it isn't 2–6 whole months, each larger than the one before. */
export function parseCuts(raw: string): number[] | null {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  if (parts.length < CONTACT_LINE_LIMITS.minCuts || parts.length > CONTACT_LINE_LIMITS.maxCuts) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,2}$/.test(p)) return null;
    const n = Number(p);
    if (n < 1 || n > CONTACT_LINE_LIMITS.maxMonths || (out.length && n <= out[out.length - 1])) return null;
    out.push(n);
  }
  return out;
}

/** Reads a stored policy defensively: anything odd falls back to the default cuts. */
export function cutsOf(p: Partial<ContactLinePolicy> | null | undefined): number[] {
  const c = Array.isArray(p?.cutsMonths) ? parseCuts(p!.cutsMonths.join(",")) : null;
  return c ?? DEFAULT_CONTACT_LINE.cutsMonths;
}

/** The calendar day `months` before `day` (UTC midnight). 31 March minus 1 month = 28/29 February. */
export function monthsBefore(day: Date, months: number): Date {
  const y = day.getUTCFullYear(), m = day.getUTCMonth() - months, d = day.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

/**
 * Band index for a last-contact moment. 0 = contacted within the first cut ("al día"); k = at least cuts[k-1]
 * without contact; cuts.length + 1 = no contact on record.
 */
export function bandOf(last: Date | null, today: Date, cuts: number[]): number {
  if (!last) return cuts.length + 1;
  let k = 0;
  for (const c of cuts) { if (last < monthsBefore(today, c)) k++; else break; }
  return k;
}

type Txt = { es: string; en: string };
/** 12 → "1 año", 18 → "18 meses", 1 → "1 mes". */
export function span(months: number): Txt {
  if (months % 12 === 0) { const y = months / 12; return { es: y === 1 ? "1 año" : `${y} años`, en: y === 1 ? "1 year" : `${y} years` }; }
  return { es: months === 1 ? "1 mes" : `${months} meses`, en: months === 1 ? "1 month" : `${months} months` };
}

export type Tone = "calm" | "plan" | "act" | "risk";
export type Band = { index: number; title: Txt; sub: Txt; tone: Tone; never: boolean };

/** The bands, left (fresh) to right (cold), plus "no contact on record" at the end. */
export function bandsOf(cuts: number[]): Band[] {
  const out: Band[] = [{
    index: 0, never: false, tone: "calm",
    title: { es: "Al día", en: "Up to date" },
    sub: { es: `Hablamos hace menos de ${span(cuts[0]).es}`, en: `We spoke less than ${span(cuts[0]).en} ago` },
  }];
  cuts.forEach((c, k) => {
    const next = cuts[k + 1];
    const last = k === cuts.length - 1;
    out.push({
      index: k + 1, never: false, tone: last ? "risk" : k === 0 ? "plan" : "act",
      title: { es: `Más de ${span(c).es}`, en: `Over ${span(c).en}` },
      sub: next ? { es: `Entre ${span(c).es} y ${span(next).es} sin contacto`, en: `${span(c).en} to ${span(next).en} without contact` } : { es: `Más de ${span(c).es} sin contacto`, en: `More than ${span(c).en} without contact` },
    });
  });
  out.push({ index: cuts.length + 1, never: true, tone: "risk", title: { es: "Sin contacto registrado", en: "No contact on record" }, sub: { es: "SOLU no tiene ninguna llamada, correo, visita ni mensaje", en: "SOLU has no call, email, visit or message" } });
  return out;
}

/** How long ago, in plain words: "hoy", "hace 12 días", "hace 4 meses", "hace 1 año y 2 meses". */
export function ago(last: Date, today: Date): Txt {
  const lastDay = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()));
  const days = Math.floor((today.getTime() - lastDay.getTime()) / 864e5);
  if (days <= 0) return { es: "hoy", en: "today" };
  if (days === 1) return { es: "ayer", en: "yesterday" };
  // Whole months completed, counted by calendar day: the 12th to the 12th is one month.
  let months = 0;
  while (months < 600 && lastDay <= monthsBefore(today, months + 1)) months++;
  if (months < 1) return { es: `hace ${days} días`, en: `${days} days ago` };
  if (months < 12) return { es: `hace ${span(months).es}`, en: `${span(months).en} ago` };
  const y = Math.floor(months / 12), m = months % 12;
  const ys = span(y * 12);
  return m ? { es: `hace ${ys.es} y ${span(m).es}`, en: `${ys.en} and ${span(m).en} ago` } : { es: `hace ${ys.es}`, en: `${ys.en} ago` };
}

export type Channel = "CALL" | "VIDEO" | "MEETING" | "EMAIL" | "WHATSAPP";
export const CHANNEL_LABEL: Record<Channel, Txt> = {
  CALL: { es: "Llamada", en: "Call" },
  VIDEO: { es: "Videollamada", en: "Video call" },
  MEETING: { es: "Visita o reunión", en: "Visit or meeting" },
  EMAIL: { es: "Correo", en: "Email" },
  WHATSAPP: { es: "WhatsApp", en: "WhatsApp" },
};

// ---------- How a registered contact ended (Activity.outcome) ----------

export type RegisterKind = "CALL" | "VIDEO" | "EMAIL" | "MEETING";
export type Outcome = Txt & { key: string; /** the line written in the company's history */ record: Txt; /** does it count as "we were in contact"? */ counts: boolean };
export const OUTCOMES: Record<RegisterKind, Outcome[]> = {
  CALL: [
    { key: "ANSWERED", es: "Contestó", en: "Answered", record: { es: "Llamada contestada", en: "Call answered" }, counts: true },
    { key: "UNANSWERED", es: "No contestó", en: "Unanswered", record: { es: "Llamada sin respuesta", en: "Call not answered" }, counts: false },
  ],
  // A video call is stored as a CALL interaction; its outcome (VIDEO_…) is what tells it apart.
  VIDEO: [
    { key: "VIDEO_DONE", es: "Videollamada realizada", en: "Completed the video call", record: { es: "Videollamada realizada", en: "Video call completed" }, counts: true },
    { key: "VIDEO_ARRANGING", es: "Programando la videollamada", en: "Arranging the video call", record: { es: "Programando la videollamada", en: "Arranging the video call" }, counts: false },
    { key: "VIDEO_CANCELLED", es: "Videollamada cancelada", en: "Cancelled video call", record: { es: "Videollamada cancelada", en: "Video call cancelled" }, counts: false },
  ],
  EMAIL: [
    { key: "PENDING_REPLY", es: "Pendiente de respuesta", en: "Pending answer", record: { es: "Correo enviado, pendiente de respuesta", en: "Email sent, pending answer" }, counts: true },
    { key: "REPLIED", es: "Recibimos respuesta", en: "Received a reply", record: { es: "Correo con respuesta recibida", en: "Email with a reply received" }, counts: true },
  ],
  MEETING: [
    { key: "DONE", es: "Visita realizada", en: "Completed the visit", record: { es: "Visita realizada", en: "Visit completed" }, counts: true },
    { key: "ARRANGING", es: "Organizando la visita", en: "Arranging the visit", record: { es: "Organizando la visita", en: "Arranging the visit" }, counts: false },
    { key: "CANCELLED", es: "Visita cancelada", en: "Cancelled visit", record: { es: "Visita cancelada", en: "Visit cancelled" }, counts: false },
  ],
};
export const outcomeOf = (kind: string, key: unknown): Outcome | null => (OUTCOMES[kind as RegisterKind] ?? []).find((o) => o.key === String(key ?? "")) ?? null;
/** Outcomes that do not move a company to "al día": nobody answered, or the visit has not happened. */
export const OUTCOMES_NOT_CONTACT = Object.values(OUTCOMES).flat().filter((o) => !o.counts).map((o) => o.key);
export const isVideo = (outcome: string | null | undefined) => !!outcome && outcome.startsWith("VIDEO_");
