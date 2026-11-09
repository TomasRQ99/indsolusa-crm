// E2: did they answer our email? Reads the company mailbox (sales@) with Mail.Read — read-only,
// nothing is moved, marked or deleted in Outlook. Only messages that answer an email SOLU sent are
// looked at: matched by Outlook conversation, or by our reference code in the subject from the same
// address/domain. Stored per email: when the reply came, from which address, its subject and a short
// preview. Results are reported per template and per supplier — never per person.
import { db } from "./db";
import { forgetGraphToken, graphAccessToken, mailConfig } from "./mail";

export type OutboundInput = {
  template: string; refKind: "RFQR" | "OFFER" | "SPO" | "QUOTE" | "INVOICE"; refId: string; refCode: string | null;
  partyKind: "SUPPLIER" | "CUSTOMER"; supplierId?: string | null; accountId?: string | null; dealId?: string | null;
  toAddr: string; subject: string;
};

/** Remembers a sent email so its reply can be found. Never blocks or breaks the send. */
export async function recordOutbound(o: OutboundInput) {
  try {
    await db.outboundMail.create({ data: { ...o, toAddr: o.toAddr.toLowerCase().trim(), subject: o.subject.slice(0, 250), refCode: o.refCode?.slice(0, 60) ?? null } });
  } catch (e) {
    console.error("recordOutbound failed", e);
  }
}

// ---------- Graph access (test overrides only outside production) ----------
const test = () => process.env.NODE_ENV !== "production";
const base = () => (test() && process.env.GRAPH_API_BASE) || "https://graph.microsoft.com";
const token = async () => (test() && process.env.GRAPH_TEST_TOKEN) || graphAccessToken();

export class ReplySyncError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "DENIED" | "OTHER", msg?: string) { super(msg ?? code); }
}

type GMsg = {
  id: string; conversationId?: string; subject?: string | null; receivedDateTime?: string; sentDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } }; toRecipients?: { emailAddress?: { address?: string } }[]; bodyPreview?: string;
};

async function graphList(path: string, tk: string, maxPages = 5): Promise<GMsg[]> {
  const out: GMsg[] = [];
  let url: string | null = `${base()}${path}`;
  for (let p = 0; url && p < maxPages; p++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
    let res: Response;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` }, signal: ctl.signal }); }
    catch (e) { throw new ReplySyncError("OTHER", `No se pudo conectar con Microsoft (${(e as Error).name})`); }
    finally { clearTimeout(timer); }
    if (res.status === 401) forgetGraphToken();
    if (res.status === 401 || res.status === 403) throw new ReplySyncError("DENIED");
    if (!res.ok) throw new ReplySyncError("OTHER", `Microsoft Graph ${res.status}`);
    const data = (await res.json()) as { value?: GMsg[]; "@odata.nextLink"?: string };
    out.push(...(data.value ?? []));
    const next: string | undefined = data["@odata.nextLink"];
    // Follow paging only on Graph's own host (or the test base).
    url = next && (next.startsWith("https://graph.microsoft.com/") || (test() && next.startsWith(base()))) ? next : null;
  }
  return out;
}

// ---------- matching helpers ----------
const PUBLIC = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "msn.com", "yahoo.es", "hotmail.es", "outlook.es", "aol.com", "proton.me", "protonmail.com"]);
const domainOf = (a: string) => a.split("@")[1]?.toLowerCase().trim() ?? "";
export const normSubject = (s: string | null | undefined) =>
  (s ?? "").replace(/^(\s*(re|rv|fw|fwd|aw|wg|tr|sv|r|res|resp|respuesta|reenviar|enc)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/[\s ]+/g, " ").trim().toLowerCase();
const AUTO = /^(automatic reply|auto(matic)?[- ]?(reply|response)|respuesta autom[aá]tica|out of (the )?office|fuera de la oficina|ausente|abwesend|r[ée]ponse automatique)/i;
const BOUNCE = /^(undeliverable|undelivered|no se puede entregar|no entregado|mail delivery (failed|subsystem)|delivery status notification|returned mail|failure notice|delivery has failed|non remis)/i;
const isDaemon = (a: string) => /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]*)@/i.test(a);
const stripPrefix = (s: string) => s.replace(/^(\s*(re|rv|fw|fwd|aw)\s*:\s*)+/i, "");

let last: { at: Date; ok: boolean; code?: string; message?: string; found: number; open: number } | null = null;
let running: Promise<SyncResult> | null = null;
export const lastReplySync = () => last;

type SyncResult = { found: number; auto: number; bounced: number; open: number; throttled?: boolean };

/** Looks for replies to the emails SOLU sent in the last 45 days. Throttled to every 10 minutes unless forced. */
export async function syncReplies(opts: { force?: boolean } = {}): Promise<SyncResult> {
  if (!opts.force && last && Date.now() - last.at.getTime() < 10 * 60e3) return { found: 0, auto: 0, bounced: 0, open: last.open, throttled: true };
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run(): Promise<SyncResult> {
  const c = mailConfig();
  try {
    if (!test() || !process.env.GRAPH_API_BASE) { if (c.provider !== "graph" || !c.from) throw new ReplySyncError("NOT_CONFIGURED"); }
    const from = c.from ?? "sales@test.invalid";
    const tk = await token().catch((e) => { throw new ReplySyncError("OTHER", (e as Error).message); });
    if (!tk) throw new ReplySyncError("NOT_CONFIGURED");
    const open = await db.outboundMail.findMany({ where: { repliedAt: null, bouncedAt: null, sentAt: { gte: new Date(Date.now() - 45 * 864e5) } }, orderBy: { sentAt: "asc" } });
    const box = `/v1.0/users/${encodeURIComponent(from)}/mailFolders`;
    // Nothing pending: still make one tiny read so the permission (Mail.Read) is verified.
    if (!open.length) { await graphList(`${box}/inbox/messages?$top=1&$select=id`, tk, 1); last = { at: new Date(), ok: true, found: 0, open: 0 }; return { found: 0, auto: 0, bounced: 0, open: 0 }; }
    const since = new Date(open[0].sentAt.getTime() - 10 * 60e3).toISOString();

    // 1) Learn the Outlook conversation of each sent email from Sent Items (same subject + recipient, ±15 min).
    const needConv = open.filter((m) => !m.conversationId);
    if (needConv.length) {
      const sent = await graphList(`${box}/sentitems/messages?$top=100&$orderby=sentDateTime desc&$filter=sentDateTime ge ${since}&$select=id,conversationId,subject,sentDateTime,toRecipients`, tk);
      for (const m of needConv) {
        const hit = sent.find((s) => s.conversationId && normSubject(s.subject) === normSubject(m.subject)
          && (s.toRecipients ?? []).some((r) => r.emailAddress?.address?.toLowerCase().trim() === m.toAddr)
          && Math.abs(new Date(s.sentDateTime ?? 0).getTime() - m.sentAt.getTime()) < 15 * 60e3);
        if (hit) { m.conversationId = hit.conversationId!; await db.outboundMail.update({ where: { id: m.id }, data: { conversationId: hit.conversationId } }); }
      }
    }

    // 2) Read the inbox since the oldest open email (metadata + preview only), oldest first.
    const inbox = (await graphList(`${box}/inbox/messages?$top=100&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}&$select=id,conversationId,subject,receivedDateTime,from,bodyPreview`, tk))
      .sort((a, b) => new Date(a.receivedDateTime ?? 0).getTime() - new Date(b.receivedDateTime ?? 0).getTime());
    const own = domainOf(from);
    let found = 0, auto = 0, bounced = 0;
    for (const m of open) {
      const after = (x: GMsg) => new Date(x.receivedDateTime ?? 0).getTime() > m.sentAt.getTime();
      const sameParty = (addr: string) => addr === m.toAddr || (!PUBLIC.has(domainOf(m.toAddr)) && domainOf(addr) === domainOf(m.toAddr));
      const code = m.refCode?.toLowerCase();
      const candidates = inbox.filter((x) => {
        const addr = x.from?.emailAddress?.address?.toLowerCase().trim() ?? "";
        if (!addr || !after(x)) return false;
        if (isDaemon(addr) || BOUNCE.test(stripPrefix(x.subject ?? ""))) {
          // A bounce belongs to this email if it's in the same conversation, or quotes its subject AND
          // names its address (one RFQ goes to many suppliers with the same subject).
          if (m.conversationId && x.conversationId === m.conversationId) return true;
          if (!normSubject(x.subject).includes(normSubject(m.subject))) return false;
          const twins = open.filter((o) => normSubject(o.subject) === normSubject(m.subject) && o.toAddr !== m.toAddr).length;
          return (x.bodyPreview ?? "").toLowerCase().includes(m.toAddr) || twins === 0;
        }
        if (domainOf(addr) === own) return false; // our own colleagues forwarding/answering internally
        if (m.conversationId && x.conversationId === m.conversationId) return true;
        return !!code && sameParty(addr) && normSubject(x.subject).includes(code);
      });
      let autoAt: Date | null = null;
      for (const x of candidates) {
        const addr = x.from!.emailAddress!.address!.toLowerCase().trim();
        const subj = stripPrefix(x.subject ?? "");
        const at = new Date(x.receivedDateTime!);
        if (isDaemon(addr) || BOUNCE.test(subj)) {
          await db.outboundMail.update({ where: { id: m.id }, data: { bouncedAt: at } });
          if (m.refKind === "RFQR") await db.rfqRecipient.updateMany({ where: { id: m.refId, status: "SENT" }, data: { status: "FAILED", error: "El correo rebotó: revisa la dirección del proveedor." } });
          bounced++; break;
        }
        if (AUTO.test(subj)) { autoAt ??= at; continue; }
        await db.outboundMail.update({ where: { id: m.id }, data: { repliedAt: at, replyFrom: addr.slice(0, 200), replySubject: (x.subject ?? "").slice(0, 250), replyPreview: (x.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 200), autoReplyAt: autoAt ?? m.autoReplyAt } });
        if (m.refKind === "RFQR") await db.rfqRecipient.updateMany({ where: { id: m.refId, repliedAt: null }, data: { repliedAt: at } });
        found++; autoAt = null; break;
      }
      if (autoAt && !m.autoReplyAt) { await db.outboundMail.update({ where: { id: m.id }, data: { autoReplyAt: autoAt } }); auto++; }
    }
    const stillOpen = open.length - found - bounced;
    last = { at: new Date(), ok: true, found, open: stillOpen };
    return { found, auto, bounced, open: stillOpen };
  } catch (e) {
    const err = e instanceof ReplySyncError ? e : new ReplySyncError("OTHER", (e as Error).message);
    last = { at: new Date(), ok: false, code: err.code, message: err.message, found: 0, open: last?.open ?? 0 };
    throw err;
  }
}

/** For page renders: throttled, at most ~6 s, never throws (the error shows from lastReplySync()). */
export async function syncRepliesQuietly() {
  if (process.env.MAIL_DRY_RUN === "1" && !(test() && process.env.GRAPH_API_BASE)) return;
  await Promise.race([syncReplies().catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
}

// ---------- reporting (per template and per supplier only) ----------
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const hours = (m: { sentAt: Date; repliedAt: Date | null }) => (m.repliedAt!.getTime() - m.sentAt.getTime()) / 3_600_000;
type Agg = { sent: number; replied: number; auto: number; bounced: number; waiting: number; medianHours: number | null; lastReply: Date | null };
function agg(ms: { sentAt: Date; repliedAt: Date | null; autoReplyAt: Date | null; bouncedAt: Date | null }[]): Agg {
  const r = ms.filter((m) => m.repliedAt);
  return {
    sent: ms.length, replied: r.length, auto: ms.filter((m) => m.autoReplyAt && !m.repliedAt).length, bounced: ms.filter((m) => m.bouncedAt).length,
    waiting: ms.filter((m) => !m.repliedAt && !m.bouncedAt).length, medianHours: median(r.map(hours)),
    lastReply: r.reduce<Date | null>((a, m) => (!a || m.repliedAt! > a ? m.repliedAt! : a), null),
  };
}

export async function replyReport(days = 90) {
  const ms = await db.outboundMail.findMany({ where: { sentAt: { gte: new Date(Date.now() - days * 864e5) } }, orderBy: { sentAt: "desc" }, include: { supplier: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } } });
  const templates = [...new Set(ms.map((m) => m.template))].map((tpl) => ({ tpl, ...agg(ms.filter((m) => m.template === tpl)) }));
  const supIds = [...new Set(ms.filter((m) => m.supplierId).map((m) => m.supplierId!))];
  const suppliers = supIds.map((id) => { const g = ms.filter((m) => m.supplierId === id); return { id, name: g[0].supplier?.name ?? "—", ...agg(g) }; })
    .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
  // Waiting more than 2 days, oldest first; one line per email (a record, not a person).
  const waiting = ms.filter((m) => !m.repliedAt && !m.bouncedAt && Date.now() - m.sentAt.getTime() > 48 * 3_600_000).reverse().slice(0, 40);
  const recent = ms.filter((m) => m.repliedAt || m.bouncedAt).sort((a, b) => ((b.repliedAt ?? b.bouncedAt)!.getTime() - (a.repliedAt ?? a.bouncedAt)!.getTime())).slice(0, 20);
  return { total: agg(ms), templates, suppliers, waiting, recent, days };
}
