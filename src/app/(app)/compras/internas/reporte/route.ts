import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { CATEGORIES, KINDS, isMonthKey, monthKey, monthReport } from "@/lib/internal-expenses";

// The month's internal spending as a spreadsheet file (CSV, opens in Excel): one line per approved purchase.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!canFinance(user)) return new Response("Forbidden", { status: 403 });
  const q = new URL(req.url).searchParams.get("mes");
  const key = isMonthKey(q) ? q : monthKey(new Date());
  const { rows } = await monthReport(key);
  const es = user.lang !== "EN";
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = es ? ["Código", "Fecha de compra", "Tipo", "Categoría", "Qué se compró", "Proveedor", "Quién la pidió", "Quién aprobó", "Valor", "Moneda", "Valor USD", "Recibos"] : ["Code", "Purchase date", "Kind", "Category", "What was bought", "Supplier", "Requested by", "Approved by", "Amount", "Currency", "Amount USD", "Receipts"];
  const lines = rows.map((r) => [r.code, r.boughtAt!.toISOString().slice(0, 10), KINDS[r.kind]?.[es ? "es" : "en"] ?? r.kind, CATEGORIES[r.category ?? "OTHER"]?.[es ? "es" : "en"] ?? r.category, r.description, r.supplier?.name ?? r.supplierName ?? "", r.requester.name, r.decidedByName ?? "", Number(r.amount).toFixed(2), r.currency, Number(r.amountUsd).toFixed(2), r.files.length].map(cell).join(","));
  const csv = "﻿" + [head.map(cell).join(","), ...lines].join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="compras-internas-${key}.csv"`, "Cache-Control": "private, no-store" } });
}
