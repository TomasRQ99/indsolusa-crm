import { db } from "./db";
import { forgetGraphToken, graphAccessToken, mailConfig } from "./mail";
import { refreshUnderstanding } from "./comm-store";

// Brings customer emails from the company mailbox (MAIL_FROM, e.g. sales@) into Communication Intelligence.
// Only messages from known customers are imported: a registered contact's email, or a customer's own domain.
// Everything else stays in Outlook untouched. Needs the Mail.Read application permission in Microsoft Entra.

export class CommMailError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "DENIED" | "OTHER", msg?: string) {
    super(msg ?? code);
  }
}

const PUBLIC = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "msn.com", "yahoo.es", "hotmail.es", "outlook.es", "aol.com", "proton.me", "protonmail.com"]);
const domainOf = (email: string) => email.split("@")[1]?.toLowerCase().trim() ?? "";
const hostOf = (url: string | null) => {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

type GraphMsg = {
  id: string;
  conversationId: string;
  subject: string | null;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { content?: string };
  bodyPreview?: string;
};

let lastSync = 0;

/** Imports recent customer emails. Throttled to once every 5 minutes unless forced. */
export async function syncCustomerEmails(opts: { force?: boolean } = {}) {
  if (!opts.force && Date.now() - lastSync < 5 * 60e3) return { imported: 0, skipped: 0, throttled: true };
  const c = mailConfig();
  if (c.provider !== "graph" || !c.from) throw new CommMailError("NOT_CONFIGURED");
  const token = await graphAccessToken();
  if (!token) throw new CommMailError("NOT_CONFIGURED");
  lastSync = Date.now();

  // Who counts as a known customer.
  const contacts = await db.contact.findMany({ where: { email: { not: null } }, select: { id: true, email: true, firstName: true, lastName: true, accountId: true } });
  const byEmail = new Map(contacts.map((k) => [k.email!.toLowerCase().trim(), k]));
  const accounts = await db.account.findMany({ select: { id: true, website: true } });
  const byDomain = new Map<string, string>();
  for (const k of contacts) {
    const dom = domainOf(k.email!);
    if (k.accountId && dom && !PUBLIC.has(dom)) byDomain.set(dom, k.accountId);
  }
  for (const a of accounts) {
    const h = hostOf(a.website);
    if (h && !PUBLIC.has(h)) byDomain.set(h, a.id);
  }
  const ownDomain = domainOf(c.from);

  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.from)}/mailFolders/inbox/messages` +
    `?$top=50&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}` +
    `&$select=id,conversationId,subject,receivedDateTime,from,body,bodyPreview`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } });
  if (res.status === 401) forgetGraphToken();
  if (res.status === 401 || res.status === 403) throw new CommMailError("DENIED");
  if (!res.ok) throw new CommMailError("OTHER", `Graph ${res.status}`);
  const data = (await res.json()) as { value: GraphMsg[] };

  let imported = 0;
  let skipped = 0;
  const touched = new Set<string>();
  for (const m of data.value ?? []) {
    const addr = m.from?.emailAddress?.address?.toLowerCase().trim() ?? "";
    const dom = domainOf(addr);
    if (!addr || dom === ownDomain) { skipped++; continue; }
    const contact = byEmail.get(addr);
    const accountId = contact?.accountId ?? byDomain.get(dom) ?? null;
    if (!contact && !accountId) { skipped++; continue; }
    if (await db.commMessage.findUnique({ where: { externalId: `graph:${m.id}` }, select: { id: true } })) continue;

    const sentAt = new Date(m.receivedDateTime);
    const key = `email:${m.conversationId}`;
    const name = m.from?.emailAddress?.name || (contact ? `${contact.firstName} ${contact.lastName}` : addr);
    const thread = await db.commThread.upsert({
      where: { externalKey: key },
      create: { channel: "EMAIL", externalKey: key, subject: m.subject ?? null, partyName: name, partyAddr: addr, accountId, contactId: contact?.id ?? null, lastAt: sentAt, lastInAt: sentAt },
      update: {},
    });
    await db.commMessage.create({
      data: { threadId: thread.id, direction: "IN", authorName: name, body: cleanBody(m.body?.content ?? m.bodyPreview ?? ""), sentAt, externalId: `graph:${m.id}` },
    });
    await db.commThread.update({
      where: { id: thread.id },
      data: { lastAt: sentAt > thread.lastAt ? sentAt : thread.lastAt, lastInAt: !thread.lastInAt || sentAt > thread.lastInAt ? sentAt : thread.lastInAt, closedAt: null },
    });
    touched.add(thread.id);
    imported++;
  }
  for (const id of touched) await refreshUnderstanding(id);
  return { imported, skipped, throttled: false };
}

/** Keep the customer's new text, drop quoted history and long signatures. */
function cleanBody(s: string) {
  const lines = s.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^(-{2,}|_{5,}|De:|From:|El .+ escribió:|On .+ wrote:|Enviado desde|Sent from)/.test(l.trim()));
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return kept.slice(0, 4000);
}
