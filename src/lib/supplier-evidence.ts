// Supplier evidence (L6): facts about what a supplier promised and what happened, with dates.
// Deliberately NO score or ranking: each fact stands on its own, with how many cases it is based on,
// so a person can judge. Reply tracking is per supplier (a company), never per person.
import { db } from "./db";
import { daysBetween, today } from "./domain";

export type SupplierEvidence = {
  supplierId: string;
  /** Ready-to-ship: promised ship-by vs actual, on POs that were released/confirmed. */
  rts: { measured: number; onTime: number; medianDelta: number | null; openLate: number; last: Date | null };
  /** Quote requests (RFQ) sent from sales@ to this supplier. */
  rfq: { asked: number; answered: number; declined: number; waiting: number; failed: number; medianReplyHours: number | null; last: Date | null };
  /** Quotes / proformas received and offers still valid. */
  docs: { count: number; last: Date | null; bankDifferent: number };
  offers: { valid: number; total: number };
  /** Recoveries on Journeys with this supplier whose material cause was marked SUPPLIER. */
  recoveries: { supplierCaused: number; open: number; last: Date | null };
  pos: { count: number; last: Date | null; open: number };
  bankVerifiedAt: Date | null;
  /** For one part: how many times we bought it from this supplier. */
  partBuys?: number;
};

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function supplierEvidence(ids: string[], opts: { partKeys?: string[] } = {}): Promise<Map<string, SupplierEvidence>> {
  const out = new Map<string, SupplierEvidence>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return out;
  const now = today();
  const [sups, pos, recips, docs, offers] = await Promise.all([
    db.supplier.findMany({ where: { id: { in: uniq } }, select: { id: true, bankVerifiedAt: true } }),
    db.supplierPO.findMany({
      where: { supplierId: { in: uniq } },
      select: { id: true, supplierId: true, releasedAt: true, confirmedAt: true, createdAt: true, receivedAt: true, shipBy: true, shippedAt: true, dealId: true,
        shipments: { select: { rtsAt: true, pickedUpAt: true } },
        lines: opts.partKeys?.length ? { select: { code: true } } : false },
    }),
    db.rfqRecipient.findMany({ where: { supplierId: { in: uniq } }, select: { supplierId: true, status: true, sentAt: true, answeredAt: true, repliedAt: true, rfq: { select: { createdAt: true } } } }),
    db.supplierDoc.findMany({ where: { supplierId: { in: uniq } }, select: { supplierId: true, createdAt: true, bankWarning: true } }),
    db.supplierOffer.findMany({ where: { supplierId: { in: uniq } }, select: { supplierId: true, validUntil: true } }),
  ]);
  // Recoveries live on the Journey: count those on Journeys where this supplier had a PO.
  const dealIds = [...new Set(pos.map((p) => p.dealId))];
  // A Recovery doesn't say WHICH supplier caused it, so it is only attributed when that Journey
  // had a single supplier; otherwise blaming every supplier on the Journey would be unfair.
  const [recs, dealSups] = dealIds.length ? await Promise.all([
    db.recovery.findMany({ where: { dealId: { in: dealIds }, cause: "SUPPLIER" }, select: { dealId: true, openedAt: true, resolvedAt: true, outcome: true } }),
    db.supplierPO.findMany({ where: { dealId: { in: dealIds } }, select: { dealId: true, supplierId: true } }),
  ]) : [[], []];
  const supsByDeal = new Map<string, Set<string>>();
  for (const x of dealSups) { if (!supsByDeal.has(x.dealId)) supsByDeal.set(x.dealId, new Set()); supsByDeal.get(x.dealId)!.add(x.supplierId); }
  const keyOf = (c: string | null | undefined) => (c ?? "").toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
  const keys = new Set(opts.partKeys ?? []);

  for (const s of sups) {
    const mine = pos.filter((p) => p.supplierId === s.id);
    const deltas: number[] = []; let onTime = 0, openLate = 0; let last: Date | null = null;
    for (const p of mine.filter((x) => x.releasedAt || x.confirmedAt)) {
      const ship = p.shipments.find((x) => x.rtsAt || x.pickedUpAt);
      const actual = p.shippedAt ?? ship?.rtsAt ?? ship?.pickedUpAt ?? null;
      if (p.shipBy && actual) { const d = daysBetween(p.shipBy, actual); deltas.push(d); if (d <= 0) onTime++; }
      else if (!actual && p.shipBy && p.shipBy < now) openLate++;
      if (actual && (!last || actual > last)) last = actual;
    }
    const rs = recips.filter((r) => r.supplierId === s.id);
    // Reply time = first email reply seen in sales@ (E2), else when their quote was registered.
    const firstReply = (r: (typeof rs)[number]) => (r.repliedAt && (!r.answeredAt || r.repliedAt < r.answeredAt) ? r.repliedAt : r.status === "ANSWERED" ? r.answeredAt : null);
    const replies = rs.filter((r) => r.sentAt && firstReply(r)).map((r) => (firstReply(r)!.getTime() - r.sentAt!.getTime()) / 3_600_000);
    const ds = docs.filter((d) => d.supplierId === s.id);
    const os = offers.filter((o) => o.supplierId === s.id);
    const myDeals = new Set(mine.map((p) => p.dealId));
    const rc = recs.filter((r) => myDeals.has(r.dealId) && supsByDeal.get(r.dealId)?.size === 1);
    const lastDate = (xs: (Date | null | undefined)[]) => xs.filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null;
    out.set(s.id, {
      supplierId: s.id,
      rts: { measured: deltas.length, onTime, medianDelta: median(deltas), openLate, last },
      rfq: {
        asked: rs.length, answered: rs.filter((r) => r.status === "ANSWERED" || (r.repliedAt && r.status !== "DECLINED")).length, declined: rs.filter((r) => r.status === "DECLINED").length,
        waiting: rs.filter((r) => r.status === "SENT" && !r.repliedAt).length, failed: rs.filter((r) => r.status === "FAILED").length,
        medianReplyHours: median(replies), last: lastDate(rs.map((r) => r.sentAt ?? r.rfq.createdAt)),
      },
      docs: { count: ds.length, last: lastDate(ds.map((d) => d.createdAt)), bankDifferent: ds.filter((d) => d.bankWarning === "DIFFERENT").length },
      offers: { valid: os.filter((o) => !o.validUntil || o.validUntil >= now).length, total: os.length },
      recoveries: { supplierCaused: rc.length, open: rc.filter((r) => !r.resolvedAt && !r.outcome).length, last: lastDate(rc.map((r) => r.openedAt)) },
      pos: { count: mine.length, last: lastDate(mine.map((p) => p.releasedAt ?? p.createdAt)), open: mine.filter((p) => p.releasedAt && !p.receivedAt).length },
      bankVerifiedAt: s.bankVerifiedAt,
      partBuys: keys.size ? mine.filter((p) => (p.lines as { code: string | null }[] | undefined)?.some((l) => keys.has(keyOf(l.code)))).length : undefined,
    });
  }
  return out;
}

/** Plain-language reply time: "4 h", "2 d". */
export const replyLabel = (h: number | null, t: (es: string, en: string) => string) =>
  h == null ? null : h < 24 ? t(`${Math.max(1, Math.round(h))} h`, `${Math.max(1, Math.round(h))} h`) : t(`${Math.round(h / 24)} d`, `${Math.round(h / 24)} d`);

/** How many independent kinds of evidence confirm a part exists as described. */
export async function partConfirmations(partId: string, buys: number) {
  const [offers, web, answered] = await Promise.all([
    db.supplierOffer.groupBy({ by: ["supplierId"], where: { partId } }),
    db.webSource.findMany({ where: { partId, matched: true }, select: { host: true } }),
    db.supplierDoc.count({ where: { offers: { some: { partId } } } }),
  ]);
  const hosts = [...new Set(web.map((w) => w.host))];
  return { buys, offerSuppliers: offers.length, docs: answered, webHosts: hosts, total: (buys ? 1 : 0) + offers.length + hosts.length };
}
