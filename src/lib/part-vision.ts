import { aiJson } from "@/lib/ai";
import { CATEGORIES } from "@/lib/part-lexicon";

// Search by photo: Claude reads the nameplate / markings and recognizes what kind of part it is.
// The result is a reading, not a confirmation: SOLU shows it as "unconfirmed" and searches the catalog with it.
// The photo itself is not stored.

export type PhotoReading = {
  partNumbers: string[];
  brand: string | null;
  model: string | null;
  partType: string;
  partTypeEn: string;
  category: string | null;
  specs: string[];
  source: "NAMEPLATE" | "MARKINGS" | "APPEARANCE" | "UNCLEAR";
  note: string;
};

export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_PHOTO_BYTES = 3_500_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["partNumbers", "brand", "model", "partType", "partTypeEn", "category", "specs", "source", "note"],
  properties: {
    partNumbers: { type: "array", items: { type: "string" }, description: "Part / order / catalog numbers exactly as printed (MLFB, P/N, Art.-Nr., Type, Cat. No.), most specific first. Empty if none is legible." },
    brand: { type: ["string", "null"], description: "Manufacturer brand as printed or clearly identifiable from the logo; null if unsure." },
    model: { type: ["string", "null"], description: "Product family / model name if printed (e.g. SINAMICS G120C, Sitrans P DS III)." },
    partType: { type: "string", description: "What the part is, in Spanish, 1-4 words (e.g. 'variador de frecuencia', 'rodamiento de bolas')." },
    partTypeEn: { type: "string", description: "Same in English." },
    category: { type: "string", enum: [...Object.keys(CATEGORIES), "NONE"], description: "Product line; NONE if unclear." },
    specs: { type: "array", items: { type: "string" }, description: "Up to 6 key ratings read from the plate, e.g. '7.5 kW', '380-480 V', '1450 rpm', 'IP55'." },
    source: { type: "string", enum: ["NAMEPLATE", "MARKINGS", "APPEARANCE", "UNCLEAR"], description: "NAMEPLATE if read from a label/plate, MARKINGS if engraved/printed on the part, APPEARANCE if only recognized by shape, UNCLEAR if you can't tell." },
    note: { type: "string", description: "One short sentence in Spanish for a sales rep: what you read and anything doubtful (blurry digits, partly hidden)." },
  },
};

const SYSTEM = `You help an industrial spare-parts distributor identify parts from photos sent by customers (often from WhatsApp, sometimes blurry or at an angle).
Read every legible part number, brand and rating on nameplates, labels and markings. Copy numbers character by character; never invent or complete a number you cannot read — leave it out and mention it in the note.
If there is no legible text, identify the kind of part from its appearance and say so (source APPEARANCE).
If the photo is not an industrial part, return empty partNumbers, partType "no identificado" and explain in the note.`;

export async function readPartPhoto(bytes: Buffer, mime: (typeof PHOTO_MIMES)[number], userName?: string) {
  return aiJson<PhotoReading>({
    feature: "PART_PHOTO",
    userName,
    system: SYSTEM,
    schema: SCHEMA,
    content: [
      { type: "image", source: { type: "base64", media_type: mime, data: bytes.toString("base64") } },
      { type: "text", text: "Identify this part." },
    ],
  });
}

/** The catalog query built from a reading: numbers first, else brand + type + model. */
export function queryFromReading(r: PhotoReading) {
  if (r.partNumbers.length) return r.partNumbers.slice(0, 3).join(" ");
  return [r.brand, r.model, r.partType !== "no identificado" ? r.partType : null].filter(Boolean).join(" ").trim();
}
