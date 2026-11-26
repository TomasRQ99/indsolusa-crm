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

// The key is expected in ANTHROPIC_API_KEY. A key saved under a close name (CLAUDE_API_KEY…) or pasted with spaces or
// quotes around it is accepted too, so a small slip in Render does not leave the AI off.
const KEY_NAMES = ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_KEY", "CLAUDE_KEY"];
const cleanKey = (v: string | undefined) => (v ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
export const aiKey = () => { for (const n of KEY_NAMES) { const v = cleanKey(process.env[n]); if (v) return v; } return ""; };
export const aiConfigured = () => !!aiKey();
/** For the AI page when the key is not seen: the NAMES (never the values) of the variables on this server that look
 *  like an AI key, and whether each one is empty. */
export const aiKeyHints = () => Object.keys(process.env).filter((n) => /anthropic|claude/i.test(n) && /key|token/i.test(n)).sort().map((n) => ({ name: n, empty: !cleanKey(process.env[n]), accepted: KEY_NAMES.includes(n) }));
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

/** Optional fields are written in the schemas as type ["string", "null"]. The API's documented way to say "this or
 *  null" is anyOf, so every schema is sent in that form. */
export function apiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(apiSchema);
  if (!node || typeof node !== "object") return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (k !== "type" || !Array.isArray(v)) out[k] = k === "enum" || k === "required" ? v : apiSchema(v);
  if (Array.isArray(o.type)) out.anyOf = (o.type as string[]).map((t) => ({ type: t }));
  return out;
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: aiKey(), timeout: 60_000, maxRetries: 1 }));

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
      // The model's thinking counts against this limit too, so a tight limit can cut the JSON short. It is a
      // ceiling, not a spend: the bill is only for the tokens actually produced.
      max_tokens: Math.max(opts.maxTokens ?? 0, 8000),
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a safety check declines, the API retries on a suitable model automatically
      output_config: { effort: "low", format: { type: "json_schema", schema: apiSchema(opts.schema) as Record<string, unknown> } },
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

// USD per internet search made by the AI (charged on top of the tokens).
const SEARCH_PRICE = 0.01;

/** Every web address found inside a search or page-reading result block, whatever its exact shape. */
function urlsIn(node: unknown, out: Set<string>, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { for (const x of node) urlsIn(x, out, depth + 1); return; }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "url" && typeof v === "string" && /^https?:\/\//i.test(v)) out.add(v);
    else if (k !== "encrypted_content" && v && typeof v === "object") urlsIn(v, out, depth + 1);
  }
}

export type ResearchOut<T> = { report: T; searchUrls: string[]; fetchedUrls: string[]; searches: number; costUsd: number };

/**
 * A piece of research on the open internet: the AI searches (and may open a few pages), then hands its findings back
 * by calling `report`, whose input must match `schema`. It can take a few minutes, so it is streamed. The addresses
 * the search really returned come back too, so the caller can tell a link that was found from one that was made up.
 */
export async function aiResearch<T>(opts: { feature: string; userName?: string; system: string; prompt: string; report: { name: string; description: string; schema: Record<string, unknown> }; maxSearches?: number; maxFetches?: number; effort?: "low" | "medium" | "high" }): Promise<ResearchOut<T>> {
  const gate = await aiGate();
  if (!gate.ok) throw new AiError(gate.reason);
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    // Called directly (not from code), so the search limit holds and every result comes back in the response.
    { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 6, allowed_callers: ["direct"] },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.maxFetches ?? 4, max_content_tokens: 6000, allowed_callers: ["direct"] },
    { name: opts.report.name, description: opts.report.description, input_schema: apiSchema(opts.report.schema) as Anthropic.Beta.BetaTool.InputSchema, strict: true },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  const searchUrls = new Set<string>(), fetchedUrls = new Set<string>();
  let inTok = 0, outTok = 0, searches = 0, model = AI_MODEL, report: T | null = null, refused = false, nudged = false, last = "";
  const record = async (ok: boolean) => {
    const [pin, pout] = priceOf(model);
    const cost = (inTok * pin + outTok * pout) / 1_000_000 + searches * SEARCH_PRICE;
    await db.aiUsage.create({ data: { feature: opts.feature, model, inputTokens: inTok, outputTokens: outTok, costUsd: cost.toFixed(5), ok, userName: opts.userName ?? null } });
    return cost;
  };
  try {
    for (let turn = 0; turn < 6 && !report && !refused; turn++) {
      const res = await getClient().beta.messages.stream({
        model: AI_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: opts.effort ?? "medium" },
        system: opts.system,
        tools,
        messages,
      }, { timeout: 240_000 }).finalMessage();
      model = res.model;
      inTok += (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
      outTok += res.usage.output_tokens ?? 0;
      searches += res.usage.server_tool_use?.web_search_requests ?? 0;
      last = res.stop_reason ?? "";
      for (const b of res.content) {
        if (b.type === "web_search_tool_result") urlsIn(b.content, searchUrls);
        else if (b.type === "web_fetch_tool_result") urlsIn(b.content, fetchedUrls);
        else if (b.type === "tool_use" && b.name === opts.report.name) report = b.input as T;
      }
      if (res.stop_reason === "refusal") { refused = true; break; }
      if (report) break;
      messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      // A long search turn comes back paused: sending it back unchanged makes the server carry on.
      if (res.stop_reason === "pause_turn") continue;
      // Any other tool call the AI made by mistake is answered, so the conversation stays valid.
      const stray = res.content.filter((b) => b.type === "tool_use");
      if (stray.length) { messages.push({ role: "user", content: stray.map((b) => ({ type: "tool_result" as const, tool_use_id: (b as Anthropic.Beta.BetaToolUseBlock).id, content: `Unknown tool. Call ${opts.report.name}.`, is_error: true })) }); continue; }
      // It finished in words without handing the findings over: ask once.
      if (nudged) break;
      nudged = true;
      messages.push({ role: "user", content: `Now call the ${opts.report.name} tool with what you found. Do not search again.` });
    }
  } catch (e) {
    if (inTok || outTok) await record(false).catch(() => {});
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError("AUTH", e.message);
    if (e instanceof Anthropic.RateLimitError) throw new AiError("RATE", e.message);
    if (e instanceof Anthropic.APIError) throw new AiError("API", e.message);
    throw new AiError("API", e instanceof Error ? e.message : String(e));
  }
  const costUsd = await record(!!report);
  if (refused) throw new AiError("REFUSED");
  if (!report) throw new AiError("BAD_OUTPUT", last || undefined);
  return { report, searchUrls: [...searchUrls], fetchedUrls: [...fetchedUrls], searches, costUsd };
}

/** "Probar la conexión": one very small paid request (a fraction of a cent) that proves the key works end to end. */
export async function aiPing(userName?: string): Promise<{ ok: true } | { ok: false; code: AiError["code"]; message: string }> {
  try {
    await aiJson<{ ok: boolean }>({
      feature: "PING", userName,
      system: "Connection test. Reply with ok set to true.",
      content: [{ type: "text", text: "ping" }],
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, code: e.code, message: e.message === e.code ? "" : e.message.slice(0, 300) };
    return { ok: false, code: "API", message: e instanceof Error ? e.message.slice(0, 300) : "" };
  }
}

/** This month's calls by feature, for the AI page. */
export async function aiUsageByFeature() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await db.aiUsage.groupBy({ by: ["feature"], where: { createdAt: { gte: from } }, _sum: { costUsd: true }, _count: true, _max: { createdAt: true } });
  return rows.map((r) => ({ feature: r.feature, calls: r._count, usd: Number(r._sum.costUsd ?? 0), last: r._max.createdAt })).sort((a, b) => b.usd - a.usd);
}
