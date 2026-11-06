import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

// Claude API access for SOLU. The key lives only in the ANTHROPIC_API_KEY environment variable (Render → Environment).
// Every call is recorded in AiUsage with its cost; once the month reaches AI_MONTHLY_CAP_USD, AI features pause until next month.

export const AI_MODEL = "claude-opus-5-5";
// USD per million tokens (input, output). Unknown models are priced high so the cap errs on the safe side.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
const priceOf = (model: string) => PRICES[model] ?? [10, 50];

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;
export const monthlyCap = () => {
  const v = Number(process.env.AI_MONTHLY_CAP_USD ?? "20");
  return Number.isFinite(v) && v >= 0 ? v : 20;
};

export async function aiSpentThisMonth() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const r = await db.aiUsage.aggregate({ where: { createdAt: { gte: from } }, _sum: { costUsd: true }, _count: true });
  return { usd: Number(r._sum.costUsd ?? 0), calls: r._count };
}

export type AiGate = { ok: true } | { ok: false; reason: "OFF" | "CAP" };
export async function aiGate(): Promise<AiGate> {
  if (!aiConfigured()) return { ok: false, reason: "OFF" };
  const { usd } = await aiSpentThisMonth();
  // Keep a small margin so one more call can't jump far past the cap.
  if (usd + 0.1 > monthlyCap()) return { ok: false, reason: "CAP" };
  return { ok: true };
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 }));

export class AiError extends Error {
  constructor(public code: "OFF" | "CAP" | "REFUSED" | "BAD_OUTPUT" | "RATE" | "AUTH" | "API", message?: string) { super(message ?? code); }
}

/**
 * One request that must come back as JSON matching `schema`. Records usage and cost.
 * Thinking stays on (it can't be turned off on this model); effort "low" keeps cost and wait down.
 */
export async function aiJson<T>(opts: { feature: string; userName?: string; system: string; content: Anthropic.Beta.BetaContentBlockParam[]; schema: Record<string, unknown>; maxTokens?: number }): Promise<T> {
  const gate = await aiGate();
  if (!gate.ok) throw new AiError(gate.reason);
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a safety check declines, the API retries on a suitable model automatically
      output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError("AUTH", e.message);
    if (e instanceof Anthropic.RateLimitError) throw new AiError("RATE", e.message);
    if (e instanceof Anthropic.APIError) throw new AiError("API", e.message);
    throw new AiError("API", e instanceof Error ? e.message : String(e));
  }
  const [pin, pout] = priceOf(res.model);
  const inTok = (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
  const outTok = res.usage.output_tokens ?? 0;
  const cost = (inTok * pin + outTok * pout) / 1_000_000;
  const refused = res.stop_reason === "refusal";
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: T | null = null;
  try { parsed = refused ? null : (JSON.parse(text) as T); } catch { parsed = null; }
  await db.aiUsage.create({ data: { feature: opts.feature, model: res.model, inputTokens: inTok, outputTokens: outTok, costUsd: cost.toFixed(5), ok: !!parsed, userName: opts.userName ?? null } });
  if (refused) throw new AiError("REFUSED");
  if (!parsed) throw new AiError("BAD_OUTPUT", res.stop_reason ?? undefined);
  return parsed;
}
