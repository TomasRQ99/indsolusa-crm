import type { ProposalData } from "./solution";
import { AUDIENCE, INTERNAL_MARKERS, ROUTE_KIND } from "./proposal-rules";

// Comercial C5 §18 · Solution Proposal as a printable page (browser "Print → Save as PDF").
// Self-contained so the customer can take it to a committee without the negotiator. Built only from ProposalData,
// which never carries costs, suppliers or Eságara (AC11).

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderProposal(p: ProposalData, lang: "ES" | "EN") {
  const en = lang === "EN";
  const t = (es: string, e: string) => (en ? e : es);
  const n2 = (v: number) => new Intl.NumberFormat(en ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat(en ? "en-US" : "es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d) : "");
  const no = `${p.number}${p.rev ? ` Rev. ${p.rev}` : ""}`;
  const sec = (title: string, body: string) => (body.trim() ? `<section><h2>${esc(title)}</h2>${body}</section>` : "");
  const list = (items: { component: string; code: string | null; qty: number }[]) => (items.length ? `<ul>${items.map((x) => `<li>${x.qty > 1 ? `${x.qty} × ` : ""}${esc(x.component)}${x.code ? ` <span class="mono">${esc(x.code)}</span>` : ""}</li>`).join("")}</ul>` : "");

  const scopeBody = [
    p.scope.included.length ? `<h3>${t("Incluido", "Included")}</h3>${list(p.scope.included)}` : "",
    p.scope.customer.length ? `<h3>${t("Lo aportan ustedes", "Supplied by you")}</h3>${list(p.scope.customer)}` : "",
    p.scope.optional.length ? `<h3>${t("Opcional", "Optional")}</h3>${list(p.scope.optional)}` : "",
    p.scope.excluded.length ? `<h3>${t("No incluido", "Not included")}</h3>${list(p.scope.excluded)}` : "",
    p.scope.toConfirm.length ? `<h3>${t("Por confirmar juntos", "To confirm together")}</h3>${list(p.scope.toConfirm)}` : "",
  ].join("");

  const altBody = p.alternatives.length >= 2
    ? `<table><thead><tr><th>${t("Alternativa", "Alternative")}</th><th class="n">${t("Inversión USD", "Investment USD")}</th><th>${t("Días después de la OC", "Days after PO")}</th><th>${t("Compromiso", "Commitment")}</th></tr></thead><tbody>${p.alternatives.map((a) => `<tr${a.recommended ? ' class="rec"' : ""}><td><b>${esc(a.label)}</b>${a.recommended ? ` <span class="tag">${t("Recomendada", "Recommended")}</span>` : ""}${a.recommended && a.why ? `<div class="sub">${esc(a.why)}</div>` : ""}</td><td class="n">${n2(a.price)}</td><td>${esc(a.lead)}</td><td>${esc(a.promise ?? "")}</td></tr>`).join("")}</tbody></table>`
    : p.routes.length >= 2 ? `<ul>${p.routes.map((r) => `<li><b>${esc(en ? ROUTE_KIND[r.kind]?.en : ROUTE_KIND[r.kind]?.es)}</b>: ${esc(r.label)}${r.note ? ` — ${esc(r.note)}` : ""}</li>`).join("")}</ul>` : "";

  const valueBody = p.claims.length
    ? p.claims.map((c) => `<div class="claim"><b>${esc(en ? c.attrEn : c.attrEs)}</b>${c.audience !== "ALL" ? ` <span class="tag">${esc(en ? AUDIENCE[c.audience]?.en : AUDIENCE[c.audience]?.es)}</span>` : ""}<p>${esc(c.advantage)} → ${esc(c.benefit)}</p><p class="sub">${t("Evidencia", "Evidence")}: ${esc(c.evidence)}${c.evidenceAt ? ` (${day(c.evidenceAt)})` : ""}</p></div>`).join("")
    : "";

  const linesBody = `<table><thead><tr><th>${t("Cant.", "Qty")}</th><th>${t("Código", "Code")}</th><th>${t("Descripción", "Description")}</th><th class="n">${t("Precio unit. USD", "Unit price USD")}</th><th class="n">Total USD</th></tr></thead><tbody>${p.lines.map((l) => `<tr><td>${l.qty}</td><td class="mono">${esc(l.code ?? "")}</td><td>${esc(l.description)}</td><td class="n">${n2(l.unitPrice)}</td><td class="n">${n2(l.qty * l.unitPrice)}</td></tr>`).join("")}<tr class="tot"><td colspan="4">${t("Total", "Total")}</td><td class="n">${n2(p.total)}</td></tr></tbody></table>
  <dl>${p.incoterm ? `<dt>Incoterm</dt><dd>${esc(p.incoterm)}</dd>` : ""}${p.paymentTerms ? `<dt>${t("Pago", "Payment")}</dt><dd>${esc(p.paymentTerms)}</dd>` : ""}<dt>${t("Condición", "Condition")}</dt><dd>${esc(p.condition)}</dd><dt>${t("Vigencia de la oferta", "Offer valid until")}</dt><dd>${day(p.validUntil)}</dd></dl>`;

  const timeBody = p.leadText || p.promise ? `<p>${p.leadText ? `<b>${esc(p.leadText)}</b> ${t("después de recibir la orden de compra.", "after receiving the purchase order.")}` : ""}</p>${p.promise ? `<p>${esc(p.promise)}</p>` : ""}${p.promiseCondition ? `<p class="sub">${t("Supuesto", "Assumption")}: ${esc(p.promiseCondition)}</p>` : ""}` : "";

  const body = [
    sec(t("Lo que entendimos", "What we understood"), `${p.understood ? `<p>${esc(p.understood)}</p>` : ""}${p.impactIfNot ? `<p class="sub">${t("Si no se resuelve", "If it isn't solved")}: ${esc(p.impactIfNot)}</p>` : ""}`),
    sec(t("Resultado que buscan", "The result you're after"), `${p.desiredResult ? `<p><b>${esc(p.desiredResult)}</b></p>` : ""}${p.successMeasure ? `<p class="sub">${t("Cómo lo sabremos", "How we'll know")}: ${esc(p.successMeasure)}</p>` : ""}${p.neededBy ? `<p class="sub">${t("Se necesita el", "Needed by")} ${day(p.neededBy)}</p>` : ""}`),
    sec(t("La solución", "The solution"), p.solution ? `<p>${esc(p.solution)}</p>` : ""),
    sec(t("Alcance", "Scope"), scopeBody),
    sec(t("Alternativas y diferencias", "Alternatives and trade-offs"), altBody),
    sec(t("Por qué esta solución le sirve", "Why this solution helps you"), valueBody),
    sec(t("Plazo", "Timing"), timeBody),
    sec(t("Inversión y condiciones", "Investment and terms"), linesBody),
    sec(t("Decisión que proponemos", "The decision we propose"), p.decisionNeeded ? `<p><b>${esc(p.decisionNeeded)}</b></p>` : ""),
  ].join("");

  const html = `<!doctype html><html lang="${en ? "en" : "es"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t("Propuesta de solución", "Solution proposal"))} ${esc(no)}</title>
<style>
:root{--ink:#14233a;--muted:#5b6b80;--line:#d9e0e8;--accent:#1f4e8c;--bg:#fff}
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:var(--ink);font:14px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
.page{max-width:820px;margin:24px auto;background:var(--bg);padding:40px 48px;box-shadow:0 1px 3px #0002}
header{border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:8px}
.brand{font-weight:700;letter-spacing:.06em;color:var(--accent)}.brand small{display:block;font-weight:400;letter-spacing:0;color:var(--muted);font-size:12px}
h1{font-size:22px;margin:14px 0 4px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:26px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
h3{font-size:13px;margin:12px 0 4px}.sub{color:var(--muted);font-size:13px;margin:4px 0}.meta{color:var(--muted);font-size:13px}
p{margin:6px 0}ul{margin:4px 0 8px 18px;padding:0}.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.n{text-align:right;font-variant-numeric:tabular-nums}tr.tot td{font-weight:700;border-top:2px solid var(--ink)}tr.rec td{background:#f1f6fc}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:9px;background:#e6eef8;color:var(--accent);vertical-align:middle}
.claim{border-left:3px solid var(--accent);padding:4px 10px;margin:8px 0}.claim p{margin:2px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:8px 0}dt{color:var(--muted)}dd{margin:0}
.draft{border:1px dashed #b45309;color:#b45309;padding:6px 10px;margin:10px 0;font-size:13px}
footer{margin-top:30px;border-top:1px solid var(--line);padding-top:10px;color:var(--muted);font-size:12px}
.bar{max-width:820px;margin:16px auto 0;display:flex;gap:8px;justify-content:flex-end}.bar button{font:inherit;padding:6px 12px;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer}
@media (max-width:640px){.page{margin:0;padding:20px 16px;box-shadow:none}.bar{padding:0 16px}table{font-size:12px}th,td{padding:5px 4px}}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;padding:0}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">${esc(t("Imprimir / guardar PDF", "Print / save PDF"))}</button></div>
<main class="page">
<header><div class="brand">INDUSTRY SOLUTIONS USA<small>${esc(t("Propuesta de solución", "Solution proposal"))} · ${esc(no)}</small></div>
<h1>${esc(p.title)}</h1><div class="meta">${esc(t("Para", "For"))}: ${esc(p.customer)}${p.contact ? ` · ${esc(p.contact)}` : ""} · ${day(p.date)}</div>
${p.draft ? `<div class="draft">${esc(t("Borrador interno: vista previa antes de aprobar y enviar.", "Internal draft: preview before approving and sending."))}</div>` : ""}</header>
${body}
<footer>${esc(t("Preparada por", "Prepared by"))} ${esc(p.owner)}${p.ownerEmail ? ` · ${esc(p.ownerEmail)}` : ""}. ${esc(t("La cotización formal", "The formal quote"))} ${esc(no)} ${esc(t("contiene los términos comerciales.", "holds the commercial terms."))}</footer>
</main></body></html>`;
  return html;
}

/** Last guard: a proposal is not served if internal wording or one of our suppliers' names slipped in through free text. */
export function proposalLeak(html: string, privateNames: string[] = []) {
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  const m = text.match(INTERNAL_MARKERS);
  if (m) return m[0];
  const low = text.toLowerCase();
  return privateNames.find((n) => low.includes(n.toLowerCase())) ?? null;
}
