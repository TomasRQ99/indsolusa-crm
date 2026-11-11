import type { CommissionRow } from "./commission";

// Módulo 12 R4 · what a settlement run would approve (§21–22). Pure: no database.
// A run takes every half that is payable right now, for everyone except the person approving (nobody approves their own).

export type RunLine = { userId: string; userName: string; dealId: string; deal: string; account: string; invoiceId: string; invoice: string; half: "SALE" | "COLLECTION"; seq: number; amount: number; calc: string; policyVersion: number | null };
export function settlementPreview(rows: CommissionRow[], approverId: string) {
  const lines: RunLine[] = [];
  let own = 0, ownAmount = 0;
  const excess: { userName: string; deal: string; invoice: string; over: number }[] = [];
  for (const r of rows) {
    if (!r.invoiceId) continue;
    for (const [half, h] of [["SALE", r.saleHalf], ["COLLECTION", r.collectionHalf]] as const) {
      if (h.over && h.over > 0.005) excess.push({ userName: r.ownerName, deal: r.dealCode ?? r.dealTitle, invoice: r.invoiceNumber ?? "", over: h.over });
      if (h.state !== "EARNED" || !(h.amount > 0.005)) continue;
      if (r.ownerId === approverId) { own++; ownAmount += h.amount; continue; }
      lines.push({ userId: r.ownerId, userName: r.ownerName, dealId: r.dealId, deal: r.dealCode ?? r.dealTitle, account: r.account, invoiceId: r.invoiceId, invoice: r.invoiceNumber ?? "", half, seq: half === "COLLECTION" ? h.seq ?? 0 : 0, amount: Math.round(h.amount * 100) / 100, calc: h.calc, policyVersion: r.policyVersion });
    }
  }
  const byPerson = [...new Map(lines.map((l) => [l.userId, l.userName])).entries()].map(([userId, userName]) => ({ userId, userName, lines: lines.filter((l) => l.userId === userId), total: Math.round(lines.filter((l) => l.userId === userId).reduce((s, l) => s + l.amount, 0) * 100) / 100 }));
  return { lines, byPerson, total: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100, own, ownAmount: Math.round(ownAmount * 100) / 100, excess };
}
export const validPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
