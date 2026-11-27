// The description of a piece, in the language of the email it goes in (owner, 2026-11-27: "the piece description is
// in spanish, and it does not translate with the email" and, the same day, "lo importante es que la descripción esté
// en el idioma del correo para evitar confusiones"). Every template email that lists pieces passes through here.
// Each text is translated once per language and kept (PieceText), so opening or sending again asks nothing.
import { createHash } from "node:crypto";
import { db } from "./db";
import { aiConfigured, aiJson } from "./ai";
import type { MailLang } from "./email-templates";
import type { RfqItem } from "./rfq";

const keyOf = (lang: MailLang, text: string) => `${lang}:${createHash("sha1").update(text).digest("hex").slice(0, 24)}`;
const SYSTEM = (lang: MailLang) => `You translate short technical descriptions of industrial spare parts and instruments. They go into a business email about that piece (a request for quotation, a quote, an order), so the reader must be able to recognise the piece.

Translate each numbered text into ${lang === "EN" ? "English" : "Spanish"}, with the technical terms a distributor of that kind of piece uses. If a text is already in that language, give it back unchanged.

Keep exactly as written: part numbers, order codes, model and series names, brand names, standards, units and every value. Do not add, remove, summarise or explain anything, and keep the order of the details.`;

/** Gives the texts back in `lang`. Anything that cannot be translated right now comes back as it was. */
export async function piecesIn(lang: MailLang, texts: string[], userName?: string): Promise<string[]> {
  const clean = texts.map((t) => t.trim());
  try {
    // A text with no letters (a dash, a number) has nothing to translate.
    const wanted = [...new Set(clean.filter((t) => t.length >= 4 && /\p{L}{3}/u.test(t)))];
    if (!wanted.length) return clean;
    const have = new Map((await db.pieceText.findMany({ where: { key: { in: wanted.map((t) => keyOf(lang, t)) } }, select: { key: true, text: true } })).map((r) => [r.key, r.text]));
    const missing = wanted.filter((t) => !have.has(keyOf(lang, t)));
    if (missing.length && aiConfigured()) {
      const out = await Promise.race([
        aiJson<{ items: { n: number; text: string }[] }>({
          feature: "mail-translate", userName, system: SYSTEM(lang),
          content: [{ type: "text", text: missing.map((t, n) => `${n + 1}. ${t}`).join("\n") }],
          schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "text"], properties: { n: { type: "integer" }, text: { type: "string" } } } } } },
          maxTokens: 6000,
        }),
        new Promise<null>((r) => setTimeout(() => r(null), 25_000)),
      ]);
      const fresh: { key: string; text: string }[] = [];
      for (const it of out?.items ?? []) {
        const src = missing[it.n - 1]; const t = typeof it.text === "string" ? it.text.replace(/\s+/g, " ").trim() : "";
        // A translation that lost most of the text, or grew out of proportion, is not trusted.
        if (src && t && t.length >= src.length * 0.4 && t.length <= src.length * 2.5 + 40 && !have.has(keyOf(lang, src))) {
          have.set(keyOf(lang, src), t.slice(0, 2000)); fresh.push({ key: keyOf(lang, src), text: t.slice(0, 2000) });
        }
      }
      if (fresh.length) await db.pieceText.createMany({ data: fresh, skipDuplicates: true });
    }
    return clean.map((t) => have.get(keyOf(lang, t)) ?? t);
  } catch {
    return clean;
  }
}

/** The same rows with each description in the language of the email. */
export async function itemsIn<T extends { description: string }>(lang: MailLang, items: T[], userName?: string): Promise<T[]> {
  const said = await piecesIn(lang, items.map((x) => x.description), userName);
  return items.map((x, n) => ({ ...x, description: said[n] || x.description }));
}

/** The pieces of a request for quotation, described in the language of the email. An English description typed by
 *  a person on the part (nameEn) is used as it is; everything else is translated. */
export async function rfqItemsIn(lang: MailLang, items: RfqItem[], userName?: string): Promise<RfqItem[]> {
  const typed = (it: RfqItem) => lang === "EN" && !!it.nameEn?.trim();
  const rest = items.filter((it) => !typed(it));
  const said = await piecesIn(lang, rest.map((it) => it.name), userName);
  const by = new Map(rest.map((it, n) => [it, said[n] || it.name]));
  return items.map((it) => (typed(it) ? it : { ...it, name: by.get(it)!, nameEn: lang === "EN" ? by.get(it)! : it.nameEn }));
}
