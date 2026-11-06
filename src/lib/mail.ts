import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { COMPANY_NAME } from "./brand";

// Two ways to send from the company mailbox:
//  - "graph": Microsoft Graph API with an app registration (preferred for Microsoft 365;
//    used automatically when GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are set)
//  - "smtp":  classic SMTP login (fallback, e.g. GoDaddy Professional Email)

type Recipient = Mail.Address | string;

class MailError extends Error {}

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

export async function sendMail(opts: { to: Recipient; subject: string; text: string; senderName?: string }) {
  // Test mode: MAIL_DRY_RUN=1 writes the email to the server log instead of sending it.
  if (process.env.MAIL_DRY_RUN === "1") {
    console.log(`[MAIL_DRY_RUN] to=${toAddress(opts.to).address} subject=${opts.subject}\n${opts.text}\n[/MAIL_DRY_RUN]`);
    return;
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
  opts: { to: Recipient; subject: string; text: string },
) {
  const token = await graphToken(g);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: opts.subject,
        body: { contentType: "Text", content: opts.text },
        toRecipients: [{ emailAddress: toAddress(opts.to) }],
        bccRecipients: bccList().map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true, // the email appears in the mailbox's Sent Items
    }),
  });
  if (res.status === 202) return;

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
  opts: { to: Recipient; subject: string; text: string; senderName?: string },
) {
  transporter ??= nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure, // true = implicit TLS (465); false = STARTTLS (587)
    requireTLS: !s.secure,
    auth: { user: s.user, pass: s.pass },
  });
  const bcc = bccList();
  await transporter.sendMail({
    // The From address must be the authenticated mailbox; only the display name varies.
    from: { name: opts.senderName ? `${opts.senderName} | ${COMPANY_NAME}` : `${COMPANY_NAME} Sales`, address: from },
    to: opts.to,
    bcc: bcc.length ? bcc : undefined,
    subject: opts.subject,
    text: opts.text,
  });
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
