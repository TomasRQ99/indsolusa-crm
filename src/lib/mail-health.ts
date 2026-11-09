// E3: will our emails arrive? Read-only checks:
//  1) DNS of the sending domain (from MAIL_FROM): SPF, DKIM (Microsoft 365 selectors), DMARC, MX.
//     Only public DNS lookups — nothing is changed anywhere. Fixes are explained, never applied.
//  2) Links inside emails: tracking parameters (removed before sending), link shorteners, plain
//     http, raw IP addresses, link text that shows a different site than the real link.
//  3) The six SOLU templates rendered with sample data: size, links, subject length, capitals.
import { Resolver } from "node:dns/promises";
import { mailConfig } from "./mail";
import { deliveryMail, followUpMail, negotiateMail, offerMail, paymentMail, rfqMail, TEMPLATES, type Mail, type TemplateKey } from "./email-templates";

export type Level = "ok" | "warn" | "fail" | "info";
export type Check = { key: string; level: Level; title: { es: string; en: string }; found: string | null; meaning: { es: string; en: string }; fix: { es: string; en: string } | null };
export type Dns = { txt(name: string): Promise<string[]>; cname(name: string): Promise<string[]>; mx(name: string): Promise<string[]> };

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN"]);
export class DnsDown extends Error {}

export function systemDns(): Dns {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  const wrap = async <T>(fn: () => Promise<T>, empty: T): Promise<T> => {
    try { return await fn(); } catch (e) { const code = (e as { code?: string }).code ?? ""; if (NOT_FOUND.has(code)) return empty; throw new DnsDown(code || (e as Error).message); }
  };
  return {
    txt: (n) => wrap(async () => (await r.resolveTxt(n)).map((parts) => parts.join("")), [] as string[]),
    cname: (n) => wrap(() => r.resolveCname(n), [] as string[]),
    mx: (n) => wrap(async () => (await r.resolveMx(n)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase()), [] as string[]),
  };
}

const c = (key: string, level: Level, title: [string, string], found: string | null, meaning: [string, string], fix?: [string, string]): Check =>
  ({ key, level, title: { es: title[0], en: title[1] }, found, meaning: { es: meaning[0], en: meaning[1] }, fix: fix ? { es: fix[0], en: fix[1] } : null });

/** Counts the DNS lookups an SPF record needs (the standard allows at most 10). */
async function spfLookups(dns: Dns, record: string, depth = 0, budget = { q: 0 }, seen: Set<string> = new Set()): Promise<number> {
  let n = 0;
  for (const tok of record.split(/\s+/).slice(1)) {
    const t = tok.replace(/^[+\-~?]/, "").toLowerCase();
    if (/^(a|mx|ptr)([:/]|$)/.test(t) || t.startsWith("exists:")) n++;
    else if (t.startsWith("include:") || t.startsWith("redirect=")) {
      n++;
      const host = t.split(/[:=]/)[1];
      if (host) seen.add(host);
      if (depth < 4 && budget.q < 15 && host) {
        budget.q++;
        const sub = (await dns.txt(host).catch(() => [])).find((x) => /^v=spf1\b/i.test(x));
        if (sub) n += await spfLookups(dns, sub, depth + 1, budget, seen);
      }
    }
  }
  return n;
}

export async function checkDomain(domain: string, dns: Dns = systemDns()): Promise<Check[]> {
  const out: Check[] = [];
  const d = domain.toLowerCase().trim();
  const microsoft = (await dns.mx(d)).filter(Boolean);

  // MX: where the domain receives mail.
  const msMx = microsoft.some((m) => m.endsWith(".mail.protection.outlook.com"));
  out.push(microsoft.length
    ? c("mx", msMx ? "ok" : "info", ["Recepción de correo (MX)", "Mail receiving (MX)"], microsoft.join(", "),
      msMx ? ["El dominio recibe su correo en Microsoft 365.", "The domain receives its mail in Microsoft 365."] : ["El dominio recibe correo en otro servicio (no Microsoft 365). No impide enviar desde Microsoft.", "The domain receives mail elsewhere (not Microsoft 365). It doesn't stop sending through Microsoft."])
    : c("mx", "warn", ["Recepción de correo (MX)", "Mail receiving (MX)"], null, ["El dominio no tiene registro MX: las respuestas de clientes y proveedores no llegarían.", "The domain has no MX record: replies from customers and suppliers wouldn't arrive."], ["En GoDaddy → DNS, agrega el MX que indica Microsoft 365 (Centro de administración → Configuración → Dominios).", "In GoDaddy → DNS, add the MX record Microsoft 365 shows (Admin center → Settings → Domains)."]));

  // SPF: which servers may send for the domain.
  const spf = (await dns.txt(d)).filter((x) => /^v=spf1\b/i.test(x.trim()));
  const spfFix: [string, string] = [`En GoDaddy → Dominio ${d} → DNS → registro TXT con nombre "@" y valor: v=spf1 include:spf.protection.outlook.com -all (si ya existe uno, edítalo; nunca dejes dos).`, `In GoDaddy → domain ${d} → DNS → TXT record named "@" with value: v=spf1 include:spf.protection.outlook.com -all (if one exists, edit it; never keep two).`];
  if (!spf.length) out.push(c("spf", "fail", ["SPF (quién puede enviar)", "SPF (who may send)"], null, ["No hay SPF: Gmail y Outlook no pueden confirmar que Microsoft 365 envía por ustedes, y los correos pueden ir a spam.", "No SPF: Gmail and Outlook can't confirm Microsoft 365 sends for you, and emails may go to spam."], spfFix));
  else if (spf.length > 1) out.push(c("spf", "fail", ["SPF (quién puede enviar)", "SPF (who may send)"], spf.join("  |  "), ["Hay dos registros SPF. Eso cuenta como error y anula los dos.", "There are two SPF records. That counts as an error and voids both."], ["En GoDaddy → DNS, junta los dos en uno solo (un único registro que empiece por v=spf1).", "In GoDaddy → DNS, merge them into one (a single record starting with v=spf1)."]));
  else {
    const rec = spf[0].trim();
    const all = rec.match(/\s([+\-~?]?)all\b/i);
    // Microsoft 365 may be authorized directly or through another include (e.g. GoDaddy's secureserver.net).
    const hosts = new Set<string>();
    const lookups = await spfLookups(dns, rec, 0, { q: 0 }, hosts);
    const hasMs = hosts.has("spf.protection.outlook.com");
    const via = hasMs && !/include:spf\.protection\.outlook\.com/i.test(rec) ? [...hosts][0] : null;
    if (!hasMs) out.push(c("spf", "fail", ["SPF (quién puede enviar)", "SPF (who may send)"], rec, ["El SPF existe pero, ni directamente ni a través de sus “include”, autoriza a Microsoft 365, que es quien envía los correos de SOLU. Los correos dependen solo de DKIM para pasar.", "The SPF exists but neither directly nor through its “include”s does it authorize Microsoft 365, which sends SOLU's emails. Emails rely on DKIM alone to pass."], [`En GoDaddy → Dominio ${d} → DNS, edita ese mismo registro TXT y agrega include:spf.protection.outlook.com antes del "all". Ejemplo: v=spf1 include:secureserver.net include:spf.protection.outlook.com -all`, `In GoDaddy → domain ${d} → DNS, edit that same TXT record and add include:spf.protection.outlook.com before the "all". Example: v=spf1 include:secureserver.net include:spf.protection.outlook.com -all`]));
    else if (!all || all[1] === "+" || all[1] === "?") out.push(c("spf", "warn", ["SPF (quién puede enviar)", "SPF (who may send)"], rec, ["El SPF autoriza a Microsoft 365 pero no termina en -all o ~all, así que cualquiera podría pasar por ustedes.", "The SPF authorizes Microsoft 365 but doesn't end in -all or ~all, so anyone could pass as you."], ["Termina el registro con -all (o ~all mientras se prueba).", "End the record with -all (or ~all while testing)."]));
    else if (lookups > 10) out.push(c("spf", "fail", ["SPF (quién puede enviar)", "SPF (who may send)"], `${rec}  (${lookups} consultas DNS)`, [`El SPF necesita ${lookups} consultas DNS; el máximo permitido es 10 y por encima falla.`, `The SPF needs ${lookups} DNS lookups; the limit is 10 and above it fails.`], ["Quita de ese registro los servicios que ya no envían correo por ustedes.", "Remove services that no longer send email for you from that record."]));
    else out.push(c("spf", "ok", ["SPF (quién puede enviar)", "SPF (who may send)"], rec, [`Correcto: autoriza a Microsoft 365${via ? ` (a través de ${via})` : ""}; usa ${lookups} de 10 consultas DNS.`, `Correct: authorizes Microsoft 365${via ? ` (through ${via})` : ""}; uses ${lookups} of 10 DNS lookups.`]));
  }

  // DKIM: Microsoft 365 publishes two selectors as CNAMEs.
  const sel = await Promise.all(["selector1", "selector2"].map(async (s) => {
    const name = `${s}._domainkey.${d}`;
    const cn = await dns.cname(name);
    if (cn.length) return { s, v: cn[0] };
    const txt = (await dns.txt(name)).find((x) => /v=DKIM1|k=rsa|p=/i.test(x));
    return { s, v: txt ? "TXT DKIM" : null };
  }));
  const okSel = sel.filter((x) => x.v);
  const dkimFix: [string, string] = ["1) En Microsoft Defender (security.microsoft.com) → Políticas → Configuración de autenticación de correo → DKIM → elige el dominio y copia los dos CNAME. 2) En GoDaddy → DNS, crea esos dos CNAME (selector1._domainkey y selector2._domainkey). 3) Vuelve a Defender y activa “Firmar mensajes con DKIM”.", "1) In Microsoft Defender (security.microsoft.com) → Policies → Email authentication settings → DKIM → pick the domain and copy the two CNAMEs. 2) In GoDaddy → DNS, create those two CNAMEs (selector1._domainkey and selector2._domainkey). 3) Back in Defender, turn on “Sign messages with DKIM”."];
  out.push(okSel.length === 2
    ? c("dkim", "ok", ["DKIM (firma de los correos)", "DKIM (email signature)"], sel.map((x) => `${x.s} → ${x.v}`).join("  |  "), ["Los dos selectores de Microsoft 365 están publicados. Desde aquí no se puede ver si la firma está activada en Microsoft: para confirmarlo, envíate un correo a Gmail → “Mostrar original” → debe decir DKIM: PASS.", "Both Microsoft 365 selectors are published. From here it can't be seen whether signing is switched on in Microsoft: to confirm, email yourself at Gmail → “Show original” → it should say DKIM: PASS."])
    : okSel.length === 1
      ? c("dkim", "warn", ["DKIM (firma de los correos)", "DKIM (email signature)"], sel.map((x) => `${x.s} → ${x.v ?? "—"}`).join("  |  "), ["Solo uno de los dos selectores existe. Microsoft rota entre ambos: cuando use el que falta, la firma fallará.", "Only one of the two selectors exists. Microsoft rotates between them: when it uses the missing one, signing will fail."], dkimFix)
      : c("dkim", "fail", ["DKIM (firma de los correos)", "DKIM (email signature)"], null, ["No hay DKIM: los correos salen sin firma del dominio. Gmail y Yahoo lo exigen a quien envía con frecuencia y sin él suben las probabilidades de spam.", "No DKIM: emails go out without the domain's signature. Gmail and Yahoo require it from regular senders and without it spam chances rise."], dkimFix));

  // DMARC: what receivers should do when SPF/DKIM fail, and where to send reports.
  const dm = (await dns.txt(`_dmarc.${d}`)).filter((x) => /^v=DMARC1\b/i.test(x.trim()));
  const dmFix: [string, string] = [`En GoDaddy → DNS, registro TXT con nombre "_dmarc" y valor: v=DMARC1; p=none; rua=mailto:dmarc@${d}  (empezar con p=none solo observa; cuando SPF y DKIM estén bien por unas semanas, cambiar a p=quarantine).`, `In GoDaddy → DNS, TXT record named "_dmarc" with value: v=DMARC1; p=none; rua=mailto:dmarc@${d}  (starting with p=none only monitors; once SPF and DKIM are fine for a few weeks, change to p=quarantine).`];
  if (!dm.length) out.push(c("dmarc", "fail", ["DMARC (política del dominio)", "DMARC (domain policy)"], null, ["No hay DMARC. Desde 2024 Gmail y Yahoo lo piden; sin él, cualquiera puede suplantar el dominio con menos obstáculos.", "No DMARC. Since 2024 Gmail and Yahoo ask for it; without it, anyone can impersonate the domain more easily."], dmFix));
  else if (dm.length > 1) out.push(c("dmarc", "fail", ["DMARC (política del dominio)", "DMARC (domain policy)"], dm.join("  |  "), ["Hay dos registros DMARC: los receptores ignoran ambos.", "There are two DMARC records: receivers ignore both."], ["Deja uno solo en GoDaddy → DNS (_dmarc).", "Keep only one in GoDaddy → DNS (_dmarc)."]));
  else {
    const rec = dm[0].trim();
    const tag = (k: string) => rec.match(new RegExp(`(?:^|;)\\s*${k}\\s*=\\s*([^;]+)`, "i"))?.[1].trim().toLowerCase() ?? null;
    const p = tag("p"); const rua = tag("rua"); const pct = tag("pct");
    if (p === "quarantine" || p === "reject") out.push(c("dmarc", pct && pct !== "100" ? "info" : "ok", ["DMARC (política del dominio)", "DMARC (domain policy)"], rec, [`Correcto: política "${p}"${pct && pct !== "100" ? ` aplicada al ${pct}% de los correos` : ""}${rua ? ", con informes" : ", sin dirección de informes (rua)"}.`, `Correct: policy "${p}"${pct && pct !== "100" ? ` applied to ${pct}% of emails` : ""}${rua ? ", with reports" : ", without a report address (rua)"}.`]));
    else out.push(c("dmarc", "warn", ["DMARC (política del dominio)", "DMARC (domain policy)"], rec, ["DMARC existe pero solo observa (p=none): no protege contra suplantación. Está bien para empezar.", "DMARC exists but only monitors (p=none): it doesn't protect against impersonation. Fine as a start."], ["Cuando SPF y DKIM estén en verde unas semanas, cambia p=none por p=quarantine en el registro _dmarc.", "Once SPF and DKIM are green for a few weeks, change p=none to p=quarantine in the _dmarc record."]));
  }
  return out;
}

// ---------- links ----------
const SHORTENERS = /^(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|rb\.gy|tiny\.cc|s\.id)$/i;
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|igshid|yclid|oly_[a-z]+|vero_[a-z]+)$/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export type LinkIssue = { url: string; kind: "HTTP" | "SHORTENER" | "IP" | "TRACKING" | "MISMATCH" };

/** Removes tracking parameters from every link in a text (privacy + spam filters). Returns the cleaned text. */
export function stripTracking(text: string) {
  let removed = 0;
  const out = text.replace(URL_RE, (raw) => {
    const trail = raw.match(/[.,;:!?]+$/)?.[0] ?? ""; const u = trail ? raw.slice(0, -trail.length) : raw;
    try {
      const url = new URL(u);
      const keys = [...url.searchParams.keys()].filter((k) => TRACKING.test(k));
      if (!keys.length) return raw;
      keys.forEach((k) => url.searchParams.delete(k)); removed += keys.length;
      return url.toString().replace(/\?$/, "") + trail;
    } catch { return raw; }
  });
  return { text: out, removed };
}

export function linkIssues(content: string): LinkIssue[] {
  const issues: LinkIssue[] = [];
  for (const raw of content.match(URL_RE) ?? []) {
    const u = raw.replace(/[.,;:!?]+$/, "");
    let url: URL; try { url = new URL(u); } catch { continue; }
    if (url.protocol === "http:") issues.push({ url: u, kind: "HTTP" });
    if (SHORTENERS.test(url.hostname)) issues.push({ url: u, kind: "SHORTENER" });
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith("[")) issues.push({ url: u, kind: "IP" });
    if ([...url.searchParams.keys()].some((k) => TRACKING.test(k))) issues.push({ url: u, kind: "TRACKING" });
  }
  // HTML: the visible text shows one site but the link goes to another.
  for (const m of content.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const shown = m[2].replace(/<[^>]+>/g, "").trim().match(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/i)?.[1]?.toLowerCase().replace(/^www\./, "");
    let real: string | null = null; try { real = new URL(m[1]).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* mailto etc. */ }
    if (shown && real && shown !== real && !real.endsWith(`.${shown}`)) issues.push({ url: m[1], kind: "MISMATCH" });
  }
  return issues;
}

export const linkIssueText = (k: LinkIssue["kind"]) => ({
  HTTP: { es: "enlace sin https (inseguro)", en: "link without https (insecure)" },
  SHORTENER: { es: "acortador de enlaces (los filtros de spam desconfían)", en: "link shortener (spam filters distrust them)" },
  IP: { es: "enlace a una dirección IP (parece phishing)", en: "link to an IP address (looks like phishing)" },
  TRACKING: { es: "parámetros de rastreo (SOLU los quita al enviar)", en: "tracking parameters (SOLU removes them when sending)" },
  MISMATCH: { es: "el texto muestra un sitio y el enlace va a otro", en: "the text shows one site and the link goes to another" },
})[k];

// ---------- template review ----------
export function templateReview(sender: string, from: string) {
  const day = new Date(Date.now() + 3 * 864e5);
  const items = [{ qty: 2, code: "6SL3210-1KE21-7UF1", brand: "Siemens", description: "SINAMICS G120C 7.5 kW", unitPrice: 1234.5 }, { qty: 1, code: "3RT2026-1BB40", brand: "Siemens", description: "Contactor 24 V DC", unitPrice: 88 }];
  const samples: Record<TemplateKey, Mail> = {
    RFQ: rfqMail({ lang: "EN", code: "RFQ-2611-0001", items, neededBy: day, notes: null, sender, from }),
    FOLLOWUP: followUpMail({ lang: "EN", code: "RFQ-2611-0001", items, sentAt: new Date(), replyBy: day, sender, from }),
    NEGOTIATE: negotiateMail({ lang: "EN", theirRef: "Q-7781", items, currency: "USD", asks: { price: true, lead: true, payment: false }, target: null, replyBy: day, sender, from }),
    DELIVERY: deliveryMail({ lang: "EN", poCode: "SPO-2611-0001", proformaRef: "PF-1182", items, promised: day, issue: null, replyBy: day, sender, from }),
    OFFER: offerMail({ lang: "EN", quoteNumber: "000112228", contactName: "Ana", items, currency: "USD", total: 2557, leadText: "12–15 days after your P.O.", validUntil: day, incoterm: "FCA Miami", paymentTerms: "50% advance", condition: "New", sender, from }),
    PAYMENT: paymentMail({ lang: "EN", invoiceNumber: "000112221", contactName: null, amountDue: 2557, currency: "USD", dueAt: day, customerPo: "SN-77120", sender, from }),
  };
  return (Object.keys(samples) as TemplateKey[]).map((k) => {
    const m = samples[k];
    const notes: { level: Level; es: string; en: string }[] = [];
    const kb = Math.round(Buffer.byteLength(m.html) / 1024);
    if (kb > 90) notes.push({ level: "warn", es: `Pesa ${kb} KB: Gmail corta los correos de más de 102 KB.`, en: `${kb} KB: Gmail clips emails over 102 KB.` });
    const links = (m.html.match(/<a\b/gi) ?? []).length + (m.text.match(URL_RE) ?? []).length;
    const li = linkIssues(m.html + "\n" + m.text);
    if (li.length) notes.push({ level: "warn", es: `Enlaces con problemas: ${li.map((x) => linkIssueText(x.kind).es).join("; ")}.`, en: `Link problems: ${li.map((x) => linkIssueText(x.kind).en).join("; ")}.` });
    if (/<img\b/i.test(m.html)) notes.push({ level: "info", es: "Lleva imágenes: muchos clientes de correo las bloquean al inicio.", en: "Has images: many email apps block them at first." });
    if (!m.text.trim()) notes.push({ level: "fail", es: "No tiene versión de texto simple.", en: "No plain-text version." });
    const longest = Math.max(...m.subjects.map((s) => s.length));
    if (longest > 78) notes.push({ level: "info", es: `Un asunto tiene ${longest} caracteres: en el celular se corta cerca de 40–60.`, en: `A subject has ${longest} characters: phones cut around 40–60.` });
    if (m.subjects.some((s) => /\bURGENTE?\b/.test(s))) notes.push({ level: "info", es: "Un asunto usa URGENT/URGENTE en mayúsculas. Es parte de la plantilla de la empresa; con SPF, DKIM y DMARC en verde no suele afectar.", en: "A subject uses URGENT in capitals. It's part of the company template; with SPF, DKIM and DMARC green it usually doesn't matter." });
    if (m.subjects.some((s) => /!{1,}|\$\$|free|gratis/i.test(s))) notes.push({ level: "warn", es: "El asunto tiene signos de exclamación o palabras típicas de spam.", en: "The subject has exclamation marks or typical spam words." });
    return { key: k, name: TEMPLATES[k], kb, links, plain: !!m.text.trim(), notes, level: (notes.some((n) => n.level === "fail") ? "fail" : notes.some((n) => n.level === "warn") ? "warn" : "ok") as Level };
  });
}

// ---------- cached report ----------
let cache: { at: number; domain: string; checks: Check[] | null; error: string | null } | null = null;
export function sendingDomain() { const f = mailConfig().from; return f?.split("@")[1]?.toLowerCase() ?? null; }

export async function domainReport(opts: { force?: boolean; domain?: string } = {}) {
  const domain = (opts.domain ?? sendingDomain())?.toLowerCase().trim() ?? null;
  if (!domain) return { domain: null, checks: null, error: "NO_DOMAIN", at: null as Date | null };
  if (!opts.force && cache && cache.domain === domain && Date.now() - cache.at < 3600e3) return { domain, checks: cache.checks, error: cache.error, at: new Date(cache.at) };
  try {
    const checks = await Promise.race([checkDomain(domain), new Promise<never>((_, rej) => setTimeout(() => rej(new DnsDown("TIMEOUT")), 15000))]);
    cache = { at: Date.now(), domain, checks, error: null };
  } catch (e) {
    cache = { at: Date.now(), domain, checks: null, error: e instanceof DnsDown ? `DNS ${e.message}` : (e as Error).message };
  }
  return { domain, checks: cache.checks, error: cache.error, at: new Date(cache.at) };
}
