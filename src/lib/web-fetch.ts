// Polite web reader (L5). Rules, in order:
// 1. Only http/https on standard ports, and never internal addresses (no reaching our own network).
// 2. Sites whose terms forbid automated reading are never fetched (BLOCKED_HOSTS); distributors
//    with an official API are used through the API instead.
// 3. robots.txt is obeyed for every URL, including every redirect hop. If robots.txt can't be
//    read because the site is failing, we assume "no" (RFC 9309).
// 4. At most one request every few seconds per site, small size limits, short timeouts.
// 5. Everything is cached, so the same page is not read twice in a day.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { db } from "./db";

export const BOT_NAME = "SOLU-Parts";
const USER_AGENT = `${BOT_NAME}/1.0 (+https://indsolusa.com)`;

/** Hosts we never read as pages: their terms forbid it, or they have an official API we use instead. */
const BLOCKED_HOSTS: Record<string, string> = {
  "mouser.com": "API", "digikey.com": "API",
  "amazon.com": "TOS", "ebay.com": "TOS", "alibaba.com": "TOS", "aliexpress.com": "TOS",
  "google.com": "TOS", "linkedin.com": "TOS", "facebook.com": "TOS", "mercadolibre.com": "TOS",
};
export function blockedHost(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const [d, why] of Object.entries(BLOCKED_HOSTS)) {
    const base = d.split(".")[0];
    if (h === d || h.endsWith("." + d) || new RegExp(`(^|\\.)${base}\\.(com?\\.)?[a-z]{2,3}$`).test(h)) return why;
  }
  return null;
}

export type FetchFail = "SCHEME" | "PRIVATE" | "BLOCKED" | "ROBOTS" | "TIMEOUT" | "NETWORK" | "SIZE" | "TYPE" | "REDIRECTS" | "HTTP";
export type FetchResult =
  | { ok: true; url: string; status: number; contentType: string | null; body: string; fromCache: boolean; fetchedAt: Date }
  | { ok: false; url: string; fail: FetchFail; status?: number; detail?: string };

// ---------- address safety ----------
/** Test-only: lets automated tests reach a fake site on 127.0.0.1. Never active in production. */
const testLocal = () => process.env.WEBFETCH_TEST_LOCAL === "1" && process.env.NODE_ENV !== "production";
function privateIp(ip: string): boolean {
  if (testLocal() && (ip === "127.0.0.1" || ip === "::ffff:127.0.0.1")) return false;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** DNS lookup used by the socket itself, so the address we check is the address we connect to. */
function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void) {
  const slow = new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" })), 8000));
  Promise.race([lookup(hostname, { all: true }), slow]).then((addrs) => {
    const good = addrs.filter((a) => !privateIp(a.address));
    if (!good.length || good.length !== addrs.length) { const e = new Error("PRIVATE") as NodeJS.ErrnoException; e.code = "PRIVATE"; return cb(e, ""); }
    if ((options as { all?: boolean }).all) return cb(null, good);
    cb(null, good[0].address, good[0].family);
  }, (e) => cb(e, ""));
}

export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; fail: FetchFail } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, fail: "SCHEME" }; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false, fail: "SCHEME" };
  if (u.port && !["80", "443"].includes(u.port) && !(testLocal() && u.hostname === "127.0.0.1")) return { ok: false, fail: "PRIVATE" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (testLocal() && host === "127.0.0.1") { u.hash = ""; return { ok: true, url: u }; }
  if (isIP(host) ? privateIp(host) : !host.includes(".") || /\.(local|internal|lan|localhost)$/i.test(host)) return { ok: false, fail: "PRIVATE" };
  if (blockedHost(host)) return { ok: false, fail: "BLOCKED" };
  u.hash = "";
  return { ok: true, url: u };
}

// ---------- one raw request (no redirects followed) ----------
type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function rawGet(u: URL, maxBytes: number, timeoutMs: number): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, {
      method: "GET",
      lookup: safeLookup as never,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en,es;q=0.8" },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(new Error("SIZE")); return; } chunks.push(c); });
      res.on("end", () => {
        let body = Buffer.concat(chunks);
        try {
          const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
          if (enc.includes("gzip")) body = zlib.gunzipSync(body, { maxOutputLength: maxBytes * 4 });
          else if (enc.includes("br")) body = zlib.brotliDecompressSync(body, { maxOutputLength: maxBytes * 4 });
          else if (enc.includes("deflate")) body = zlib.inflateSync(body, { maxOutputLength: maxBytes * 4 });
        } catch { return reject(new Error("SIZE")); }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    // Hard limit for the whole request, including the name lookup (the socket timeout doesn't cover it).
    const hard = setTimeout(() => req.destroy(new Error("TIMEOUT")), timeoutMs + 3000);
    req.on("close", () => clearTimeout(hard));
    req.on("error", (e) => { clearTimeout(hard); reject(e); });
    req.end();
  });
}

// ---------- per-site pacing ----------
const lastHit = new Map<string, number>();
async function pace(host: string, delaySec: number) {
  const gap = Math.max(2, Math.min(delaySec, 20)) * 1000;
  const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
  lastHit.set(host, Math.max(Date.now(), (lastHit.get(host) ?? 0) + gap));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// ---------- cache ----------
const DAY = 86_400_000;
async function cached(url: string, ttlMs: number) {
  const c = await db.webCache.findUnique({ where: { url } });
  return c && Date.now() - c.fetchedAt.getTime() < ttlMs ? c : null;
}
async function store(url: string, status: number, contentType: string | null, body: string | null) {
  const data = { status, contentType, body, fetchedAt: new Date() };
  await db.webCache.upsert({ where: { url }, create: { url, ...data }, update: data });
}

// ---------- robots.txt ----------
type Rule = { allow: boolean; path: string };
export type Robots = { rules: Rule[]; delay: number; sitemaps: string[]; denyAll?: boolean; privateHost?: boolean; unreachable?: boolean };

/** Parse robots.txt for our bot (falls back to the "*" group). */
export function parseRobots(txt: string): Robots {
  const groups: { agents: string[]; rules: Rule[]; delay: number }[] = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null; let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === "sitemap") { if (val) sitemaps.push(val); continue; }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], delay: 0 }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") { if (val || key === "allow") cur.rules.push({ allow: key === "allow", path: val }); }
    else if (key === "crawl-delay") cur.delay = Number(val) || 0;
  }
  const me = BOT_NAME.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.startsWith(a)));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return { rules: pick.flatMap((g) => g.rules), delay: Math.max(0, ...pick.map((g) => g.delay)), sitemaps };
}

function ruleMatches(path: string, rule: string) {
  if (!rule) return false;
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}
/** Longest matching rule wins; Allow wins ties. */
export function robotsAllows(r: Robots, pathAndQuery: string) {
  if (r.denyAll) return false;
  let best: Rule | null = null;
  for (const rule of r.rules) {
    if (!ruleMatches(pathAndQuery, rule.path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}

const robotsMem = new Map<string, { at: number; r: Robots }>();
export async function robotsFor(origin: string): Promise<Robots> {
  const mem = robotsMem.get(origin);
  if (mem && Date.now() - mem.at < DAY) return mem.r;
  const url = origin + "/robots.txt";
  let r: Robots;
  const c0 = await cached(url, DAY);
  const c = c0 && c0.status !== 0 ? c0 : null; // an old "couldn't connect" is retried
  if (c) r = c.status >= 500 ? { rules: [], delay: 0, sitemaps: [], denyAll: true } : c.status >= 400 ? { rules: [], delay: 0, sitemaps: [] } : parseRobots(c.body ?? "");
  else {
    let status = 0; let body = "";
    try {
      let u = new URL(url);
      for (let hop = 0; hop < 5; hop++) {
        await pace(u.host, 2);
        const res = await rawGet(u, 512 * 1024, 10_000);
        status = res.status;
        if (status >= 300 && status < 400 && res.headers.location) { const next = checkUrl(new URL(res.headers.location, u).toString()); if (!next.ok) { status = 404; break; } u = next.url; continue; }
        body = res.body.toString("utf8");
        break;
      }
    } catch (e) {
      // The name points at an internal address: refuse, and say so (not cached).
      if ((e as NodeJS.ErrnoException).code === "PRIVATE") return { rules: [], delay: 0, sitemaps: [], denyAll: true, privateHost: true };
      status = 0;
    }
    if (status === 0) {
      // Could not connect at all: say so, and try again in 30 minutes (not cached for a day).
      const r0 = { rules: [], delay: 0, sitemaps: [], denyAll: true, unreachable: true };
      robotsMem.set(origin, { at: Date.now() - DAY + 30 * 60_000, r: r0 });
      return r0;
    }
    await store(url, status, "text/plain", body.slice(0, 200_000));
    r = status === 0 || status >= 500 ? { rules: [], delay: 0, sitemaps: [], denyAll: true } : status >= 400 ? { rules: [], delay: 0, sitemaps: [] } : parseRobots(body);
  }
  robotsMem.set(origin, { at: Date.now(), r });
  return r;
}

// ---------- the public entry point ----------
export async function politeFetch(raw: string, opts: { ttlMs?: number; maxBytes?: number; accept?: RegExp } = {}): Promise<FetchResult> {
  const ttl = opts.ttlMs ?? DAY;
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const first = checkUrl(raw);
  if (!first.ok) return { ok: false, url: raw, fail: first.fail };
  let u = first.url;
  const hit = await cached(u.toString(), ttl);
  if (hit && hit.status >= 200 && hit.status < 300) return { ok: true, url: u.toString(), status: hit.status, contentType: hit.contentType, body: hit.body ?? "", fromCache: true, fetchedAt: hit.fetchedAt };
  for (let hop = 0; hop < 5; hop++) {
    const robots = await robotsFor(u.origin);
    if (robots.privateHost) return { ok: false, url: u.toString(), fail: "PRIVATE" };
    if (robots.unreachable) return { ok: false, url: u.toString(), fail: "NETWORK" };
    if (!robotsAllows(robots, u.pathname + u.search)) return { ok: false, url: u.toString(), fail: "ROBOTS" };
    await pace(u.host, robots.delay);
    let res: Raw;
    try { res = await rawGet(u, maxBytes, 15_000); }
    catch (e) {
      const m = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
      return { ok: false, url: u.toString(), fail: m === "PRIVATE" ? "PRIVATE" : m === "SIZE" ? "SIZE" : m === "TIMEOUT" ? "TIMEOUT" : "NETWORK", detail: String(m).slice(0, 80) };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const next = checkUrl(new URL(res.headers.location, u).toString());
      if (!next.ok) return { ok: false, url: u.toString(), fail: next.fail };
      u = next.url;
      continue;
    }
    const ct = String(res.headers["content-type"] ?? "") || null;
    if (res.status < 200 || res.status >= 300) { await store(u.toString(), res.status, ct, null); return { ok: false, url: u.toString(), fail: "HTTP", status: res.status }; }
    if (opts.accept && ct && !opts.accept.test(ct)) return { ok: false, url: u.toString(), fail: "TYPE", detail: ct };
    let buf = res.body;
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = zlib.gunzipSync(buf, { maxOutputLength: maxBytes * 4 }); } catch { return { ok: false, url: u.toString(), fail: "SIZE" }; } }
    const charset = /charset=([\w-]+)/i.exec(ct ?? "")?.[1]?.toLowerCase();
    const body = new TextDecoder(charset && /^(utf-8|iso-8859-1|windows-1252|latin1)$/.test(charset) ? charset : "utf-8").decode(buf);
    const at = new Date();
    await store(u.toString(), res.status, ct, body.slice(0, 2_000_000));
    if (u.toString() !== first.url.toString()) await store(first.url.toString(), res.status, ct, body.slice(0, 2_000_000));
    return { ok: true, url: u.toString(), status: res.status, contentType: ct, body, fromCache: false, fetchedAt: at };
  }
  return { ok: false, url: u.toString(), fail: "REDIRECTS" };
}
