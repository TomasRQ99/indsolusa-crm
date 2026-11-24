import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { addDays, today } from "./domain";

// COMPARAR EQUIPO (owner, 2026-11-24: "visible to everyone"): every person who carries customers or Needs, side by
// side, in one period: customers in their care, how many of them were active, contacts made, new Needs, quotes
// presented, customer POs accepted and invoiced sales. Counted from the records; nothing is stored and nothing is
// scored. Default order is by name; any column can order the table.

export const TEAM_PERIODS = ["30", "90", "365"] as const;
export const TEAM_COLS = ["accounts", "activeAccounts", "contacts", "needs", "quotes", "pos", "sales"] as const;
export type TeamCol = (typeof TEAM_COLS)[number];
export type TeamRow = { id: string; name: string; me: boolean } & Record<TeamCol, number>;
export type TeamCompare = Awaited<ReturnType<typeof buildTeamCompare>>;

const ts = (d: Date) => new Date(d.getTime() + 5 * 3600e3); // Bogotá midnight as a timestamp

export async function buildTeamCompare(user: SessionUser, i: I18n, o: { period?: string; order?: string }) {
  const { t } = i;
  const period = (TEAM_PERIODS as readonly string[]).includes(o.period ?? "") ? o.period! : "90";
  const order = (TEAM_COLS as readonly string[]).includes(o.order ?? "") ? (o.order as TeamCol) : "name";
  const end = today();
  const start = addDays(end, -(Number(period) - 1));
  const from = ts(start), to = ts(addDays(end, 1));
  const inP = { gte: from, lt: to };

  const [users, accounts, deals, activities, invoices] = await Promise.all([
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, select: { id: true, name: true } }),
    db.account.findMany({ where: { internal: false }, select: { id: true, ownerId: true } }),
    db.deal.findMany({
      where: { internal: false, OR: [{ createdAt: inP }, { quoteSentAt: inP }, { poAcceptedAt: inP }] },
      select: { ownerId: true, accountId: true, createdAt: true, quoteSentAt: true, poAcceptedAt: true },
    }),
    db.activity.findMany({ where: { occurredAt: inP }, select: { userId: true, accountId: true, type: true } }),
    db.invoice.findMany({ where: { issuedAt: inP, deal: { internal: false } }, select: { amount: true, accountId: true, deal: { select: { ownerId: true } } } }),
  ]);

  // An account is active in the period when someone spoke with it, a Need was opened for it or it was invoiced.
  const activeAcc = new Set<string>();
  for (const a of activities) if (a.accountId && a.type !== "NOTE") activeAcc.add(a.accountId);
  for (const d of deals) if (d.createdAt >= from && d.createdAt < to) activeAcc.add(d.accountId);
  for (const v of invoices) activeAcc.add(v.accountId);

  const rows = new Map<string, TeamRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const u = users.find((x) => x.id === id);
      if (!u) return null;
      r = { id, name: u.name.replace(/ \(ejemplo\)$/, ""), me: id === user.id, accounts: 0, activeAccounts: 0, contacts: 0, needs: 0, quotes: 0, pos: 0, sales: 0 };
      rows.set(id, r);
    }
    return r;
  };
  row(user.id);
  for (const a of accounts) { const r = row(a.ownerId); if (r) { r.accounts++; if (activeAcc.has(a.id)) r.activeAccounts++; } }
  for (const a of activities) { if (a.type === "NOTE" || !a.accountId) continue; const r = row(a.userId); if (r) r.contacts++; }
  for (const d of deals) {
    const r = row(d.ownerId); if (!r) continue;
    if (d.createdAt >= from && d.createdAt < to) r.needs++;
    if (d.quoteSentAt && d.quoteSentAt >= from && d.quoteSentAt < to) r.quotes++;
    if (d.poAcceptedAt && d.poAcceptedAt >= from && d.poAcceptedAt < to) r.pos++;
  }
  for (const v of invoices) { const r = row(v.deal.ownerId); if (r) r.sales += Number(v.amount); }

  // People with nothing at all in their care or in the period stay out, except the person looking.
  const list = [...rows.values()].filter((r) => r.me || TEAM_COLS.some((c) => r[c] > 0));
  const byName = (a: TeamRow, b: TeamRow) => a.name.localeCompare(b.name, "es");
  list.sort(order === "name" ? byName : (a, b) => b[order] - a[order] || byName(a, b));
  const total = Object.fromEntries(TEAM_COLS.map((c) => [c, list.reduce((s, r) => s + r[c], 0)])) as Record<TeamCol, number>;
  const max = Object.fromEntries(TEAM_COLS.map((c) => [c, Math.max(1, ...list.map((r) => r[c]))])) as Record<TeamCol, number>;

  const cols: { key: TeamCol; label: string; help: string; money?: boolean }[] = [
    { key: "accounts", label: t("Clientes a cargo", "Customers in care"), help: t("Clientes de los que es responsable hoy.", "Customers they are responsible for today.") },
    { key: "activeAccounts", label: t("Clientes activos", "Active customers"), help: t("De sus clientes, los que en el periodo tuvieron una llamada, reunión o correo, una Necesidad nueva o una factura.", "Of their customers, those with a call, meeting or email, a new Need or an invoice in the period.") },
    { key: "contacts", label: t("Contactos hechos", "Contacts made"), help: t("Llamadas, reuniones y correos que registró con clientes en el periodo. Las notas no cuentan.", "Calls, meetings and emails they recorded with customers in the period. Notes do not count.") },
    { key: "needs", label: t("Necesidades nuevas", "New Needs"), help: t("Necesidades a su cargo creadas en el periodo.", "Needs in their care created in the period.") },
    { key: "quotes", label: t("Cotizaciones presentadas", "Quotes presented"), help: t("Necesidades a su cargo cuya cotización se presentó en el periodo.", "Needs in their care whose quote was presented in the period.") },
    { key: "pos", label: t("OC aceptadas", "POs accepted"), help: t("Órdenes de compra de clientes aceptadas en el periodo, en Necesidades a su cargo.", "Customer purchase orders accepted in the period, on Needs in their care.") },
    { key: "sales", label: t("Ventas facturadas", "Invoiced sales"), help: t("Valor de las facturas emitidas en el periodo, en USD, sin IVA, de Necesidades a su cargo.", "Value of the invoices issued in the period, in USD, before VAT, on Needs in their care."), money: true },
  ];
  return { period, order, start, end, rows: list, total, max, cols };
}
