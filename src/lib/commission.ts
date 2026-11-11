import type { CommissionPolicy } from "@prisma/client";
import { cmpMoney, money2, mulMoney, percentOf, subMoney, sumMoney } from "./money";
import { db } from "./db";
import { addDays, esagra, invoiceCash, today } from "./domain";
import { collectionRelease, shareText, sharesOf } from "./commission-split";

// Business rule (D-05): the commission is earned 50 % at the sale (invoice issued)
// and 50 % at collection (payment reconciled).
//   Sale half       = esagra at invoicing × tier × 50 %
//   Collection half = (final esagra × tier) − sale half, once the invoice is fully reconciled
// If the invoice goes `lossDays` past due unpaid, the collection half is not earned.

export type HalfState = "ESTIMATED" | "PARTIAL" | "EARNED" | "APPROVED" | "PAID" | "AT_RISK" | "LOST";

export type Half = {
  state: HalfState;
  amount: number; // best value (upper bound when at risk; earned so far when partial)
  full?: number; // the whole collection half once everything is collected (proportional policy)
  approved?: number; // already approved in earlier parts
  over?: number; // approved above what the final figures support: reported, never taken back automatically
  seq?: number; // which part this approval would be
  calc: string;
  entryId?: string;
};

export type CommissionRow = {
  key: string;
  dealId: string;
  dealCode: string | null;
  dealTitle: string;
  account: string;
  ownerId: string;
  ownerName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  sale: number;
  esagraAtIssue: number | null;
  esagraFinal: number;
  pctAtIssue: number | null;
  pctFinal: number | null;
  rateAtIssue: number;
  rateFinal: number;
  newClient: boolean;
  policyVersion: number | null;
  trace: { delivered: boolean; invoiced: boolean; collected: boolean; reconciled: boolean; problem: boolean };
  dueAt: Date | null;
  saleHalf: Half;
  collectionHalf: Half;
  projected: boolean;
};

type Tier = { min: number; rate: number };

export function tiersOf(p: CommissionPolicy | null): Tier[] {
  const raw = (p?.tiers ?? []) as unknown;
  if (!Array.isArray(raw)) return [];
  return (raw as Tier[]).map((t) => ({ min: Number(t.min), rate: Number(t.rate) })).sort((a, b) => a.min - b.min);
}

export function rateFor(p: CommissionPolicy | null, pct: number | null, newClient: boolean) {
  if (!p || pct == null) return 0;
  // The tier uses the percentage as people see it (one decimal): 17.997 % shows as 18,0 % and counts as 18.
  const shown = Math.round(pct * 10) / 10;
  let rate = 0;
  for (const t of tiersOf(p)) if (shown >= t.min) rate = t.rate;
  if (rate > 0 && newClient) rate += Number(p.newClientBonus);
  return rate;
}

function policyAt(policies: CommissionPolicy[], when: Date) {
  const sorted = [...policies].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return sorted.find((p) => p.effectiveFrom <= when) ?? sorted[sorted.length - 1] ?? null;
}

const r2 = (v: number) => money2(v);
const f = (v: number) => r2(v).toFixed(2);

export async function computeCommissions(opts: { userId?: string } = {}) {
  const now = today();
  const [policies, deals] = await Promise.all([db.commissionPolicy.findMany(), db.deal.findMany({
    // A person sees the sales they own and those where Gerencia gave them a share.
    where: { stage: "WON", ...(opts.userId ? { OR: [{ ownerId: opts.userId }, { commissionAllocations: { some: { userId: opts.userId, supersededAt: null } } }] } : {}) },
    include: {
      account: { select: { name: true, createdAt: true } },
      owner: { select: { id: true, name: true } },
      commissionAllocations: { where: { supersededAt: null }, select: { userId: true, pool: true, splitPct: true, user: { select: { name: true } } } },
      deliveries: { select: { id: true } },
      invoices: {
        orderBy: { issuedAt: "asc" },
        include: {
          applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } },
          commissions: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  })]);

  const rows: CommissionRow[] = [];
  for (const d of deals) {
    const policy = policyAt(policies, d.poAcceptedAt ?? d.createdAt);
    const salePct = policy?.salePercent ?? 50;
    const eg = esagra(d);
    const isNew = (when: Date) => when.getTime() - d.account.createdAt.getTime() < 365 * 864e5;
    // Módulo 12 §11–12: the fund split by function (policy) and by person (Gerencia). Nobody named = the negotiator.
    const shares = sharesOf(policy, d.commissionAllocations.map((a) => ({ userId: a.userId, userName: a.user.name, pool: a.pool, splitPct: Number(a.splitPct) })), d.owner).filter((s) => !opts.userId || s.userId === opts.userId);
    const whole = (s: { frac: number }) => Math.abs(s.frac - 1) < 1e-6;
    const part = (h: Half, s: (typeof shares)[number]): Half => (whole(s) ? h : { ...h, amount: mulMoney(h.amount, s.frac), full: h.full != null ? mulMoney(h.full, s.frac) : undefined, calc: h.calc ? `(${h.calc}) × ${shareText(s)}` : h.calc });

    for (const inv of d.invoices) {
      const cash = invoiceCash(inv);
      const amount = cash.amount;
      const eAtIssue = money2(inv.esagraAtIssue);
      const pctIssue = amount > 0 ? (eAtIssue / amount) * 100 : null;
      const finalE = eg.pct == null ? 0 : mulMoney(amount, eg.pct / 100);
      const newClient = isNew(inv.issuedAt);
      const rIssue = rateFor(policy, pctIssue, newClient);
      const rFinal = rateFor(policy, eg.pct, newClient);
      const saleAmt = mulMoney(eAtIssue, (rIssue * salePct) / 10000);
      const totalFinal = percentOf(finalE, rFinal);
      const collAmt = subMoney(totalFinal, saleAmt);
      const received = inv.applications.length > 0;
      const fully = cmpMoney(cash.balance, 0) <= 0;
      const overdue = now > inv.dueAt && !fully;
      const prop = !!policy?.proportionalCollection;
      // Módulo 12 §13.2–13.4: share of the invoice already settled by reconciled cash or withholdings.
      const ratio = amount > 0 ? Math.min(1, Math.max(0, subMoney(amount, cash.balance) / amount)) : 0;
      const lost = !prop && !fully && policy != null && now > addDays(inv.dueAt, policy.lossDays);

      for (const sh of shares) {
      const entry = (h: "SALE" | "COLLECTION") => inv.commissions.find((c) => c.half === h && c.userId === sh.userId);
      const fromEntry = (h: "SALE" | "COLLECTION", fallback0: Half): Half => {
        const fallback = part(fallback0, sh);
        const e = entry(h);
        if (!e) return fallback;
        return { state: e.paidAt ? "PAID" : "APPROVED", amount: money2(e.amount), calc: e.calculation, entryId: e.id };
      };

      const saleHalf = fromEntry("SALE", {
        state: "EARNED",
        amount: saleAmt,
        calc: `${f(eAtIssue)} × ${rIssue} % × ${salePct} %`,
      });
      let coll: Half;
      if (fully) {
        coll = { state: "EARNED", amount: collAmt, calc: `${f(finalE)} × ${rFinal} % − ${f(saleAmt)}` };
      } else if (prop && ratio > 0.0001) {
        // Released in proportion to what is really collected; it becomes approvable when the invoice is settled in full.
        coll = { state: "PARTIAL", amount: mulMoney(collAmt, ratio), full: collAmt, calc: `(${f(finalE)} × ${rFinal} % − ${f(saleAmt)}) × ${Math.round(ratio * 1000) / 10} %` };
      } else if (prop) {
        coll = { state: "ESTIMATED", amount: collAmt, calc: `${f(finalE)} × ${rFinal} % − ${f(saleAmt)}` };
      } else if (lost) {
        coll = { state: "LOST", amount: 0, calc: `+${policy?.lossDays} d` };
      } else if (overdue) {
        coll = { state: "AT_RISK", amount: collAmt, calc: `${f(finalE)} × ${rFinal} % − ${f(saleAmt)}` };
      } else {
        coll = { state: "ESTIMATED", amount: collAmt, calc: `${f(finalE)} × ${rFinal} % − ${f(saleAmt)}` };
      }
      if (prop) {
        // Paid in parts: what is newly collected becomes payable; earlier parts stay exactly as approved.
        const parts = inv.commissions.filter((c) => c.half === "COLLECTION" && c.userId === sh.userId);
        // Never negative: if the final Eságara fell below what the sale half already paid, nothing is taken back here.
        const fullS = Math.max(0, whole(sh) ? collAmt : mulMoney(collAmt, sh.frac));
        const rel = collectionRelease(fullS, ratio, sumMoney(parts.map((c) => c.amount)), parts.some((c) => !c.paidAt));
        coll = { state: rel.state, amount: rel.amount, full: fullS, approved: rel.approved, over: rel.over, seq: parts.length, calc: `(${f(finalE)} × ${rFinal} % − ${f(saleAmt)})${whole(sh) ? "" : ` × ${shareText(sh)}`} × ${Math.round(ratio * 1000) / 10} % cobrado${rel.approved > 0 ? ` − ${f(rel.approved)} ya aprobado` : ""}` };
      } else coll = fromEntry("COLLECTION", coll);

      rows.push({
        key: whole(sh) ? inv.id : `${inv.id}:${sh.userId}`,
        dealId: d.id,
        dealCode: d.code,
        dealTitle: d.title,
        account: d.account.name,
        // The person this row pays (the negotiator, or whoever Gerencia gave a share to).
        ownerId: sh.userId,
        ownerName: sh.userName,
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        sale: amount,
        esagraAtIssue: eAtIssue,
        esagraFinal: r2(finalE),
        pctAtIssue: pctIssue,
        pctFinal: eg.pct,
        rateAtIssue: rIssue,
        rateFinal: rFinal,
        newClient,
        policyVersion: policy?.version ?? null,
        trace: { delivered: !!inv.deliveryId || d.deliveries.length > 0, invoiced: true, collected: received, reconciled: fully, problem: overdue },
        dueAt: inv.dueAt,
        saleHalf,
        collectionHalf: coll,
        projected: false,
      });
      }
    }

    // Part of the Deal not invoiced yet: both halves are estimates.
    const invoiced = sumMoney(d.invoices.map((i) => i.amount));
    const pending = subMoney(d.amount, invoiced);
    if (pending > 0.5) {
      const e = eg.pct == null ? 0 : mulMoney(pending, eg.pct / 100);
      const newClient = isNew(now);
      const rate = rateFor(policy, eg.pct, newClient);
      const half0 = mulMoney(e, (rate * salePct) / 10000);
      for (const sh of shares) {
      const half = mulMoney(half0, sh.frac);
      rows.push({
        key: whole(sh) ? `${d.id}-pending` : `${d.id}-pending:${sh.userId}`,
        dealId: d.id,
        dealCode: d.code,
        dealTitle: d.title,
        account: d.account.name,
        ownerId: sh.userId,
        ownerName: sh.userName,
        invoiceId: null,
        invoiceNumber: null,
        sale: pending,
        esagraAtIssue: null,
        esagraFinal: r2(e),
        pctAtIssue: null,
        pctFinal: eg.pct,
        rateAtIssue: rate,
        rateFinal: rate,
        newClient,
        policyVersion: policy?.version ?? null,
        trace: { delivered: d.deliveries.length > 0, invoiced: false, collected: false, reconciled: false, problem: false },
        dueAt: null,
        saleHalf: { state: "ESTIMATED", amount: half, calc: `≈ ${f(e)} × ${rate} % × ${salePct} %` },
        collectionHalf: { state: "ESTIMATED", amount: subMoney(mulMoney(percentOf(e, rate), sh.frac), half), calc: "" },
        projected: true,
      });
      }
    }
  }

  const sum = (pred: (h: Half) => boolean) => {
    let lo = 0, hi = 0, count = 0;
    for (const r of rows)
      for (const h of [r.saleHalf, r.collectionHalf])
        if (pred(h)) {
          count++;
          hi += h.amount;
          if (h.state !== "AT_RISK") lo += h.amount;
        }
    return { lo: r2(lo), hi: r2(hi), count };
  };

  return {
    rows,
    policy: policies.sort((a, b) => b.version - a.version)[0] ?? null,
    totals: {
      estimated: sum((h) => h.state === "ESTIMATED" || h.state === "AT_RISK"),
      partial: sum((h) => h.state === "PARTIAL"),
      earned: sum((h) => h.state === "EARNED"),
      approved: sum((h) => h.state === "APPROVED"),
      paid: sum((h) => h.state === "PAID"),
    },
  };
}
