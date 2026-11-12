"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { dayInput, today } from "@/lib/domain";
import { outcomeOf } from "@/lib/contact-line-rules";
import {
  ASPECTS, DIARY_FIELDS, DIARY_MAX, ITEM_FILE_MIMES, ITEM_KINDS, MAX_ITEM_FILE_BYTES, MAX_PROFILE_FILES, NEW_MEETING, PROFILE_SOURCE,
  canSeeReadings, diaryIssue, ecsaOf, meetingOf, readingIssue, safeUrl, type DiaryKey,
} from "@/lib/profile-rules";

// Comercial · Perfiles. Everything here is written by a person and signed with their name. Anyone who works with
// customers can add to a diary (same rule as registering a contact); the reading of a person is for the commercial side.

const BASE = "/comercial/perfiles";
function go(accountId: string, qs: string, hash = ""): never { refreshApp(); redirect(`${BASE}/${accountId}?${qs}${hash}`); }
const txt = (fd: FormData, k: string, max = DIARY_MAX) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (s: string) => new Date(`${s}T00:00:00Z`);

export async function addDiaryEntry(accountId: string, fd: FormData) {
  const user = await requireUser();
  const account = await db.account.findFirst({ where: { id: accountId, internal: false }, select: { id: true, name: true } });
  if (!account) { refreshApp(); redirect(`${BASE}?err=cliente`); }
  const T = today();
  const text = Object.fromEntries(DIARY_FIELDS.map((f) => [f.key, txt(fd, f.key)])) as Record<DiaryKey, string | null>;
  const followUp = txt(fd, "followUp", 300);
  const followUpOn = String(fd.get("followUpOn") ?? "");
  const happenedRaw = String(fd.get("happenedOn") ?? "") || dayInput(T);
  const issue = diaryIssue({ ...text, meeting: String(fd.get("meeting") ?? ""), happenedOn: happenedRaw, followUp, followUpOn, today: dayInput(T) });
  if (issue) go(accountId, `err=${issue.toLowerCase()}`, "#diario");
  const meeting = meetingOf(fd.get("meeting"))!;

  const contactId = String(fd.get("contactId") ?? "");
  const contact = contactId ? await db.contact.findFirst({ where: { id: contactId, accountId }, select: { id: true } }) : null;
  // An existing conversation must belong to this customer; its own day is the day of the entry.
  const act = meeting.kind === "act" ? await db.activity.findFirst({ where: { id: meeting.id, accountId, type: { in: ["CALL", "MEETING"] } }, select: { id: true, occurredAt: true, contactId: true } }) : null;
  if (meeting.kind === "act" && !act) go(accountId, "err=reunion", "#diario");
  const happenedOn = act ? dayOf(act.occurredAt.toISOString().slice(0, 10)) : dayOf(happenedRaw);
  const first = (text.pain ?? text.struggle ?? text.notes ?? text.impact ?? text.personal ?? text.agreement ?? text.decision ?? text.budget ?? "").split("\n")[0].trim();

  await db.$transaction(async (tx) => {
    let activityId: string | null = act?.id ?? null;
    if (meeting.kind === "new") {
      const m = NEW_MEETING[meeting.type];
      const record = outcomeOf(meeting.type, m.outcome)!.record.es;
      activityId = (await tx.activity.create({
        data: {
          type: m.type, outcome: m.outcome, userId: user.id, accountId, contactId: contact?.id ?? null, source: PROFILE_SOURCE,
          // Today keeps the real time; an earlier day is stored as that calendar day.
          occurredAt: happenedOn.getTime() === T.getTime() ? new Date() : happenedOn,
          subject: `${record}: ${first}`.slice(0, 200),
          // The conversation left a need when the pain or the struggle was written; otherwise, new information.
          valueKind: text.pain || text.struggle ? "NEED" : "INFO",
        },
      })).id;
    }
    const taskId = followUp ? (await tx.task.create({ data: { title: `Seguimiento · ${account!.name}: ${followUp}`.slice(0, 200), dueDate: dayOf(followUpOn), assigneeId: user.id, accountId, contactId: contact?.id ?? act?.contactId ?? null } })).id : null;
    await tx.profileDiaryEntry.create({
      data: { accountId, contactId: contact?.id ?? act?.contactId ?? null, activityId, happenedOn, ecsa: ecsaOf(fd.get("ecsa")), ...text, followUp, followUpOn: followUp ? dayOf(followUpOn) : null, taskId, authorId: user.id, authorName: user.name },
    });
  });
  go(accountId, followUp ? "ok=entrada-plan" : "ok=entrada", "#diario");
}

/** Whoever wrote the entry, or management, can remove it. The conversation and the follow-up task stay where they are. */
export async function removeDiaryEntry(entryId: string) {
  const user = await requireUser();
  const e = await db.profileDiaryEntry.findUnique({ where: { id: entryId }, select: { id: true, accountId: true, authorId: true } });
  if (!e) { refreshApp(); redirect(`${BASE}?err=cliente`); }
  if (e!.authorId !== user.id && !canManageAll(user)) go(e!.accountId, "err=permiso", "#diario");
  await db.profileDiaryEntry.delete({ where: { id: entryId } });
  go(e!.accountId, "ok=quitada", "#diario");
}

// ---------- Reading of a person ----------

export async function addReading(contactId: string, fd: FormData) {
  const user = await requireUser();
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { id: true, accountId: true } });
  if (!c?.accountId) { refreshApp(); redirect(`${BASE}?err=cliente`); }
  const accountId = c!.accountId!;
  if (!canSeeReadings(user)) go(accountId, "err=lectura-permiso", "#personas");
  const aspect = String(fd.get("aspect") ?? "");
  const statement = txt(fd, "statement", 500);
  const evidence = txt(fd, "evidence", 500);
  if (!(aspect in ASPECTS) || !statement) go(accountId, "err=lectura", `#p-${contactId}`);
  // Never a guess: every line carries what the person said or did.
  if (!evidence) go(accountId, "err=evidencia", `#p-${contactId}`);
  const issue = readingIssue(`${statement} ${evidence}`);
  if (issue) go(accountId, `err=${issue.toLowerCase()}`, `#p-${contactId}`);
  await db.personReading.create({ data: { contactId, aspect, statement: statement!, evidence: evidence!, observedOn: today(), authorId: user.id, authorName: user.name } });
  go(accountId, "ok=lectura", `#p-${contactId}`);
}

/** People change: a line that is no longer true is kept in the history, out of the current reading. */
export async function retireReading(readingId: string) {
  const user = await requireUser();
  const r = await db.personReading.findUnique({ where: { id: readingId }, select: { id: true, contactId: true, supersededAt: true, contact: { select: { accountId: true } } } });
  if (!r?.contact.accountId) { refreshApp(); redirect(`${BASE}?err=cliente`); }
  const accountId = r!.contact.accountId!;
  if (!canSeeReadings(user)) go(accountId, "err=lectura-permiso", "#personas");
  if (!r!.supersededAt) await db.personReading.update({ where: { id: readingId }, data: { supersededAt: new Date() } });
  go(accountId, "ok=retirada", `#p-${r!.contactId}`);
}

// ---------- Material: documents, products they may need, brands they use ----------

export type ItemResult = { ok: true } | { ok: false; error: "CLIENTE" | "TITULO" | "ENLACE" | "ARCHIVO" | "FALTA" | "LLENO" };

/** Called from the browser (photos arrive already shrunk). A document needs a file or a link; a product or a brand needs only its name. */
export async function addProfileItem(accountId: string, fd: FormData): Promise<ItemResult> {
  const user = await requireUser();
  const account = await db.account.findFirst({ where: { id: accountId, internal: false }, select: { id: true } });
  const kind = String(fd.get("kind") ?? "");
  if (!account || !(kind in ITEM_KINDS)) return { ok: false, error: "CLIENTE" };
  const f = fd.get("file");
  const file = f instanceof File && f.size > 0 ? f : null;
  if (file && (file.size > MAX_ITEM_FILE_BYTES || !ITEM_FILE_MIMES.includes(file.type))) return { ok: false, error: "ARCHIVO" };
  const rawUrl = String(fd.get("url") ?? "").trim();
  const url = rawUrl ? safeUrl(rawUrl) : null;
  if (rawUrl && !url) return { ok: false, error: "ENLACE" };
  const title = txt(fd, "title", 160) ?? (kind === "DOCUMENT" && file ? file.name.replace(/\.\w+$/, "").slice(0, 160) : null);
  if (!title) return { ok: false, error: "TITULO" };
  if (kind === "DOCUMENT" && !file && !url) return { ok: false, error: "FALTA" };
  if (file && (await db.profileItem.count({ where: { accountId, size: { gt: 0 } } })) >= MAX_PROFILE_FILES) return { ok: false, error: "LLENO" };
  await db.profileItem.create({
    data: {
      accountId, kind, title, note: txt(fd, "note", 500), url, uploadedByName: user.name,
      ...(file ? { fileName: file.name.slice(0, 160) || "archivo", mime: file.type, size: file.size, data: Buffer.from(await file.arrayBuffer()) } : {}),
    },
  });
  refreshApp();
  return { ok: true };
}

/** Whoever added it, the customer's owner (or someone covering) or management can remove it. */
export async function removeProfileItem(itemId: string) {
  const user = await requireUser();
  const it = await db.profileItem.findUnique({ where: { id: itemId }, select: { id: true, accountId: true, uploadedByName: true, account: { select: { ownerId: true } } } });
  if (!it) { refreshApp(); redirect(`${BASE}?err=cliente`); }
  if (it!.uploadedByName !== user.name && !canEdit(user, it!.account.ownerId)) go(it!.accountId, "err=permiso", "#material");
  await db.profileItem.delete({ where: { id: itemId } });
  go(it!.accountId, "ok=material", "#material");
}
