// Vocabulary for finding spare parts: Spanish/English names, product lines and brands.
// Sources: the product lines of importsoluciones.com and the brands on indsolusa.com/marcas-y-referencias.
// Shared by the Localization search, the parts catalog and (later) emails and the calendar.

export const CATEGORIES: Record<string, { es: string; en: string }> = {
  MECANICA: { es: "Mecánica", en: "Mechanical" },
  ELECTRONICA: { es: "Electrónica", en: "Electronics" },
  ELECTRICA: { es: "Eléctrica", en: "Electrical" },
  NEUMATICA: { es: "Neumática", en: "Pneumatics" },
  HIDRAULICA: { es: "Hidráulica", en: "Hydraulics" },
  METROLOGIA: { es: "Metrología", en: "Metrology" },
  AUTOMATIZACION: { es: "Automatización", en: "Automation" },
  LUBRICACION: { es: "Lubricación", en: "Lubrication" },
  INSTRUMENTAL: { es: "Instrumental", en: "Instrumentation" },
};

// Each group: words that mean the same part, in Spanish and English, plus its usual product line.
export const SYNONYMS: { words: string[]; cat: keyof typeof CATEGORIES }[] = [
  { words: ["rodamiento", "rulimán", "ruliman", "balero", "cojinete", "bearing", "ball bearing"], cat: "MECANICA" },
  { words: ["chumacera", "soporte de rodamiento", "pillow block", "bearing unit", "housing"], cat: "MECANICA" },
  { words: ["sello", "sello mecánico", "seal", "mechanical seal"], cat: "MECANICA" },
  { words: ["retenedor", "estopera", "oil seal", "shaft seal", "lip seal"], cat: "MECANICA" },
  { words: ["empaque", "junta", "o-ring", "oring", "anillo", "gasket"], cat: "MECANICA" },
  { words: ["correa", "banda", "belt", "v-belt", "timing belt"], cat: "MECANICA" },
  { words: ["cadena", "chain", "roller chain"], cat: "MECANICA" },
  { words: ["piñón", "pinon", "sprocket", "engranaje", "gear"], cat: "MECANICA" },
  { words: ["acople", "acoplamiento", "coupling"], cat: "MECANICA" },
  { words: ["reductor", "motorreductor", "caja reductora", "gearbox", "gear reducer", "gearmotor"], cat: "MECANICA" },
  { words: ["guía lineal", "guia lineal", "patín", "patin", "linear guide", "linear rail", "carriage", "block"], cat: "MECANICA" },
  { words: ["husillo", "tornillo de bolas", "ball screw", "lead screw"], cat: "MECANICA" },
  { words: ["cadena portacables", "portacables", "cable carrier", "energy chain", "drag chain"], cat: "MECANICA" },
  { words: ["ventilador", "fan", "blower", "extractor"], cat: "ELECTRICA" },
  { words: ["motor", "motor eléctrico", "electric motor"], cat: "ELECTRICA" },
  { words: ["variador", "variador de frecuencia", "drive", "vfd", "inverter", "frequency converter", "ac drive"], cat: "AUTOMATIZACION" },
  { words: ["servomotor", "servo motor", "servo"], cat: "AUTOMATIZACION" },
  { words: ["servodrive", "servo drive", "servoamplificador", "servo amplifier"], cat: "AUTOMATIZACION" },
  { words: ["plc", "autómata", "controlador lógico", "programmable controller"], cat: "AUTOMATIZACION" },
  { words: ["módulo", "modulo", "tarjeta", "card", "module", "i/o module"], cat: "AUTOMATIZACION" },
  { words: ["pantalla", "hmi", "panel de operador", "touch panel", "operator panel"], cat: "AUTOMATIZACION" },
  { words: ["encoder", "codificador", "rotary encoder"], cat: "AUTOMATIZACION" },
  { words: ["sensor", "detector", "sensor inductivo", "inductive sensor", "proximity sensor", "proximity switch"], cat: "AUTOMATIZACION" },
  { words: ["fotocelda", "sensor fotoeléctrico", "photoelectric sensor", "photo eye"], cat: "AUTOMATIZACION" },
  { words: ["contactor", "contactor"], cat: "ELECTRICA" },
  { words: ["relé", "rele", "relevo", "relay"], cat: "ELECTRICA" },
  { words: ["breaker", "interruptor", "disyuntor", "guardamotor", "circuit breaker", "motor protector"], cat: "ELECTRICA" },
  { words: ["fusible", "fuse"], cat: "ELECTRICA" },
  { words: ["fuente", "fuente de poder", "fuente de alimentación", "power supply", "psu"], cat: "ELECTRONICA" },
  { words: ["transformador", "transformer"], cat: "ELECTRICA" },
  { words: ["borne", "bornera", "terminal", "terminal block"], cat: "ELECTRICA" },
  { words: ["cable", "conector", "connector", "cordset"], cat: "ELECTRICA" },
  { words: ["tarjeta electrónica", "placa electrónica", "pcb", "circuit board", "board"], cat: "ELECTRONICA" },
  { words: ["condensador", "capacitor"], cat: "ELECTRONICA" },
  { words: ["cilindro", "pistón neumático", "cylinder", "pneumatic cylinder"], cat: "NEUMATICA" },
  { words: ["electroválvula", "electrovalvula", "solenoide", "solenoid valve", "valve"], cat: "NEUMATICA" },
  { words: ["válvula", "valvula", "valve"], cat: "HIDRAULICA" },
  { words: ["unidad de mantenimiento", "frl", "filtro regulador", "filter regulator", "air prep"], cat: "NEUMATICA" },
  { words: ["racor", "acople rápido", "fitting", "quick coupling", "push-in fitting"], cat: "NEUMATICA" },
  { words: ["manguera", "hose", "tubing", "tubo"], cat: "HIDRAULICA" },
  { words: ["bomba", "pump", "bomba hidráulica", "hydraulic pump"], cat: "HIDRAULICA" },
  { words: ["bomba dosificadora", "dosing pump", "metering pump"], cat: "HIDRAULICA" },
  { words: ["filtro", "elemento filtrante", "filter", "filter element", "cartucho", "cartridge"], cat: "HIDRAULICA" },
  { words: ["intercambiador", "intercambiador de calor", "heat exchanger", "plate heat exchanger"], cat: "MECANICA" },
  { words: ["manómetro", "manometro", "pressure gauge", "gauge"], cat: "INSTRUMENTAL" },
  { words: ["presostato", "pressure switch"], cat: "INSTRUMENTAL" },
  { words: ["transmisor", "transmisor de presión", "transmitter", "pressure transmitter"], cat: "INSTRUMENTAL" },
  { words: ["termocupla", "termopar", "thermocouple"], cat: "INSTRUMENTAL" },
  { words: ["rtd", "pt100", "sonda de temperatura", "temperature probe", "temperature sensor"], cat: "INSTRUMENTAL" },
  { words: ["caudalímetro", "caudalimetro", "flujómetro", "flow meter", "flowmeter"], cat: "INSTRUMENTAL" },
  { words: ["nivel", "sensor de nivel", "level sensor", "level switch"], cat: "INSTRUMENTAL" },
  { words: ["multímetro", "multimetro", "multimeter", "pinza amperimétrica", "clamp meter"], cat: "METROLOGIA" },
  { words: ["calibrador", "pie de rey", "caliper", "vernier"], cat: "METROLOGIA" },
  { words: ["micrómetro", "micrometro", "micrometer"], cat: "METROLOGIA" },
  { words: ["cámara termográfica", "termógrafo", "thermal camera", "thermal imager"], cat: "METROLOGIA" },
  { words: ["grasa", "grease"], cat: "LUBRICACION" },
  { words: ["aceite", "lubricante", "oil", "lubricant"], cat: "LUBRICACION" },
  { words: ["lubricador", "engrasador", "lubricator", "grease gun"], cat: "LUBRICACION" },
  { words: ["lámpara uv", "lampara uv", "uv lamp", "uv sterilizer"], cat: "INSTRUMENTAL" },
];

// Brands seen on indsolusa.com (partial list there: "estas son solo algunas"), with other spellings.
export const BRANDS: { name: string; also: string[] }[] = [
  { name: "ABB", also: [] },
  { name: "Alfa Laval", also: ["alfalaval"] },
  { name: "Aquafine", also: [] },
  { name: "Baumer", also: [] },
  { name: "Bosch Rexroth", also: ["rexroth", "indramat"] },
  { name: "Bosch", also: [] },
  { name: "Cummins", also: [] },
  { name: "Danfoss", also: [] },
  { name: "Dwyer", also: [] },
  { name: "Eaton", also: ["cutler hammer", "moeller", "vickers"] },
  { name: "ebm-papst", also: ["ebmpapst", "ebm papst", "papst"] },
  { name: "FANUC", also: ["fanuc robocut", "robocut"] },
  { name: "Festo", also: [] },
  { name: "Fluke", also: [] },
  { name: "Hubbell", also: [] },
  { name: "ifm", also: ["ifm electronic", "efector"] },
  { name: "igus", also: [] },
  { name: "Johnson Controls", also: ["jci", "johnson control"] },
  { name: "Lenze", also: [] },
  { name: "Omron", also: [] },
  { name: "Parker", also: ["parker hannifin"] },
  { name: "Pepperl+Fuchs", also: ["pepperl fuchs", "pepperl and fuchs", "p+f"] },
  { name: "Rexnord", also: ["falk", "link-belt"] },
  { name: "Rossi", also: [] },
  { name: "SANYO DENKI", also: ["sanyo denki", "sanyodenki", "sanmotion"] },
  { name: "Schneider Electric", also: ["schneider", "telemecanique", "square d"] },
  { name: "Siemens", also: ["sinamics", "simatic", "sitop", "micromaster"] },
  { name: "SKF", also: [] },
  { name: "SMC", also: [] },
  { name: "THK", also: [] },
  { name: "WAGO", also: [] },
  { name: "Wenglor", also: [] },
  { name: "Allen-Bradley", also: ["allen bradley", "rockwell", "ab"] },
  { name: "Grundfos", also: [] },
  { name: "Spellman", also: [] },
  { name: "Mitsubishi Electric", also: ["mitsubishi"] },
  { name: "Yaskawa", also: [] },
  { name: "Endress+Hauser", also: ["endress hauser", "e+h"] },
];

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Brand named in a free text ("Variador Siemens G120" → "Siemens"), longest name first. */
export function brandIn(text: string): string | undefined {
  const t = ` ${fold(text).replace(/[^a-z0-9+ ]/g, " ")} `;
  const all = BRANDS.flatMap((b) => [b.name, ...b.also].map((n) => ({ b: b.name, n: fold(n) }))).sort((x, y) => y.n.length - x.n.length);
  return all.find((x) => x.n.length > 2 && t.includes(` ${x.n} `))?.b ?? all.find((x) => x.n.length <= 2 && t.includes(` ${x.n} `) && x.n !== "ab")?.b;
}

/** Product line suggested by the words in a description. */
export function categoryIn(text: string): keyof typeof CATEGORIES | undefined {
  const t = ` ${fold(text)} `;
  const hit = SYNONYMS.flatMap((g) => g.words.map((w) => ({ w: fold(w), cat: g.cat }))).sort((a, b) => b.w.length - a.w.length).find((x) => t.includes(` ${x.w} `) || t.includes(` ${x.w}s `) || t.includes(` ${x.w}es `));
  return hit?.cat;
}

/** All the ways to say each word of the query, so "rodamiento" also finds "bearing". */
// Words that say what the person wants (urgency, price, replacement) or are filler: they aren't part of the part's description.
const NOT_DESCRIPTIVE = new Set(["urgente", "urgent", "hoy", "today", "parado", "parada", "linea", "line", "down", "asap", "mismo", "emergencia",
  "equivalente", "reemplazo", "sustituto", "alternativo", "alternativa", "compatible", "cruce", "cross", "replacement", "substitute", "equivalent", "interchange",
  "precio", "cotizar", "cotizacion", "cuanto", "cuesta", "price", "quote", "cost", "necesito", "busco", "need", "para", "con", "the", "for", "with", "una", "uno", "del", "las", "los"]);

// Describing words (what kind, what it measures, what it's made of), Spanish ↔ English. Used only to widen a search.
const ATTRIBUTES: string[][] = [
  ["presion", "pressure"], ["temperatura", "temperature"], ["nivel", "level"], ["caudal", "flujo", "flow"], ["velocidad", "speed"],
  ["sanitaria", "sanitario", "sanitary", "higienica", "hygienic"], ["centrifuga", "centrifugo", "centrifugal"], ["diafragma", "membrana", "diaphragm"],
  ["dosificadora", "dosificacion", "dosing", "metering"], ["sumergible", "submersible"], ["vacio", "vacuum"], ["acero inoxidable", "inoxidable", "inox", "stainless"],
  ["repuesto", "spare", "spare part"], ["kit", "kit"], ["mantenimiento", "maintenance"], ["impulsor", "impeller"], ["eje", "shaft"], ["carcasa", "housing"],
  ["trifasico", "three phase", "3ph"], ["monofasico", "single phase"], ["agua", "water"], ["aceite", "oil"], ["aire", "air"], ["lodos", "sludge", "slurry"],
  ["enfriamiento", "refrigeracion", "cooling"], ["alta", "high"], ["baja", "low"], ["digital", "digital"], ["analogico", "analog"], ["inalambrico", "wireless"],
];

export function expandWords(q: string): { word: string; alts: string[] }[] {
  const words = fold(q).split(/[^a-z0-9+/-]+/).filter((w) => w.length > 2 && !NOT_DESCRIPTIVE.has(w));
  return words.map((w) => {
    // A word can belong to several groups ("pressure" → gauge, switch, transmitter): use them all.
    const exact = SYNONYMS.filter((s) => s.words.some((x) => fold(x) === w));
    const groups = exact.length ? exact : SYNONYMS.filter((s) => s.words.some((x) => fold(x).split(" ").includes(w)));
    const attr = ATTRIBUTES.filter((xs) => xs.some((x) => x === w || x.split(" ").includes(w))).flat();
    return { word: w, alts: [...new Set([w, ...groups.flatMap((g) => g.words.map(fold)), ...attr])] };
  });
}

export type Intent = "URGENT" | "PRICE" | "COMPAT" | "FIND";
/** What the person is trying to do, from the words they used (no AI). */
export function intentOf(q: string): Intent {
  const t = fold(q);
  if (/\b(urgente|urgent|hoy|today|parad[ao]|linea parada|line down|asap|ya mismo|emergencia)\b/.test(t)) return "URGENT";
  if (/\b(equivalente|reemplazo|sustituto|alternativ[ao]|compatible|cruce|cross|replacement|substitute|equivalent|interchange)\b/.test(t)) return "COMPAT";
  if (/\b(precio|cotiza|cuanto|cuesta|price|quote|cost)\b/.test(t)) return "PRICE";
  return "FIND";
}
