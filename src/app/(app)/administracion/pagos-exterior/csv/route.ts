import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadForeignPayments } from "@/lib/foreign-payments";

// CSV with a UTF-8 BOM and semicolons so Excel (Spanish locale) opens it correctly.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const { rows } = await loadForeignPayments({
    month: sp.get("month") ?? undefined,
    currency: sp.get("currency") ?? undefined,
    state: sp.get("state") ?? undefined,
    country: sp.get("country") ?? undefined,
  });
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const header = ["Fecha solicitud", "Fecha pago", "Proveedor", "País", "Supplier PO", "Journey", "Cliente", "Moneda", "Monto", "USD aprox", "Motivo", "Verificó", "Aprobó", "Referencia banco"];
  const lines = rows.map((p) =>
    [
      day(p.createdAt),
      day(p.executedAt),
      p.supplierPo.supplier.name,
      p.supplierPo.supplier.country,
      p.supplierPo.code,
      p.supplierPo.deal.code,
      p.supplierPo.deal.account.name,
      p.currency,
      Number(p.amount).toFixed(2),
      p.currency === "USD" ? Number(p.amount).toFixed(2) : p.amountUsd ? Number(p.amountUsd).toFixed(2) : "",
      p.reason,
      p.verifiedBy?.name,
      p.approvedBy?.name,
      p.executedRef,
    ]
      .map(esc)
      .join(";"),
  );
  const body = "﻿" + [header.join(";"), ...lines].join("\r\n");
  return new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="pagos-exterior.csv"' },
  });
}
