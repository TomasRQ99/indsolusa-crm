"use server";

// Mercado M5 · person memory, open loops and the human-review gate for prepared messages.
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { addDays, today } from "@/lib/domain";
import { asConfidence, asSource } from "@/lib/market-rules";
import { checkMessage, CHANNELS, personNoteIssues, POLICY_VERSION } from "@/lib/comm-policy";
import { connectionBrief, NOTE_KINDS, personRelationship } from "@/lib/relationship";

const txt = (fd: FormData, k: string, max = 500) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (v: FormDataEntryValue | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${String(v)}T00:00:00Z`) : null);
const page = (id: string, qs = "", hash = "") => `/mercado/personas/${id}${qs ? `?${qs}` : ""}${hash}`;
const go = (path: string): never => { refreshApp(); redirect(path); };

export async function addPersonNote(contactId: string, fd: FormData) {
  const user = await requireUser();
  const kind = txt(fd, "kind", 30) ?? "";
  const statement = txt(fd, "statement", 400);
  const evidence = txt(fd, "evidence", 400);
  if (!(kind in NOTE_KINDS) || !statement) go(page(contactId, "err=nota", "#recordar"));
  // VALUES needs evidence (what they said or did), like "Qué valoran" on the company (§11.4).
  if (kind === "VALUES" && !evidence) go(page(contactId, "err=evidencia", "#recordar"));
  if (personNoteIssues(`${statement} ${evidence ?? ""}`).length) go(page(contactId, "err=etiqueta", "#recordar"));
  await db.personNote.create({ data: { contactId, kind, statement: statement!, evidence, sourceType: asSource(txt(fd, "sourceType", 30)), sourceRef: txt(fd, "sourceRef", 300), confidence: asConfidence(txt(fd, "confidence", 20)), observedAt: new Date(), capturedByName: user.name } });
  go(page(contactId, "ok=nota", "#recordar"));
}

/** Notes are never edited in place: a note that no longer holds is marked replaced and stays in history. */
export async function retireNote(noteId: string) {
  await requireUser();
  const n = await db.personNote.update({ where: { id: noteId }, data: { supersededAt: new Date() } });
  go(page(n.contactId, "ok=retirada", "#recordar"));
}

export async function addLoop(contactId: string, fd: FormData) {
  const user = await requireUser();
  const side = txt(fd, "side", 10) === "THEIRS" ? "THEIRS" : "OURS";
  const what = txt(fd, "what", 300);
  if (!what) go(page(contactId, "err=compromiso", "#compromisos"));
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId }, select: { accountId: true } });
  await db.openLoop.create({ data: { side, what: what!, dueAt: dayOf(fd.get("dueAt")), contactId, accountId: c.accountId, sourceType: asSource(txt(fd, "sourceType", 30) ?? "CONVERSATION"), sourceRef: txt(fd, "sourceRef", 300), observedAt: new Date(), capturedByName: user.name } });
  go(page(contactId, "ok=compromiso", "#compromisos"));
}

export async function closeLoop(loopId: string, fd: FormData) {
  const user = await requireUser();
  const status = txt(fd, "status", 10) === "DROPPED" ? "DROPPED" : "DONE";
  const l = await db.openLoop.update({ where: { id: loopId }, data: { status, closedAt: new Date(), closedNote: txt(fd, "note", 300), closedByName: user.name } });
  go(page(l.contactId ?? "", "ok=cerrado", "#compromisos"));
}

/** Human-review gate (§11.12): SOLU never sends. The person edits, sends it themselves and records it here.
 *  The draft and its metadata are rebuilt on the server (not trusted from the form); the final text is checked again. */
export async function recordSent(contactId: string, fd: FormData) {
  const user = await requireUser();
  const purpose = txt(fd, "purpose", 20);
  const channel = txt(fd, "channel", 20) ?? "";
  const finalText = txt(fd, "finalText", 4000);
  const own = fd.get("own") === "1";
  const qs = (x: string) => `p=${purpose ?? ""}${own ? "&own=1" : ""}&${x}`;
  if (!finalText) go(page(contactId, qs("err=texto"), "#preparar"));
  if (!(channel in CHANNELS) || channel === "INTRO") go(page(contactId, qs("err=canal"), "#preparar"));
  if (fd.get("reviewed") !== "1") go(page(contactId, qs("err=revision"), "#preparar"));
  const r = await personRelationship(contactId);
  if (!r) go("/mercado");
  const b = connectionBrief(r!, { purpose, lang: fd.get("lang") === "EN" ? "EN" : "ES", senderName: user.name, ownFault: own });
  if (!b.draft || !b.ctx) go(page(contactId, qs("err=razon"), "#preparar"));
  const checks = checkMessage(finalText!, b.ctx!);
  if (checks.some((x) => x.severity === "BLOCK")) go(page(contactId, qs(`err=bloqueo&codes=${checks.filter((x) => x.severity === "BLOCK").map((x) => x.code).join(",")}`), "#preparar"));
  const m = b.draft!.meta;
  await db.preparedMessage.create({
    data: {
      purpose: m.purpose, audienceRole: r!.role, channel, contactId, accountId: r!.c.accountId, draft: b.draft!.text, finalText,
      sourceContextIds: m.sourceContextIds, factsUsed: m.factsUsed, inferencesUsed: m.inferencesUsed, tonePolicy: "carnegie", policyVersion: POLICY_VERSION,
      requiresHumanReview: true, checks: checks.map((x) => ({ code: x.code, severity: x.severity })), status: "SENT", reviewedByName: user.name, reviewedAt: new Date(), createdByName: user.name,
    },
  });
  await db.activity.create({ data: { type: channel === "CALL" || channel === "VISIT" ? (channel === "VISIT" ? "MEETING" : "CALL") : channel === "EMAIL" ? "EMAIL" : "NOTE", subject: `${b.chosen!.purpose === "COLLECTION" ? "Validación de pago" : "Conexión preparada"} (${CHANNELS[channel].es})`.slice(0, 200), body: finalText, userId: user.id, contactId, accountId: r!.c.accountId, source: "Preparar conexión" } });
  // Next movement if there's no reply (§11.6), as a dated To-do only when asked.
  if (fd.get("followUp") === "1" && b.noReply) await db.task.create({ data: { title: `¿Respondió ${r!.c.firstName} ${r!.c.lastName}? ${b.noReply.es}`.slice(0, 200), dueDate: addDays(today(), b.noReply.days), assigneeId: user.id, contactId, accountId: r!.c.accountId } });
  go(page(contactId, "ok=enviado", "#preparar"));
}
