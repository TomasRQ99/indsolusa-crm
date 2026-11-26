// A mailbox that is not in the company's Microsoft 365 account (owner, 2026-11-25: "conectar" their own address, hosted
// with the website). It is read over IMAP, the standard every mail host offers. Read-only: the folder is opened
// read-only, nothing is marked as read, moved or deleted, and nothing is stored in SOLU.
//
// Set in Render → Environment (the password is never typed into SOLU or a chat):
//   MAILBOX2_ADDRESS     the email address, e.g. name@company.com
//   MAILBOX2_IMAP_HOST   the incoming IMAP server, e.g. mail.company.com
//   MAILBOX2_PASSWORD    the mailbox password
//   MAILBOX2_IMAP_PORT   optional, 993 by default (encrypted)
//   MAILBOX2_USER        optional, the login name when it is not the address
//   MAILBOX2_OWNER       optional, the SOLU login email of the person who may open it, when it is not the address
//   MAILBOX2_SENT_FOLDER optional, the exact name of the sent folder when SOLU does not find it by itself
//   MAILBOX2_SMTP_HOST   optional, the outgoing server when it is not the same as the incoming one
//   MAILBOX2_SMTP_PORT   optional, 465 by default (encrypted); 587 also works
//
// Sending (owner, same day: "lectura y envío"): the owner of the mailbox can send a SOLU email from it instead of the
// company address. It goes out through the mailbox's own outgoing server and a copy is left in its sent folder.

import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const env = (n: string) => (process.env[n] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
// Test hook, never in production: lets a local stand-in mail host without encryption be used.
const plainOk = () => process.env.NODE_ENV !== "production" && process.env.MAILBOX2_TEST_PLAIN === "1";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function imapBox() {
  const address = env("MAILBOX2_ADDRESS"), host = env("MAILBOX2_IMAP_HOST"), pass = env("MAILBOX2_PASSWORD");
  const port = Number(env("MAILBOX2_IMAP_PORT") || "993");
  const missing = [!address && "MAILBOX2_ADDRESS", !host && "MAILBOX2_IMAP_HOST", !pass && "MAILBOX2_PASSWORD"].filter(Boolean) as string[];
  return { address, host, pass, port: Number.isFinite(port) && port > 0 ? port : 993, user: env("MAILBOX2_USER") || address, owner: env("MAILBOX2_OWNER") || address, sent: env("MAILBOX2_SENT_FOLDER"), started: missing.length < 3, ready: missing.length === 0, missing };
}
/** Only the person the mailbox belongs to opens it: nobody else, whatever their role. */
export const imapAllowed = (user: { email: string }) => { const b = imapBox(); return b.started && !!b.owner && same(user.email, b.owner); };

export class ImapError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "AUTH" | "NO_FOLDER" | "OTHER", msg?: string) { super(msg ?? code); }
}
export type ImapRow = { id: string; subject: string; from: string; to: string; at: Date; preview: string };

type A = { name?: string; address?: string };
const who = (a?: A) => { const n = a?.name?.trim(); const e = a?.address?.trim(); return n && e && n.toLowerCase() !== e.toLowerCase() ? `${n} <${e}>` : e || n || ""; };

async function sentPath(c: ImapFlow, named: string) {
  const boxes = await c.list();
  const hit = (named && boxes.find((x) => same(x.path, named) || same(x.name, named)))
    || boxes.find((x) => x.specialUse === "\\Sent")
    || boxes.find((x) => /^(sent|sent items|sent messages|enviados|elementos enviados|mensajes enviados)$/i.test(x.name.trim()))
    || boxes.find((x) => /sent|enviad/i.test(x.name));
  if (!hit) throw new ImapError("NO_FOLDER", boxes.map((x) => x.path).slice(0, 12).join(", "));
  return hit.path;
}

async function withBox<T>(folder: "in" | "out", run: (c: ImapFlow, path: string) => Promise<T>, lock = true): Promise<T> {
  const b = imapBox();
  if (!b.ready) throw new ImapError("NOT_CONFIGURED", b.missing.join(", "));
  // Port 993 is encrypted from the first byte; any other port starts plain and must upgrade to encrypted before login.
  const c = new ImapFlow({ host: b.host, port: b.port, secure: b.port === 993, ...(b.port === 993 || plainOk() ? {} : { doSTARTTLS: true }), auth: { user: b.user, pass: b.pass }, logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  c.on("error", () => {});
  try {
    try { await c.connect(); }
    catch (e) {
      if ((e as { authenticationFailed?: boolean }).authenticationFailed) throw new ImapError("AUTH");
      throw new ImapError("OTHER", `${(e as { code?: string }).code ?? (e as Error).name}: ${(e as Error).message}`.slice(0, 160));
    }
    const path = folder === "out" ? await sentPath(c, b.sent) : "INBOX";
    if (!lock) return await run(c, path);
    const held = await c.getMailboxLock(path, { readOnly: true });
    try { return await run(c, path); } finally { held.release(); }
  } catch (e) {
    if (e instanceof ImapError) throw e;
    throw new ImapError("OTHER", `${(e as { code?: string }).code ?? (e as Error).name}: ${(e as Error).message}`.slice(0, 160));
  } finally { try { await c.logout(); } catch { try { c.close(); } catch { /* already closed */ } } }
}

/** The latest emails of the folder, newest first (headers only: no preview text is downloaded). */
export async function imapList(folder: "in" | "out", top = 30): Promise<ImapRow[]> {
  return withBox(folder, async (c) => {
    const total = c.mailbox ? c.mailbox.exists : 0;
    if (!total) return [];
    const rows: ImapRow[] = [];
    for await (const m of c.fetch(`${Math.max(1, total - top + 1)}:*`, { uid: true, envelope: true, internalDate: true })) {
      const e = m.envelope;
      rows.push({ id: String(m.uid), subject: (e?.subject ?? "").trim() || "(sin asunto)", from: who(e?.from?.[0]), to: (e?.to ?? []).map(who).filter(Boolean).slice(0, 4).join(", "), at: new Date(e?.date ?? m.internalDate ?? Date.now()), preview: "" });
    }
    return rows.sort((x, y) => y.at.getTime() - x.at.getTime());
  });
}

/** One email with its text. */
export async function imapGet(folder: "in" | "out", id: string): Promise<ImapRow & { body: string }> {
  if (!/^\d{1,12}$/.test(id)) throw new ImapError("OTHER", "id");
  return withBox(folder, async (c) => {
    const m = await c.fetchOne(id, { uid: true, envelope: true, internalDate: true, source: { maxLength: 2_000_000 } }, { uid: true });
    if (!m || !m.source) throw new ImapError("OTHER", "El correo ya no está en esa carpeta");
    const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true });
    const e = m.envelope;
    const body = (p.text ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    return { id, subject: (e?.subject ?? p.subject ?? "").trim() || "(sin asunto)", from: who(e?.from?.[0]), to: (e?.to ?? []).map(who).filter(Boolean).slice(0, 4).join(", "), at: new Date(e?.date ?? m.internalDate ?? Date.now()), preview: body.replace(/\s+/g, " ").slice(0, 220), body };
  });
}

// ---------- sending from this mailbox ----------

type Rcpt = string | { address: string; name?: string };
export type OwnBoxMessage = { to: Rcpt; alsoTo?: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string; senderName?: string; attachments?: { name: string; mime: string; data: Uint8Array; cid?: string }[] };

/** Sends through the mailbox's own outgoing server, then leaves a copy in its sent folder (a copy that cannot be
 *  saved never fails the send: the email already went out). Errors from the send itself are thrown as they come. */
export async function ownBoxSend(m: OwnBoxMessage) {
  const b = imapBox();
  if (!b.ready) throw new Error(`Faltan datos del buzón en Render: ${b.missing.join(", ")}`);
  const host = env("MAILBOX2_SMTP_HOST") || b.host;
  const port = Number(env("MAILBOX2_SMTP_PORT") || "465") || 465;
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465 && !plainOk(), ignoreTLS: plainOk(), auth: { user: b.user, pass: b.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  const message = {
    messageId: `<${randomUUID()}@${b.address.split("@")[1] ?? "solu"}>`, date: new Date(),
    from: m.senderName ? { name: m.senderName, address: b.address } : b.address,
    to: m.alsoTo?.length ? [m.to, ...m.alsoTo] : m.to, cc: m.cc?.length ? m.cc : undefined, bcc: m.bcc?.length ? m.bcc : undefined,
    subject: m.subject, text: m.text, html: m.html,
    attachments: m.attachments?.map((a) => ({ filename: a.name, content: Buffer.from(a.data), contentType: a.mime, ...(a.cid ? { cid: a.cid, contentDisposition: "inline" as const } : {}) })),
  };
  try { await transport.sendMail(message); } finally { transport.close(); }
  try {
    const mc = new MailComposer(message).compile();
    (mc as unknown as { keepBcc: boolean }).keepBcc = true;
    const raw = await mc.build();
    await withBox("out", async (c, path) => { await c.append(path, raw, ["\\Seen"]); }, false);
  } catch (e) { console.error("[mailbox2] sent, but the copy was not saved in the sent folder:", e instanceof Error ? e.message : e); }
}
