import { addDays, today } from "./domain";

// Communication Intelligence: what SOLU understood from a customer's messages.
// Rule: FACT = the customer said it (with the exact words as evidence).
//       INFERENCE = SOLU deduced it (with its reasoning). A person confirms or corrects.
// No AI model is connected yet: these are transparent rules, and SOLU says what it cannot read (photos).

export type Basis = "FACT" | "INFERENCE";
export type Field = "product" | "reference" | "qty" | "result" | "date" | "urgency" | "journey";
export type Understood = { field: Field; value: string; basis: Basis; evidence: string; reasoning?: string };

export type UnderstandInput = {
  messages: { body: string; sentAt: Date; hasPhoto: boolean }[];
  accountName?: string | null;
  pastItems: { code: string | null; description: string; dealCode: string | null }[];
  openDeals: { id: string; code: string | null; title: string; items: string[] }[];
  now?: Date;
};

const PRODUCTS: { re: RegExp; singular: string; plural: string }[] = [
  { re: /variador(es)?(\s+de\s+frecuencia)?/i, singular: "variador de frecuencia", plural: "variadores de frecuencia" },
  { re: /bomba(s)?/i, singular: "bomba", plural: "bombas" },
  { re: /motorreductor(es)?/i, singular: "motorreductor", plural: "motorreductores" },
  { re: /servomotor(es)?|servo(s)?\b/i, singular: "servomotor", plural: "servomotores" },
  { re: /motor(es)?/i, singular: "motor", plural: "motores" },
  { re: /rodamiento(s)?/i, singular: "rodamiento", plural: "rodamientos" },
  { re: /sello(s)?(\s+mec[aá]nicos?)?/i, singular: "sello mecánico", plural: "sellos mecánicos" },
  { re: /transmisor(es)?/i, singular: "transmisor", plural: "transmisores" },
  { re: /v[aá]lvula(s)?/i, singular: "válvula", plural: "válvulas" },
  { re: /reductor(es)?/i, singular: "reductor", plural: "reductores" },
  { re: /(plc|controlador(es)?)/i, singular: "PLC", plural: "PLC" },
];

const WORD_NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, a: 1 };
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Short quote around a match, for evidence. */
function quote(text: string, idx: number, len: number) {
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, idx - 30)));
  const end = Math.min(text.length, text.indexOf(" ", idx + len + 30) === -1 ? text.length : text.indexOf(" ", idx + len + 30));
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addBusinessDays(d: Date, n: number) {
  let r = d;
  let left = n;
  while (left > 0) {
    r = addDays(r, 1);
    const wd = r.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return r;
}

export function understand(input: UnderstandInput): Understood[] {
  const now = input.now ?? today();
  const inbound = input.messages.filter((m) => m.body.trim() || m.hasPhoto);
  const text = inbound.map((m) => m.body).join("\n");
  const photo = inbound.some((m) => m.hasPhoto);
  const out: Understood[] = [];

  // ---- Product and quantity (what the customer literally asked for) ----
  let product: (typeof PRODUCTS)[number] | null = null;
  let productIdx = -1;
  let productLen = 0;
  for (const p of PRODUCTS) {
    const m = p.re.exec(text);
    if (m && (productIdx === -1 || m.index < productIdx)) {
      product = p;
      productIdx = m.index;
      productLen = m[0].length;
    }
  }
  let qty: number | null = null;
  if (product) {
    const before = text.slice(Math.max(0, productIdx - 14), productIdx).toLowerCase();
    const raw = /(?:^|\s)(\d{1,4}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)\s+$/.exec(before)?.[1];
    if (raw) qty = /^\d+$/.test(raw) ? Number(raw) : WORD_NUM[raw] ?? null;
    out.push({
      field: "product",
      // A fact keeps the customer's own word ("variadores"), not SOLU's longer name for it.
      value: text.slice(productIdx, productIdx + productLen).toLowerCase(),
      basis: "FACT",
      evidence: quote(text, productIdx, productLen),
    });
    if (qty) out.push({ field: "qty", value: String(qty), basis: "FACT", evidence: quote(text, Math.max(0, productIdx - 6), productLen + 6) });
  }

  // ---- Reference: a model code written in the message is a fact; a photo is not read by SOLU ----
  const code = /\b(?=[A-Z0-9.\-/]*\d)(?=[A-Z0-9.\-/]*[A-Z])[A-Z0-9][A-Z0-9.\-/]{5,}\b/.exec(text);
  if (code) {
    out.push({ field: "reference", value: code[0], basis: "FACT", evidence: quote(text, code.index, code[0].length) });
  } else if (product) {
    const word = product.singular.split(" ")[0].toLowerCase();
    const past = input.pastItems.find((it) => it.description.toLowerCase().includes(word));
    if (past) {
      out.push({
        field: "reference",
        value: `${past.description}${past.code ? ` (${past.code})` : ""}`,
        basis: "INFERENCE",
        evidence: photo ? "Foto de placa recibida" : `Historial de ${input.accountName ?? "el cliente"}`,
        reasoning: `${input.accountName ?? "El cliente"} compró este modelo${past.dealCode ? ` en ${past.dealCode}` : ""}. ${photo ? "SOLU todavía no lee fotos: confirma mirando la placa." : "Puede ser otro modelo: confírmalo."}`,
      });
    } else if (photo) {
      out.push({ field: "reference", value: "Por leer en la foto de la placa", basis: "INFERENCE", evidence: "Foto de placa recibida", reasoning: "SOLU todavía no lee fotos. La referencia exacta define qué cotizar: escríbela mirando la placa." });
    }
  }

  // ---- Urgency ----
  const urg = /(con urgencia|urgente|urge\b|lo antes posible|para ya|cuanto antes|asap|se nos par[oó]|se par[oó]|est[aá] parad[ao]|parada de (la )?l[ií]nea)/i.exec(text);
  if (urg) out.push({ field: "urgency", value: "Urgente", basis: "FACT", evidence: quote(text, urg.index, urg[0].length) });

  // ---- Date: explicit words are facts; an urgency without a date is an inference ----
  let dateFound = false;
  const tests: { re: RegExp; at: (m: RegExpExecArray) => Date | null }[] = [
    { re: /\bhoy\b/i, at: () => now },
    { re: /\bpasado mañana\b/i, at: () => addDays(now, 2) },
    { re: /\bmañana\b/i, at: () => addDays(now, 1) },
    {
      re: /\b(el |este |próximo |para el )?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado)\b/i,
      at: (m) => {
        const name = m[2].toLowerCase().replace("miercoles", "miércoles").replace("sabado", "sábado");
        const target = WEEKDAYS.indexOf(name);
        let diff = (target - now.getUTCDay() + 7) % 7;
        if (diff === 0) diff = 7;
        return addDays(now, diff);
      },
    },
    {
      re: /\b(antes del|para el|el d[ií]a)\s+(\d{1,2})(\s+de\s+[a-záéíóú]+)?\b/i,
      at: (m) => {
        const day = Number(m[2]);
        if (day < 1 || day > 31) return null;
        let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
        if (d < now) d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
        return d;
      },
    },
    {
      re: /\b(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?\b/,
      at: (m) => {
        const y = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : now.getUTCFullYear();
        const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
        return isNaN(d.getTime()) ? null : d;
      },
    },
  ];
  for (const tst of tests) {
    const m = tst.re.exec(text);
    if (!m) continue;
    const d = tst.at(m);
    if (!d) continue;
    out.push({ field: "date", value: iso(d), basis: "FACT", evidence: quote(text, m.index, m[0].length), reasoning: "El cliente lo dijo; SOLU lo convirtió en fecha." });
    dateFound = true;
    break;
  }
  if (!dateFound && urg) {
    out.push({
      field: "date",
      value: iso(addBusinessDays(now, 2)),
      basis: "INFERENCE",
      evidence: quote(text, urg.index, urg[0].length),
      reasoning: "Dijo que es urgente pero no dio fecha. SOLU supone 2 días hábiles: confírmalo con el cliente.",
    });
  }

  // ---- Desired result: never literal unless the customer states it ----
  const stop = /(se (nos )?par[oó]|est[aá] parad[ao]|parada|fall[oó]|se (da[nñ][oó]|quem[oó])|no arranca|no funciona)/i.exec(text);
  const where = /(l[ií]nea\s*\d*(\s+de\s+[a-záéíóú]+)?|planta|m[aá]quina|molino|caldera|envasadora|mezcladora|extrusora|compresor)/i.exec(text);
  if (product || stop) {
    const target = where ? where[0].replace(/\s+/g, " ").trim().toLowerCase() : null;
    const art = target ? (/^(molino|compresor)/.test(target) ? "el" : "la") : "el";
    const de = art === "el" ? "del" : "de la";
    out.push({
      field: "result",
      value: stop
        ? `Que ${target ? `${art} ${target}` : "el equipo"} vuelva a operar`
        : `Reponer ${product ? product.plural : "el equipo"}${target ? ` ${de} ${target}` : ""} sin interrumpir la operación`,
      basis: "INFERENCE",
      evidence: stop ? quote(text, stop.index, stop[0].length) : quote(text, productIdx, productLen),
      reasoning: stop ? "Dijo que algo se paró o falló; el resultado que busca es volver a operar." : "No dijo para qué; SOLU supone reposición. Pregúntale qué necesita lograr.",
    });
  }

  // ---- Journey: an open one with the same product, or a new one ----
  if (product) {
    const word = product.singular.split(" ")[0].toLowerCase();
    const match = input.openDeals.find((d) => `${d.title} ${d.items.join(" ")}`.toLowerCase().includes(word));
    out.push(
      match
        ? { field: "journey", value: `${match.code ?? ""} ${match.title}`.trim(), basis: "INFERENCE", evidence: `Journey abierto con ${word}`, reasoning: "Habla del mismo tipo de producto que un Journey abierto; puede ser parte de él." }
        : { field: "journey", value: "Nuevo Journey", basis: "INFERENCE", evidence: "Sin Journey abierto con este producto", reasoning: "No hay un Journey abierto de este cliente con este producto." },
    );
  }
  return out;
}

/** What is still missing to quote with confidence. */
export function missingInfo(items: { field: string; basis: string; status: string }[]) {
  const ok = (f: string) => items.some((x) => x.field === f && (x.basis === "FACT" || x.status === "CONFIRMED" || x.status === "CORRECTED"));
  const miss: { field: string; es: string; en: string }[] = [];
  if (!ok("reference")) miss.push({ field: "reference", es: "Referencia exacta (modelo, potencia)", en: "Exact reference (model, power)" });
  if (!ok("qty")) miss.push({ field: "qty", es: "Cantidad", en: "Quantity" });
  if (!ok("date")) miss.push({ field: "date", es: "Fecha en que lo necesita", en: "Date they need it" });
  if (!ok("result")) miss.push({ field: "result", es: "Qué necesita lograr", en: "What they need to achieve" });
  return miss;
}

/** Reply draft for the customer: thanks, what we understood, only the questions that matter, next step. */
export function draftReply(o: {
  firstName: string;
  me: string;
  items: { field: string; value: string; basis: string; status: string }[];
  lang?: "ES" | "EN";
}) {
  const get = (f: string) => o.items.find((x) => x.field === f && x.status !== "REJECTED");
  const confirmed = (f: string) => {
    const it = get(f);
    return !!it && (it.basis === "FACT" || it.status === "CONFIRMED" || it.status === "CORRECTED");
  };
  const product = get("product")?.value;
  const qty = get("qty")?.value;
  const urgent = !!get("urgency");
  const result = get("result");
  const asks: string[] = [];
  if (!confirmed("reference")) asks.push("¿me confirmas la referencia que aparece en la placa (modelo y potencia en kW o HP)?");
  if (!confirmed("qty") && product) asks.push("¿cuántas unidades necesitas?");
  if (!confirmed("date")) asks.push(urgent ? "¿para qué día y hora los necesitas en planta?" : "¿para qué fecha los necesitas?");
  const understood = product
    ? `Entendí que necesitas ${qty ? `${qty} ` : ""}${product}${urgent ? " con urgencia" : ""}${result && confirmed("result") ? `, para ${result.value.charAt(0).toLowerCase()}${result.value.slice(1)}` : ""}.`
    : "Recibí tu mensaje.";
  const ref = get("reference");
  const refLine = ref && confirmed("reference") ? ` Lo cotizo sobre la referencia ${ref.value}.` : "";
  const ask = asks.length ? ` Para cotizarte lo correcto, ${asks.join(" Y ")}` : "";
  return `Hola ${o.firstName}, gracias por escribirnos. ${understood}${refLine}${ask}\n\nHoy te confirmo disponibilidad y plazo de entrega.\n\n${o.me} · Industry Solutions`;
}
