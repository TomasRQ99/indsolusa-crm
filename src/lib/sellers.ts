import { db } from "./db";
import { ISSUER } from "./pdf-docs";

// Selling entities (decisions C-02, C-19, C-20, C-21): which of our companies sells on a Journey. The USA company is
// preloaded from the details already printed on documents. The Colombian company starts as an empty, inactive
// record: Gerencia types its legal name, NIT and address in Comercial → Configuración → Empresas que venden
// (nothing about it is invented here), and only then can it be chosen on a Journey.

export const SELLER_KEYS = ["USA", "CO"] as const;
export type SellerKey = (typeof SELLER_KEYS)[number];
export const SELLER_LABEL: Record<SellerKey, { es: string; en: string }> = { USA: { es: "Empresa en Estados Unidos", en: "United States company" }, CO: { es: "Empresa en Colombia", en: "Colombian company" } };

let ensured = false;
/** Creates the two records the first time (never overwrites what Gerencia saved). */
export async function ensureSellers() {
  if (ensured) return;
  await db.sellingEntity.upsert({ where: { key: "USA" }, update: {}, create: { key: "USA", legalName: ISSUER.name, addressLines: ISSUER.lines.slice(0, 2).join("\n"), phone: ISSUER.lines[2] ?? null, country: "USA", ivaPct: 0, allowsCop: false, invoiceMode: "SOLU", active: true } });
  await db.sellingEntity.upsert({ where: { key: "CO" }, update: {}, create: { key: "CO", legalName: "", taxIdLabel: "NIT", country: "Colombia", ivaPct: 19, allowsCop: true, invoiceMode: "EXTERNAL", active: false } });
  ensured = true;
}

export type Seller = Awaited<ReturnType<typeof getSellers>>[number];
export async function getSellers() {
  await ensureSellers();
  const rows = await db.sellingEntity.findMany();
  return SELLER_KEYS.map((k) => rows.find((r) => r.key === k)!).filter(Boolean);
}
export async function sellerOf(key: string | null | undefined) {
  const all = await getSellers();
  return all.find((s) => s.key === key) ?? all.find((s) => s.key === "USA")!;
}

/** What a company needs before it can sell: legal name, tax id and address. */
export const sellerMissing = (s: { legalName: string; taxId: string | null; addressLines: string | null; key: string }) =>
  [!s.legalName.trim() && "legalName", s.key !== "USA" && !s.taxId?.trim() && "taxId", !s.addressLines?.trim() && "addressLines"].filter((x): x is string => !!x);

/** The seller is fixed once the customer has seen a quote or an invoice exists: a different company means a new quote. */
export async function sellerLocked(dealId: string) {
  const [quotes, invoices] = await Promise.all([
    db.quote.count({ where: { dealId, status: { in: ["PRESENTED", "ACCEPTED"] } } }),
    db.invoice.count({ where: { dealId } }),
  ]);
  return quotes > 0 || invoices > 0;
}
