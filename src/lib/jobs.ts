import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { briefDue } from "./gerencia-rules";

// Durable worker (decision 2026-11-10). Render's free plan has no background processes, so a free GitHub
// schedule calls POST /api/worker every 15 minutes with a key. Each call:
//   1. puts back jobs left RUNNING by a call that died (> 10 min),
//   2. plans the recurring work as jobs (one per time slot, so it never doubles),
//   3. claims due jobs with FOR UPDATE SKIP LOCKED (two calls never take the same job),
//   4. runs them within a time budget; a failure retries later with backoff, then stays FAILED for a person.
// Every call is recorded in WorkerRun. Nothing here sends money. The only email it sends on its own is the monthly
// reminder to Gerencia that the Business Pulse is ready to issue (decision 2026-11-11).

export const JOB_KINDS = ["MAIL_REPLIES", "CUSTOMER_MAIL", "CATALOG_SYNC", "PAY_BEHAVIOR", "PAY_BEHAVIOR_ALL", "HOUSEKEEPING", "PULSE_REMINDER", "ADMIN_DAILY", "GERENCIA_DAILY", "GERENCIA_BRIEF"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_LABEL: Record<JobKind, [string, string]> = {
  MAIL_REPLIES: ["Leer respuestas a nuestros correos", "Read replies to our emails"],
  CUSTOMER_MAIL: ["Importar correos de clientes conocidos", "Import emails from known customers"],
  CATALOG_SYNC: ["Actualizar el catálogo de repuestos", "Update the parts catalog"],
  PAY_BEHAVIOR: ["Recalcular cómo paga un cliente", "Recalculate how a customer pays"],
  PAY_BEHAVIOR_ALL: ["Recalcular cómo pagan todos los clientes", "Recalculate how all customers pay"],
  HOUSEKEEPING: ["Limpiar registros viejos del trabajador", "Clean old worker records"],
  PULSE_REMINDER: ["Avisar a Gerencia que el informe del mes está listo para emitir", "Remind Management that the month's report is ready to issue"],
  ADMIN_DAILY: ["Revisar promesas de pago vencidas y obligaciones con decisión cercana", "Check payment promises past their date and obligations with a decision coming"],
  GERENCIA_DAILY: ["Guardar la foto diaria de Gerencia y anotar los cambios materiales", "Save Management's daily picture and note material changes"],
  GERENCIA_BRIEF: ["Avisar a Gerencia por correo que el cierre ejecutivo está listo", "Email Management that the executive close is ready"],
};

/** Slot keys contain "@": they stay forever (a slot runs once). Plain keys are released when the job ends. */
export async function enqueue(kind: JobKind, payload: Prisma.InputJsonValue = {}, o: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {}) {
  const r = await db.job.createMany({ data: [{ kind, payload, dedupeKey: o.dedupeKey ?? null, runAfter: o.runAfter ?? new Date(), maxAttempts: o.maxAttempts ?? 5 }], skipDuplicates: true });
  return r.count > 0;
}

// ---------- handlers ----------

type Handler = (payload: Record<string, unknown>) => Promise<string>;

const HANDLERS: Record<JobKind, Handler> = {
  async MAIL_REPLIES() {
    const { mailConfig } = await import("./mail");
    if (mailConfig().provider !== "graph" || process.env.MAIL_DRY_RUN === "1") return "skipped: Graph mail not configured";
    const { syncReplies } = await import("./mail-replies");
    const r = await syncReplies({ force: true });
    return `replies ${r.found}, auto ${r.auto}, bounced ${r.bounced}`;
  },
  async CUSTOMER_MAIL() {
    const { mailConfig } = await import("./mail");
    if (mailConfig().provider !== "graph" || process.env.MAIL_DRY_RUN === "1") return "skipped: Graph mail not configured";
    const { syncCustomerEmails } = await import("./comm-mail");
    const r = await syncCustomerEmails({ force: true });
    return `imported ${r.imported}, skipped ${r.skipped}`;
  },
  async CATALOG_SYNC() {
    const { syncCatalogFromHistory } = await import("./parts");
    const r = await syncCatalogFromHistory();
    return JSON.stringify(r).slice(0, 200);
  },
  async PAY_BEHAVIOR(p) {
    const id = String(p.accountId ?? "");
    if (!id) return "no account";
    const { refreshPaymentBehavior } = await import("./pay-behavior");
    await refreshPaymentBehavior(id, String(p.reason ?? "Trabajador programado").slice(0, 200));
    return "ok";
  },
  async PAY_BEHAVIOR_ALL() {
    // Windows ("last 6 months") move with the calendar, so trends can change without new payments.
    const accounts = await db.account.findMany({ where: { invoices: { some: {} } }, select: { id: true } });
    for (const a of accounts) await enqueue("PAY_BEHAVIOR", { accountId: a.id, reason: "Revisión diaria" }, { dedupeKey: `PAY_BEHAVIOR:${a.id}` });
    return `queued ${accounts.length}`;
  },
  async HOUSEKEEPING() {
    const done = await db.job.deleteMany({ where: { status: "DONE", doneAt: { lt: new Date(Date.now() - 30 * 864e5) } } });
    const runs = await db.workerRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 60 * 864e5) } } });
    return `deleted ${done.count} jobs, ${runs.count} runs`;
  },
  async PULSE_REMINDER() {
    const { pulseReminder } = await import("./pulse-reminder");
    return pulseReminder();
  },
  async ADMIN_DAILY() {
    const { adminDaily } = await import("./admin-daily");
    return adminDaily();
  },
  async GERENCIA_DAILY() {
    const { gerenciaDaily } = await import("./gerencia-daily");
    return gerenciaDaily();
  },
  async GERENCIA_BRIEF() {
    const { gerenciaBrief } = await import("./gerencia-brief");
    return gerenciaBrief();
  },
};

// ---------- planning ----------

const slot = (d: Date, minutes: number) => new Date(Math.floor(d.getTime() / (minutes * 60e3)) * minutes * 60e3).toISOString().slice(0, 16);

export async function planRecurring(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  await enqueue("MAIL_REPLIES", {}, { dedupeKey: `MAIL_REPLIES@${slot(now, 15)}`, maxAttempts: 1 });
  await enqueue("CUSTOMER_MAIL", {}, { dedupeKey: `CUSTOMER_MAIL@${slot(now, 15)}`, maxAttempts: 1 });
  await enqueue("CATALOG_SYNC", {}, { dedupeKey: `CATALOG_SYNC@${slot(now, 60)}`, maxAttempts: 2 });
  await enqueue("PAY_BEHAVIOR_ALL", {}, { dedupeKey: `PAY_BEHAVIOR_ALL@${day}`, maxAttempts: 3 });
  await enqueue("HOUSEKEEPING", {}, { dedupeKey: `HOUSEKEEPING@${day}`, maxAttempts: 2 });
  await enqueue("ADMIN_DAILY", {}, { dedupeKey: `ADMIN_DAILY@${day}`, maxAttempts: 3 });
  await enqueue("GERENCIA_DAILY", {}, { dedupeKey: `GERENCIA_DAILY@${day}`, maxAttempts: 3 });
  // Working days from 7 in the morning, company time: the job itself reads the policy (off, daily or Mondays).
  const brief = briefDue("DAILY", now);
  if (brief) await enqueue("GERENCIA_BRIEF", {}, { dedupeKey: `GERENCIA_BRIEF@${brief.day}`, maxAttempts: 1 });
  // Once a month, in its first week: the month that just ended is ready to issue.
  if (now.getUTCDate() <= 7) await enqueue("PULSE_REMINDER", {}, { dedupeKey: `PULSE_REMINDER@${day.slice(0, 7)}`, maxAttempts: 3 });
}

// ---------- running ----------

type Claimed = { id: string; kind: string; payload: Prisma.JsonValue; attempts: number; maxAttempts: number; dedupeKey: string | null };

// Prisma stores DateTime as UTC without a zone; compare in UTC whatever the database's own time zone is.
async function claim(n: number) {
  return db.$queryRaw<Claimed[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1
    WHERE id IN (SELECT id FROM "Job" WHERE status = 'PENDING' AND "runAfter" <= (now() AT TIME ZONE 'UTC') ORDER BY "runAfter" LIMIT ${n} FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts, "maxAttempts", "dedupeKey"`;
}

/** Retry later: 2, 4, 8, 16… minutes, at most an hour. */
export const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(1, attempts));

async function runOne(j: Claimed) {
  const h = HANDLERS[j.kind as JobKind];
  const release = j.dedupeKey && !j.dedupeKey.includes("@") ? { dedupeKey: null } : {};
  try {
    if (!h) throw new Error(`Unknown job kind ${j.kind}`);
    const result = await h((j.payload ?? {}) as Record<string, unknown>);
    await db.job.update({ where: { id: j.id }, data: { status: "DONE", doneAt: new Date(), lockedAt: null, result: result.slice(0, 500), lastError: null, ...release } });
    return true;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const last = j.attempts >= j.maxAttempts;
    await db.job.update({
      where: { id: j.id },
      data: last ? { status: "FAILED", lockedAt: null, lastError: msg, doneAt: new Date(), ...release } : { status: "PENDING", lockedAt: null, lastError: msg, runAfter: new Date(Date.now() + backoffMinutes(j.attempts) * 60e3) },
    });
    return false;
  }
}

export async function runWorker(o: { trigger: "SCHEDULE" | "INTERNAL" | "MANUAL" | "LOCAL"; budgetMs?: number } = { trigger: "SCHEDULE" }) {
  const budget = o.budgetMs ?? 45_000;
  const start = Date.now();
  const run = await db.workerRun.create({ data: { trigger: o.trigger } });
  let done = 0, failed = 0;
  const kinds: Record<string, number> = {};
  try {
    await db.$executeRaw`UPDATE "Job" SET status = 'PENDING', "lockedAt" = NULL WHERE status = 'RUNNING' AND "lockedAt" < (now() AT TIME ZONE 'UTC') - interval '10 minutes'`;
    await planRecurring();
    while (Date.now() - start < budget) {
      const batch = await claim(5);
      if (!batch.length) break;
      for (const j of batch) {
        if (await runOne(j)) done++; else failed++;
        kinds[j.kind] = (kinds[j.kind] ?? 0) + 1;
      }
    }
    const pending = await db.job.count({ where: { status: "PENDING", runAfter: { lte: new Date() } } });
    const summary = `${Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(", ") || "nothing due"}${pending ? ` · ${pending} still due` : ""}`;
    await db.workerRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: failed === 0, done, failed, summary } });
    return { ok: failed === 0, done, failed, pending, summary, ms: Date.now() - start };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.workerRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, done, failed, summary: `error: ${msg}` } }).catch(() => null);
    throw e;
  }
}

/** A failed job can be put back by a person (after fixing the cause). */
export async function retryJob(id: string) {
  await db.job.updateMany({ where: { id, status: "FAILED" }, data: { status: "PENDING", attempts: 0, runAfter: new Date(), lastError: null, doneAt: null } });
}

// ---------- the key GitHub uses ----------
// Stored only as a SHA-256 hash (MarketSetting "workerKey", versioned). The key itself is shown once,
// to Gerencia, to paste into GitHub. WORKER_SECRET in the environment also works (optional).

const sha = (s: string) => createHash("sha256").update(s).digest();

export async function newWorkerKey(byName: string) {
  const key = `solu_wk_${randomBytes(24).toString("base64url")}`;
  const last = await db.marketSetting.findFirst({ where: { key: "workerKey" }, orderBy: { version: "desc" }, select: { version: true } });
  await db.marketSetting.create({ data: { key: "workerKey", version: (last?.version ?? 0) + 1, value: { hash: sha(key).toString("hex"), hint: key.slice(-4) }, updatedByName: byName } });
  return key;
}

export async function workerKeyInfo() {
  const s = await db.marketSetting.findFirst({ where: { key: "workerKey" }, orderBy: { version: "desc" } });
  return s ? { version: s.version, by: s.updatedByName, at: s.createdAt, hint: String((s.value as { hint?: string }).hint ?? "") } : null;
}

export async function checkWorkerKey(given: string | null) {
  if (!given || given.length < 20 || given.length > 200) return false;
  const g = sha(given);
  const env = process.env.WORKER_SECRET?.trim();
  if (env && env.length >= 20 && timingSafeEqual(g, sha(env))) return true;
  const s = await db.marketSetting.findFirst({ where: { key: "workerKey" }, orderBy: { version: "desc" } });
  const hex = (s?.value as { hash?: string } | undefined)?.hash;
  if (!hex || hex.length !== 64) return false;
  return timingSafeEqual(g, Buffer.from(hex, "hex"));
}
