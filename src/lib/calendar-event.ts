// C1: one standard shape for every calendar block SOLU creates (Mi Día agenda, .ics file, Outlook).
// Title:       [Tipo] – [Cliente/Proveedor] – [Parte/Orden]
// Description: Propósito · Partes · Cotización/Orden · Journey · Próximo paso · Responsable,
//              with links back to SOLU and flags for overdue follow-ups and quotes past their decision date.
import type { Prisma } from "@prisma/client";
import { today } from "./domain";

export const calendarTaskInclude = {
  assignee: { select: { name: true } },
  account: { select: { id: true, name: true } },
  deal: {
    select: {
      id: true, code: true, title: true, nextMove: true, nextMoveDate: true, offerValidUntil: true,
      account: { select: { id: true, name: true } },
      items: { select: { code: true, qty: true, description: true }, take: 6 },
      quotes: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, number: true, rev: true, status: true, promiseDecideBy: true, decidedAt: true } },
      supplierPos: { orderBy: { createdAt: "desc" }, take: 3, select: { id: true, code: true, supplier: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.TaskInclude;
export type CalendarTask = Prisma.TaskGetPayload<{ include: typeof calendarTaskInclude }>;

type T = (es: string, en: string) => string;
type Line = { label: string; value: string; href?: string };
export type CalendarEvent = { title: string; kind: string; lines: Line[]; flags: string[]; link: string };

const KINDS: { re: RegExp; es: string; en: string; supplier?: boolean }[] = [
  { re: /\bRFQ\b|pedir precio|ask .*price|revisar respuestas|cotizaci[oó]n a proveedor/i, es: "Cotización proveedor", en: "Supplier quote", supplier: true },
  { re: /pago a proveedor|supplier payment|\bSPO-/i, es: "Orden a proveedor", en: "Supplier order", supplier: true },
  { re: /seguimiento|follow/i, es: "Seguimiento", en: "Follow-up" },
  { re: /llamad|llamar|\bcall\b/i, es: "Llamada", en: "Call" },
  { re: /reuni[oó]n|meeting|visita|visit/i, es: "Reunión", en: "Meeting" },
  { re: /cotizaci[oó]n|\bquote\b|propuesta|proposal/i, es: "Cotización", en: "Quote" },
  { re: /cobr|factur|invoice|collect/i, es: "Facturación", en: "Billing" },
  { re: /despach|entreg|env[ií]o|recogida|ship|deliver|pick ?up/i, es: "Entrega", en: "Delivery" },
  { re: /continuidad|continuity|reorden|reorder/i, es: "Continuidad", en: "Continuity" },
];
const REF = /\b(RFQ-[\w-]+|SPO-[\w-]+|SJ-\d+|J-\d{4}-\d+)\b/;
const day = (d: Date, t: T) => new Intl.DateTimeFormat(t("es-CO", "en-US"), { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

export function calendarEvent(tk: CalendarTask, t: T, base: string): CalendarEvent {
  const now = today();
  const k = KINDS.find((x) => x.re.test(tk.title));
  const kind = k ? t(k.es, k.en) : t("Tarea", "Task");
  const d = tk.deal;
  const customer = d?.account ?? tk.account;
  const refInTitle = REF.exec(tk.title)?.[1];
  const po = d?.supplierPos.find((p) => refInTitle && p.code === refInTitle) ?? d?.supplierPos[0];
  const party = k?.supplier ? (po?.supplier.name ?? (/\bRFQ-/.test(tk.title) ? t("varios proveedores", "several suppliers") : customer?.name)) : customer?.name;
  const firstPart = d?.items.find((x) => x.code)?.code;
  const q = d?.quotes[0];
  const ref = refInTitle ?? firstPart ?? (q ? `${q.number}${q.rev ? ` R${q.rev}` : ""}` : null) ?? d?.code ?? null;
  const parts = [kind, party, ref].filter(Boolean) as string[];
  const title = (parts.length >= 2 ? parts.join(" – ") : `${kind} – ${tk.title}`).slice(0, 120);

  const lines: Line[] = [{ label: t("Propósito", "Purpose"), value: tk.title }];
  const codes = (d?.items ?? []).filter((x) => x.code);
  if (codes.length) lines.push({ label: t("Partes", "Parts"), value: codes.slice(0, 5).map((x) => `${x.qty} × ${x.code}`).join(", ") + (codes.length > 5 ? ` +${codes.length - 5}` : ""), href: `${base}/localizar?q=${encodeURIComponent(codes[0].code!)}` });
  const QS: Record<string, string> = { DRAFT: t("borrador", "draft"), PRESENTED: t("presentada al cliente", "presented to customer"), ACCEPTED: t("aceptada", "accepted"), DECLINED: t("rechazada", "declined"), SUPERSEDED: t("reemplazada", "superseded") };
  if (q) lines.push({ label: t("Cotización", "Quote"), value: `${q.number}${q.rev ? ` R${q.rev}` : ""} · ${QS[q.status] ?? q.status}`, href: `${base}/cotizaciones/${q.id}` });
  if (po) lines.push({ label: t("Orden a proveedor", "Supplier order"), value: `${po.code} · ${po.supplier.name}`, href: `${base}/compras/${po.id}` });
  if (refInTitle?.startsWith("RFQ-")) lines.push({ label: t("Solicitud a proveedores", "Supplier request"), value: refInTitle });
  if (customer) lines.push({ label: t("Cliente", "Customer"), value: customer.name, href: `${base}/accounts/${customer.id}` });
  if (d) lines.push({ label: "Necesidad", value: `${d.code ?? ""} · ${d.title}`.trim(), href: `${base}/deals/${d.id}` });
  if (d?.nextMove) lines.push({ label: t("Próximo paso", "Next step"), value: `${d.nextMove}${d.nextMoveDate ? ` (${day(d.nextMoveDate, t)})` : ""}` });
  lines.push({ label: t("Responsable", "Owner"), value: tk.assignee.name });

  const flags: string[] = [];
  if (tk.dueDate && tk.dueDate < now) flags.push(t(`Vencida desde el ${day(tk.dueDate, t)}`, `Overdue since ${day(tk.dueDate, t)}`));
  if (q?.status === "PRESENTED" && !q.decidedAt && q.promiseDecideBy && q.promiseDecideBy < now) flags.push(t(`Cotización sin decisión: el cliente iba a decidir el ${day(q.promiseDecideBy, t)}`, `Quote without decision: the customer was to decide by ${day(q.promiseDecideBy, t)}`));
  if (q?.status === "PRESENTED" && d?.offerValidUntil && d.offerValidUntil < now) flags.push(t(`Oferta vencida el ${day(d.offerValidUntil, t)}: confirmar precio antes de insistir`, `Offer expired on ${day(d.offerValidUntil, t)}: re-confirm price before following up`));

  return { title, kind, lines, flags, link: d ? `${base}/deals/${d.id}` : `${base}/mi-dia` };
}

/** Plain text for the .ics DESCRIPTION. */
export function eventText(ev: CalendarEvent, t: T) {
  return [
    ...ev.flags.map((f) => `⚠ ${f}`),
    ...ev.lines.map((l) => `${l.label}: ${l.value}${l.href ? ` — ${l.href}` : ""}`),
    `${t("Abrir en SOLU", "Open in SOLU")}: ${ev.link}`,
  ].join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** HTML for the Outlook event body. */
export function eventHtml(ev: CalendarEvent, t: T) {
  const flags = ev.flags.map((f) => `<p style="color:#b45309"><b>⚠ ${esc(f)}</b></p>`).join("");
  const rows = ev.lines.map((l) => `<tr><td style="padding:2px 12px 2px 0;color:#555;vertical-align:top"><b>${esc(l.label)}</b></td><td style="padding:2px 0">${l.href ? `<a href="${esc(l.href)}">${esc(l.value)}</a>` : esc(l.value)}</td></tr>`).join("");
  return `${flags}<table style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;border-collapse:collapse">${rows}</table><p><a href="${esc(ev.link)}">${esc(t("Abrir en SOLU", "Open in SOLU"))}</a></p>`;
}
