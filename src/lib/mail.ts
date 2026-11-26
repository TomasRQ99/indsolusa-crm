import { ownBoxSend } from "./mailbox-imap";
import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { COMPANY_NAME } from "./brand";

// Two ways to send from the company mailbox:
//  - "graph": Microsoft Graph API with an app registration (preferred for Microsoft 365;
//    used automatically when GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are set)
//  - "smtp":  classic SMTP login (fallback, e.g. GoDaddy Professional Email)

type Recipient = Mail.Address | string;
/** A file sent with the email. Microsoft's simple send accepts about 3 MB in total, so callers keep to that. */
/** `cid`: the file is a picture shown inside the email (the HTML refers to it as cid:<that name>), not a file to download. */
export type MailAttachment = { name: string; mime: string; data: Uint8Array; cid?: string };
export const MAX_ATTACH_BYTES = 3 * 1024 * 1024;

class MailError extends Error {}
/** The request may have reached the mail server but no answer came back (network cut, timeout,
 *  server error). The email MAY have been sent: never retry blindly — reconcile with Sent Items. */
export class MailUncertainError extends Error {}
export const isMailUncertain = (e: unknown) => e instanceof MailUncertainError;

// Values pasted into hosting dashboards often pick up stray spaces or the quote marks
// copied from a .env line; strip those so they don't break sign-in.
function env(name: string) {
  const v = process.env[name]?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return v ? v : undefined;
}

export function mailConfig() {
  const from = env("MAIL_FROM") || env("SMTP_USER");
  const tenant = env("GRAPH_TENANT_ID");
  const clientId = env("GRAPH_CLIENT_ID");
  const clientSecret = env("GRAPH_CLIENT_SECRET");

  if (tenant && clientId && clientSecret) {
    return {
      provider: "graph" as const,
      from,
      configured: Boolean(from),
      description: "Microsoft 365 (Microsoft Graph)",
      graph: { tenant, clientId, clientSecret },
    };
  }

  const port = Number(env("SMTP_PORT") ?? 465);
  const secure = (env("SMTP_SECURE") ?? String(port === 465)) === "true";
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  return {
    provider: "smtp" as const,
    from,
    configured: Boolean(host && user && pass && from),
    description: `${host}:${port} (${secure ? "SSL" : "STARTTLS"})`,
    smtp: { host, port, secure, user, pass },
  };
}

function toAddress(r: Recipient) {
  return typeof r === "string" ? { address: r } : { address: r.address, name: r.name };
}

function bccList() {
  return (process.env.MAIL_BCC ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `html` is optional: when given, Outlook shows it (the plain `text` stays as the fallback). */
export async function sendMail(opts: { to: Recipient; alsoTo?: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string; senderName?: string; attachments?: MailAttachment[]; /** send from the person's own connected mailbox (mailbox-imap.ts) instead of the company address */ viaOwnBox?: boolean }) {
  // Test mode: MAIL_DRY_RUN=1 writes the email to the server log instead of sending it.
  // Test mode for the uncertain path: logs, then behaves as if the connection was cut mid-send.
  if (process.env.MAIL_DRY_RUN === "uncertain") {
    console.log(`[MAIL_DRY_RUN uncertain] to=${toAddress(opts.to).address} subject=${opts.subject}`);
    throw new MailUncertainError("Test: no answer while sending.");
  }
  if (process.env.MAIL_DRY_RUN === "1") {
    console.log(`[MAIL_DRY_RUN] to=${toAddress(opts.to).address}${opts.alsoTo?.length ? ` +to=${opts.alsoTo.length}` : ""}${opts.cc?.length ? ` cc=${opts.cc.length}` : ""}${opts.bcc?.length ? ` bcc=${opts.bcc.length}` : ""} subject=${opts.subject}${opts.attachments?.length ? ` attachments=${opts.attachments.map((a) => a.name).join(", ")}` : ""}\n${opts.text}\n[/MAIL_DRY_RUN]`);
    return;
  }
  if (opts.viaOwnBox) {
    try { return await ownBoxSend(opts); } catch (e) {
      const err = e as { code?: string; command?: string; responseCode?: number };
      if (err.command === "DATA" || (!err.responseCode && err.command !== "CONN" && /ETIMEDOUT|ECONNRESET|ESOCKET/.test(err.code ?? ""))) throw new MailUncertainError("The mail server stopped answering while sending: it may have gone out.");
      if (err.responseCode === 535 || err.code === "EAUTH") throw new MailError("El servidor del buzón no aceptó el usuario o la contraseña (MAILBOX2_PASSWORD en Render).");
      throw e;
    }
  }
  const c = mailConfig();
  if (!c.configured) {
    throw new MailError("Email is not configured. Set the Microsoft Graph (or SMTP) settings and MAIL_FROM in .env.");
  }
  if (c.provider === "graph") return sendViaGraph(c.graph, c.from!, opts);
  return sendViaSmtp(c.smtp, c.from!, opts);
}

// ---------- Microsoft Graph ----------

let cachedToken: { value: string; expires: number } | null = null;

async function graphToken(g: { tenant: string; clientId: string; clientSecret: string }) {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) throw new MailError(explainTokenError(data.error_description ?? ""));

  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** App-only Microsoft Graph token (same app registration used for email). Null when Graph isn't configured. */
export async function graphAccessToken() {
  const c = mailConfig();
  if (c.provider !== "graph") return null;
  return graphToken(c.graph);
}

export function forgetGraphToken() {
  cachedToken = null;
}

function explainTokenError(desc: string) {
  if (desc.includes("AADSTS7000215")) {
    return "Microsoft rejected the client secret. Check GRAPH_CLIENT_SECRET: use the secret's Value, not its Secret ID.";
  }
  if (desc.includes("AADSTS7000222")) return "The client secret has expired. Create a new one in the app registration.";
  if (desc.includes("AADSTS700016")) return "Microsoft could not find that app. Check GRAPH_CLIENT_ID and GRAPH_TENANT_ID.";
  if (desc.includes("AADSTS90002") || desc.includes("AADSTS900023")) return "The tenant ID is wrong. Check GRAPH_TENANT_ID.";
  return `Microsoft sign-in failed: ${desc.split("\r\n")[0] || "unknown error"}`;
}

async function sendViaGraph(
  g: { tenant: string; clientId: string; clientSecret: string },
  from: string,
  opts: { to: Recipient; alsoTo?: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[] },
) {
  const token = await graphToken(g);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    signal: ctl.signal,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: opts.subject,
        body: opts.html ? { contentType: "HTML", content: opts.html } : { contentType: "Text", content: opts.text },
        toRecipients: [{ emailAddress: toAddress(opts.to) }, ...(opts.alsoTo ?? []).map((address) => ({ emailAddress: { address } }))],
        ...(opts.cc?.length ? { ccRecipients: opts.cc.map((address) => ({ emailAddress: { address } })) } : {}),
        bccRecipients: [...new Set([...bccList(), ...(opts.bcc ?? [])])].map((address) => ({ emailAddress: { address } })),
        ...(opts.attachments?.length ? { attachments: opts.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.mime, contentBytes: Buffer.from(a.data).toString("base64"), ...(a.cid ? { isInline: true, contentId: a.cid } : {}) })) } : {}),
      },
      saveToSentItems: true, // the email appears in the mailbox's Sent Items
    }),
  });
  } catch {
    // No answer (timeout / connection cut after the request left): it may or may not have been sent.
    throw new MailUncertainError("No answer from Microsoft while sending: it may have gone out. SOLU checks Sent Items before any retry.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 202) return;
  if (res.status >= 500) throw new MailUncertainError(`Microsoft answered ${res.status} while sending: it may have gone out. SOLU checks Sent Items before any retry.`);

  if (res.status === 401) cachedToken = null;
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = data.error?.code ?? "";
  if (res.status === 403 || code === "ErrorAccessDenied") {
    throw new MailError(
      `Microsoft denied sending as ${from}. Make sure the app has the Mail.Send application permission and that "Grant admin consent" was clicked.`,
    );
  }
  if (res.status === 404 || code === "ErrorInvalidUser" || code === "MailboxNotEnabledForRESTAPI") {
    throw new MailError(`Microsoft could not find the mailbox ${from}. Check MAIL_FROM.`);
  }
  throw new MailError(`Microsoft Graph error ${res.status}${code ? ` (${code})` : ""}: ${data.error?.message ?? "unknown"}`);
}

// ---------- SMTP ----------

let transporter: Transporter | null = null;

async function sendViaSmtp(
  s: { host?: string; port: number; secure: boolean; user?: string; pass?: string },
  from: string,
  opts: { to: Recipient; alsoTo?: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string; senderName?: string; attachments?: MailAttachment[] },
) {
  transporter ??= nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure, // true = implicit TLS (465); false = STARTTLS (587)
    requireTLS: !s.secure,
    auth: { user: s.user, pass: s.pass },
  });
  const bcc = [...new Set([...bccList(), ...(opts.bcc ?? [])])];
  try { await transporter.sendMail({
    // The From address must be the authenticated mailbox; only the display name varies.
    from: { name: opts.senderName ? `${opts.senderName} | ${COMPANY_NAME}` : `${COMPANY_NAME} Sales`, address: from },
    to: opts.alsoTo?.length ? [opts.to, ...opts.alsoTo] : opts.to,
    cc: opts.cc?.length ? opts.cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({ filename: a.name, content: Buffer.from(a.data), contentType: a.mime, ...(a.cid ? { cid: a.cid, contentDisposition: "inline" as const } : {}) })),
  }); } catch (e) {
    const err = e as { code?: string; command?: string; responseCode?: number };
    if (err.command === "DATA" || (!err.responseCode && err.command !== "CONN" && /ETIMEDOUT|ECONNRESET|ESOCKET/.test(err.code ?? ""))) throw new MailUncertainError("The mail server stopped answering while sending: it may have gone out.");
    throw e;
  }
}

export function describeMailError(e: unknown) {
  if (e instanceof MailError) return e.message;
  const err = e as { code?: string; message?: string };
  const c = mailConfig();
  if (c.provider === "smtp") {
    if (err.code === "EAUTH") {
      return `The mail server rejected the login for ${c.smtp.user}. Check SMTP_USER and SMTP_PASS in .env.`;
    }
    if (err.code === "ESOCKET" || err.code === "ECONNECTION" || err.code === "ETIMEDOUT") {
      return `Could not connect to ${c.smtp.host}:${c.smtp.port}. Check SMTP_HOST, SMTP_PORT and SMTP_SECURE.`;
    }
  }
  return err.message ?? "The email could not be sent.";
}
