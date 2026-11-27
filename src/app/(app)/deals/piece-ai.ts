"use server";

import { requireUser } from "@/lib/auth";
import { AiError, aiGate, aiJson } from "@/lib/ai";

// "Precio por pieza" (owner, 2026-11-27): the description of a piece can be typed by hand and tidied by the AI
// before it goes to the quote's PDF. The AI only rewrites what the person typed: it never adds a specification,
// and the part number, the brand and every value stay as they are. Nothing is saved here: the text goes back to
// the row, and the person saves the sheet.

export type PieceTextOut = { ok: true; text: string } | { ok: false; reason: "OFF" | "CAP" | "EMPTY" | "FAIL" };

export async function improvePieceText(code: string, description: string): Promise<PieceTextOut> {
  const user = await requireUser();
  const desc = String(description ?? "").trim().slice(0, 300), pn = String(code ?? "").trim().slice(0, 60);
  if (desc.length < 3) return { ok: false, reason: "EMPTY" };
  const gate = await aiGate();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  try {
    const out = await aiJson<{ description: string }>({
      feature: "piece-text",
      userName: user.name,
      system: [
        "You tidy the description of one industrial spare part for a line of a commercial quotation.",
        "Rewrite the text the person typed as one clear line: what the part is first, then its key attributes in a sensible order, correct spelling and units.",
        "Keep the language the description is written in. Do not translate it.",
        "Never invent or add a specification, brand, model or value that is not in the text. Never change a part number, a brand name, a number or a unit.",
        "Do not include the part number in the description unless the person wrote it there. No sales language, no final period, at most 200 characters.",
      ].join(" "),
      content: [{ type: "text", text: `Part number: ${pn || "(none)"}\nDescription typed: ${desc}` }],
      schema: { type: "object", properties: { description: { type: "string" } }, required: ["description"], additionalProperties: false },
      maxTokens: 300,
    });
    const text = String(out?.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    return text ? { ok: true, text } : { ok: false, reason: "FAIL" };
  } catch (e) {
    if (e instanceof AiError && e.code === "CAP") return { ok: false, reason: "CAP" };
    return { ok: false, reason: "FAIL" };
  }
}
