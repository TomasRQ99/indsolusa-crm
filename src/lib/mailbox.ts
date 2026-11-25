// Reading a mailbox to pick ONE email and build a Need from it (owner, 2026-11-25: "tengo unos correos que envié y
// quisiera… crear necesidades en base a correos enviados"; "conectar <su correo>").
//
// Read-only: nothing is moved, marked or stored. A person can open two mailboxes: their own (the email they log in
// with, the same rule as the Outlook calendar) and the company's (MAIL_FROM). Microsoft only answers for mailboxes of
// the same Microsoft 365 account as the company's, and only with the Mail.Read application permission.

import { forgetGraphToken, graphAccessToken, mailConfig } from "./mail";

export type BoxKey = "mio" | "empresa";
export type Folder = "in" | "out";
export class MailboxError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "DENIED" | "NO_MAILBOX" | "OTHER", msg?: string) { super(msg ?? code); }
}
export type MailRow = { id: string; subject: string; from: string; to: string; at: Date; preview: string };
export type MailFull = MailRow & { body: string };

type Addr = { emailAddress?: { name?: string; address?: string } };
type Raw = { id: string; subject?: string | null; from?: Addr; toRecipients?: Addr[]; receivedDateTime?: string; sentDateTime?: string; bodyPreview?: string; body?: { content?: string } };
const who = (a?: Addr) => { const n = a?.emailAddress?.name?.trim(); const e = a?.emailAddress?.address?.trim(); return n && e && n.toLowerCase() !== e.toLowerCase() ? `${n} <${e}>` : e || n || ""; };
const row = (m: Raw, folder: Folder): MailRow => ({
  id: m.id, subject: (m.subject ?? "").trim() || "(sin asunto)", from: who(m.from), to: (m.toRecipients ?? []).map(who).filter(Boolean).slice(0, 4).join(", "),
  at: new Date((folder === "out" ? m.sentDateTime : m.receivedDateTime) ?? m.receivedDateTime ?? m.sentDateTime ?? Date.now()), preview: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
});

/** The address behind "mio" / "empresa" for this person. Never taken from the URL. */
export function boxAddress(box: BoxKey, user: { email: string }) {
  return box === "empresa" ? mailConfig().from ?? null : user.email;
}

async function graph(path: string) {
  if (mailConfig().provider !== "graph") throw new MailboxError("NOT_CONFIGURED");
  const tk = await graphAccessToken();
  if (!tk) throw new MailboxError("NOT_CONFIGURED");
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  let res: Response;
  try { res = await fetch(`${process.env.NODE_ENV !== "production" && process.env.GRAPH_API_BASE ? process.env.GRAPH_API_BASE : "https://graph.microsoft.com"}/v1.0${path}`, { headers: { Authorization: `Bearer ${tk}`, Prefer: 'outlook.body-content-type="text"' }, signal: ctl.signal }); }
  catch (e) { throw new MailboxError("OTHER", `No se pudo conectar con Microsoft (${(e as Error).name})`); }
  finally { clearTimeout(timer); }
  if (res.status === 401) forgetGraphToken();
  if (res.status === 401 || res.status === 403) throw new MailboxError("DENIED");
  if (res.status === 404) throw new MailboxError("NO_MAILBOX");
  if (!res.ok) throw new MailboxError("OTHER", `Microsoft Graph ${res.status}`);
  return res.json();
}

/** The latest emails of one folder, newest first. */
export async function listMail(address: string, folder: Folder, top = 30): Promise<MailRow[]> {
  const f = folder === "out" ? "sentitems" : "inbox";
  const order = folder === "out" ? "sentDateTime" : "receivedDateTime";
  const data = (await graph(`/users/${encodeURIComponent(address)}/mailFolders/${f}/messages?$top=${top}&$orderby=${order} desc&$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview`)) as { value?: Raw[] };
  return (data.value ?? []).map((m) => row(m, folder));
}

/** One email with its text. */
export async function getMail(address: string, id: string, folder: Folder): Promise<MailFull> {
  const m = (await graph(`/users/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,body`)) as Raw;
  return { ...row(m, folder), body: (m.body?.content ?? m.bodyPreview ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() };
}

/** The email as the case for "Crear Necesidad con IA". */
export function mailAsCase(m: MailFull, folder: Folder) {
  const head = folder === "out"
    ? `Correo que NOSOTROS enviamos (el cliente es quien lo recibió).\nPara: ${m.to || "—"}`
    : `Correo que RECIBIMOS.\nDe: ${m.from || "—"}`;
  return `${head}\nFecha: ${m.at.toISOString().slice(0, 10)}\nAsunto: ${m.subject}\n\n${m.body}`.slice(0, 7800);
}
