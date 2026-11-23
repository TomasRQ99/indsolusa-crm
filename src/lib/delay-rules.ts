import { COMPANY } from "./company";

// AVISO DE RETRASO (owner, 2026-11-23): when a delivery passes its promised date, SOLU asks what caused the delay
// (tags the administrator defines), proposes what to tell the customer and a new date, and builds the email.
// This file is pure (no database): the same functions run on the server and in the browser preview.
//
// A tag carries: its name, the family of cause Gerencia compares in Insights (the short list in causes.ts), what
// the customer is told, and what we propose to do. The customer text never blames a supplier by name
// (constitution: external messages do not criticise third parties).

export const DELAY_TAGS_KEY = "delayTags";
export type DelayCause = "SPEC" | "SUPPLIER" | "LOGISTICS" | "CUSTOMER" | "COST" | "OTHER";
export const DELAY_CAUSES: DelayCause[] = ["SUPPLIER", "LOGISTICS", "SPEC", "CUSTOMER", "COST", "OTHER"];
export type DelayTag = { key: string; label: string; cause: DelayCause; explainEs: string; explainEn: string; solutionEs: string; solutionEn: string; active: boolean };
export const MAX_DELAY_TAGS = 24;

export const DEFAULT_DELAY_TAGS: DelayTag[] = [
  { key: "FABRICANTE", label: "El fabricante despachó más tarde de lo confirmado", cause: "SUPPLIER", active: true,
    explainEs: "El fabricante despachó la mercancía más tarde de la fecha que nos había confirmado.", explainEn: "The manufacturer shipped the goods later than the date it had confirmed to us.",
    solutionEs: "Ya tenemos la fecha de despacho confirmada por escrito y estamos siguiendo el envío día a día.", solutionEn: "We now have the ship date confirmed in writing and we are following the shipment day by day." },
  { key: "INCOMPLETO", label: "Llegó incompleto o con una pieza distinta", cause: "SUPPLIER", active: true,
    explainEs: "Al recibir la mercancía encontramos que no correspondía por completo a lo que usted pidió, y preferimos no entregarle algo que no le sirve.", explainEn: "When we received the goods we found they did not fully match what you ordered, and we preferred not to deliver something that would not work for you.",
    solutionEs: "Ya pedimos la reposición de lo que falta y la traemos por el medio más rápido disponible.", solutionEn: "We have already ordered the replacement of what is missing and are bringing it by the fastest means available." },
  { key: "TRANSPORTE", label: "Demora del transportador", cause: "LOGISTICS", active: true,
    explainEs: "El envío tuvo una demora en el transporte que no estaba prevista.", explainEn: "The shipment had an unexpected delay in transit.",
    solutionEs: "Estamos en contacto con el transportador y le avisaremos apenas el envío cambie de estado.", solutionEn: "We are in contact with the carrier and will let you know as soon as the shipment changes status." },
  { key: "ADUANA", label: "Demora en aduana o nacionalización", cause: "LOGISTICS", active: true,
    explainEs: "El trámite de aduana está tomando más tiempo del habitual.", explainEn: "Customs clearance is taking longer than usual.",
    solutionEs: "Ya entregamos los documentos que pidió la aduana y estamos pendientes de la liberación.", solutionEn: "We have already provided the documents customs asked for and are waiting for the release." },
  { key: "ESPECIFICACION", label: "Hubo que confirmar la especificación de la pieza", cause: "SPEC", active: true,
    explainEs: "Antes de despachar fue necesario confirmar un dato técnico de la pieza, para asegurar que sea exactamente la que su equipo necesita.", explainEn: "Before shipping we had to confirm a technical detail of the part, to make sure it is exactly the one your equipment needs.",
    solutionEs: "El dato ya quedó confirmado y el pedido sigue su curso.", solutionEn: "The detail is now confirmed and the order is moving again." },
  { key: "CLIENTE", label: "Esperamos un dato, documento o pago del cliente", cause: "CUSTOMER", active: true,
    explainEs: "Para continuar con su pedido estamos a la espera de una información de su parte.", explainEn: "To continue with your order we are waiting for some information from your side.",
    solutionEs: "Apenas la recibamos retomamos el pedido de inmediato.", solutionEn: "As soon as we receive it we will resume the order right away." },
  { key: "NUESTRA", label: "Demora nuestra", cause: "OTHER", active: true,
    explainEs: "Tuvimos una demora de nuestra parte en la gestión de su pedido, y le ofrecemos disculpas por ello.", explainEn: "We had a delay on our side in handling your order, and we apologise for it.",
    solutionEs: "Su pedido ya tiene una persona responsable de principio a fin hasta la entrega.", solutionEn: "Your order now has one person in charge from start to finish until delivery." },
  { key: "OTRA", label: "Otra causa", cause: "OTHER", active: true, explainEs: "", explainEn: "", solutionEs: "", solutionEn: "" },
];

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** What the administrator saved, made safe: unique keys, a name on every tag, a known cause family. */
export function cleanDelayTags(raw: unknown): DelayTag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DelayTag[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const label = clean(r.label, 90);
    if (!label) continue;
    let key = clean(r.key, 30).toUpperCase().replace(/[^A-Z0-9_]/g, "");
    if (!key) key = label.normalize("NFD").replace(/[^A-Za-z0-9 ]/g, "").trim().toUpperCase().replace(/\s+/g, "_").slice(0, 24) || "ETIQUETA";
    while (seen.has(key)) key = `${key.slice(0, 26)}_${seen.size}`;
    seen.add(key);
    const cause = DELAY_CAUSES.includes(r.cause as DelayCause) ? (r.cause as DelayCause) : "OTHER";
    out.push({ key, label, cause, explainEs: clean(r.explainEs, 500), explainEn: clean(r.explainEn, 500), solutionEs: clean(r.solutionEs, 500), solutionEn: clean(r.solutionEn, 500), active: r.active !== false });
    if (out.length >= MAX_DELAY_TAGS) break;
  }
  return out;
}

export const tagText = (tag: DelayTag | undefined, lang: "ES" | "EN") => ({
  explain: !tag ? "" : lang === "EN" ? tag.explainEn || tag.explainEs : tag.explainEs || tag.explainEn,
  solution: !tag ? "" : lang === "EN" ? tag.solutionEn || tag.solutionEs : tag.solutionEs || tag.solutionEn,
});

const longDay = (iso: string, lang: "ES" | "EN") => {
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(lang === "EN" ? "en-US" : "es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
};
const dot = (s: string) => { const v = s.trim(); return !v ? "" : /[.!?…]$/.test(v) ? v : `${v}.`; };

export type OtherCase = { id: string; code: string; what: string; status: string };
export type DelayMailInput = {
  lang: "ES" | "EN"; contactName: string | null; code: string | null; customerPo: string | null; what: string;
  /** yyyy-mm-dd */
  promised: string | null; newDate: string | null; explain: string; solution: string; others: OtherCase[]; sender: string; from: string;
};

/** The email to the customer: what happened, what we are doing, the new date, and the state of their other cases. */
export function delayMail(o: DelayMailInput): { subject: string; text: string } {
  const en = o.lang === "EN";
  const ref = [o.code, o.customerPo ? (en ? `your PO ${o.customerPo}` : `su orden ${o.customerPo}`) : null].filter(Boolean).join(" · ");
  const L: string[] = [];
  L.push(en ? (o.contactName ? `Good day ${o.contactName},` : "Good day,") : o.contactName ? `Buen día ${o.contactName}:` : "Buen día:", "");
  L.push(en
    ? `I am writing about your order${ref ? ` ${ref}` : ""}: ${dot(o.what)} I prefer that you hear this from us directly: ${o.promised ? `we will not be able to deliver it on ${longDay(o.promised, "EN")}, as we had committed.` : "we will not be able to deliver it on the date we had committed."}`
    : `Le escribo sobre su pedido${ref ? ` ${ref}` : ""}: ${dot(o.what)} Prefiero que lo sepa directamente por nosotros: ${o.promised ? `no vamos a poder entregarlo el ${longDay(o.promised, "ES")}, como nos habíamos comprometido.` : "no vamos a poder entregarlo en la fecha que nos habíamos comprometido."}`, "");
  if (o.explain.trim()) L.push(en ? `What happened: ${dot(o.explain)}` : `Qué pasó: ${dot(o.explain)}`, "");
  if (o.solution.trim()) L.push(en ? `What we are doing: ${dot(o.solution)}` : `Qué estamos haciendo: ${dot(o.solution)}`, "");
  L.push(o.newDate
    ? en ? `New delivery date: ${longDay(o.newDate, "EN")}. If this date affects your operation, please tell me and we will look for an alternative together.` : `Nueva fecha de entrega: ${longDay(o.newDate, "ES")}. Si esta fecha afecta su operación, cuénteme y buscamos juntos una alternativa.`
    : en ? "I will confirm the new delivery date to you as soon as I have it." : "Le confirmaré la nueva fecha de entrega apenas la tenga.", "");
  if (o.others.length) {
    L.push(en ? "While I am writing, here is where your other open requests stand:" : "Aprovecho para contarle cómo van sus otras solicitudes abiertas:");
    for (const c of o.others) L.push(`·  ${[c.code, c.what].filter(Boolean).join(" – ")}: ${dot(c.status)}`);
    L.push("");
  }
  L.push(en ? "Thank you for your patience. I remain attentive to any question." : "Gracias por su paciencia. Quedo atento a cualquier inquietud.", "");
  L.push(en ? "Best regards," : "Saludos cordiales,", "", o.sender, COMPANY.legalName, `${o.from} · ${COMPANY.phone}`);
  const subject = en
    ? `Update on your order${o.code ? ` ${o.code}` : ""}: new delivery date${o.customerPo ? ` (PO ${o.customerPo})` : ""}`
    : `Novedad en su pedido${o.code ? ` ${o.code}` : ""}: nueva fecha de entrega${o.customerPo ? ` (OC ${o.customerPo})` : ""}`;
  return { subject: subject.slice(0, 250), text: L.join("\n") };
}
