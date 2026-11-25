"use server";

import { requireUser } from "@/lib/auth";
import { AiError } from "@/lib/ai";
import { draftNeed, type NeedDraft } from "@/lib/need-ai";

export type NeedAiResult =
  | { ok: true; draft: NeedDraft; accountId: string | null; accountName: string | null; contactId: string | null }
  | { ok: false; error: "CORTO" | AiError["code"] };

/** "Crear Necesidad con IA": reads the case the person told and returns the fields for the "Nueva Necesidad" form.
 *  It creates nothing and sends nothing; the person reviews the form and presses its own button. */
export async function draftNeedWithAi(text: string): Promise<NeedAiResult> {
  const user = await requireUser();
  const said = String(text ?? "").trim();
  if (said.length < 20) return { ok: false, error: "CORTO" };
  try {
    return { ok: true, ...(await draftNeed({ text: said, lang: user.lang === "EN" ? "EN" : "ES", userName: user.name })) };
  } catch (e) {
    const code = e instanceof AiError ? e.code : "API";
    if (!(e instanceof AiError) || code === "API" || code === "AUTH") console.error("[deals/need-ai]", e instanceof Error ? e.message : e);
    return { ok: false, error: code };
  }
}
