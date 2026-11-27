// The description of a piece, in the language of the email it goes in (owner, 2026-11-27: "the piece description is
// in spanish, and it does not translate with the email"). The search writes what it understood in the language of
// the person; the email to a seller abroad goes in English. Each translation is done once and kept on the search.
import { createHash } from "node:crypto";
import { db } from "./db";
import { aiConfigured, aiJson } from "./ai";
import type { MailLang } from "./email-templates";

const keyOf = (lang: MailLang, text: string) => `${lang}:${createHash("sha1").update(text).digest("hex").slice(0, 16)}`;
const SYSTEM = (lang: MailLang) => `You translate short technical descriptions of industrial spare parts and instruments. They go into a purchasing email to a supplier, so the supplier must be able to recognise the piece.

Translate each numbered text into ${lang === "EN" ? "English" : "Spanish"}, with the technical terms a distributor of that kind of piece uses. If a text is already in that language, give it back unchanged.

Keep exactly as written: part numbers, order codes, model and series names, brand names, standards, units and every value. Do not add, remove, summarise or explain anything, and keep the order of the details.`;

/** Gives the texts back in `lang`. Anything that cannot be translated right now comes back as it was. */
export async function piecesIn(huntId: string, lang: MailLang, texts: string[], userName?: string): Promise<string[]> {
  const clean = texts.map((t) => t.trim());
  try {
    const hunt = await db.webHunt.findUnique({ where: { id: huntId }, select: { understood: true } });
    const und = (hunt?.understood ?? {}) as { tr?: Record<string, string> };
    const have = und.tr ?? {};
    const missing = [...new Set(clean.filter((t) => t.length >= 4 && !have[keyOf(lang, t)]))];
    if (missing.length && hunt && aiConfigured()) {
      const out = await Promise.race([
        aiJson<{ items: { n: number; text: string }[] }>({
          feature: "mail-translate", userName, system: SYSTEM(lang),
          content: [{ type: "text", text: missing.map((t, n) => `${n + 1}. ${t}`).join("\n") }],
          schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "text"], properties: { n: { type: "integer" }, text: { type: "string" } } } } } },
          maxTokens: 4000,
        }),
        new Promise<null>((r) => setTimeout(() => r(null), 25_000)),
      ]);
      const fresh: Record<string, string> = {};
      for (const it of out?.items ?? []) {
        const src = missing[it.n - 1]; const t = typeof it.text === "string" ? it.text.replace(/\s+/g, " ").trim() : "";
        // A translation that lost most of the text, or grew out of proportion, is not trusted.
        if (src && t && t.length >= src.length * 0.4 && t.length <= src.length * 2.5 + 40) fresh[keyOf(lang, src)] = t.slice(0, 2000);
      }
      if (Object.keys(fresh).length) {
        Object.assign(have, fresh);
        const again = await db.webHunt.findUnique({ where: { id: huntId }, select: { understood: true } });
        const cur = (again?.understood ?? {}) as Record<string, unknown> & { tr?: Record<string, string> };
        await db.webHunt.update({ where: { id: huntId }, data: { understood: { ...cur, tr: { ...(cur.tr ?? {}), ...fresh } } } });
      }
    }
    return clean.map((t) => have[keyOf(lang, t)] ?? t);
  } catch {
    return clean;
  }
}
