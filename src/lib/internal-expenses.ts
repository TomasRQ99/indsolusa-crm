// Compras internas, as the team uses them from Operaciones (owner, 2026-11-19): what the company buys for itself,
// products (a mouse, a laptop, staples) or services (training, maintenance, courses). It is not for sale and not for
// a customer. Anyone records a purchase with its receipt; once approved it counts in the month's spending report.
// It is the same record as Administración → Compras internas (InternalPurchase): one list, two doors.

import { db } from "./db";

type Txt = { es: string; en: string };
export const KINDS: Record<string, Txt> = { PRODUCT: { es: "Producto", en: "Product" }, SERVICE: { es: "Servicio", en: "Service" } };
export const CATEGORIES: Record<string, Txt & { hint: Txt }> = {
  TECH: { es: "Equipos y tecnología", en: "Equipment and technology", hint: { es: "Portátil, mouse, monitor, celular, impresora", en: "Laptop, mouse, monitor, phone, printer" } },
  OFFICE: { es: "Papelería y oficina", en: "Stationery and office", hint: { es: "Grapas, papel, tinta, sillas, cafetería", en: "Staples, paper, ink, chairs, pantry" } },
  SOFTWARE: { es: "Software y suscripciones", en: "Software and subscriptions", hint: { es: "Licencias, hosting, herramientas en línea", en: "Licences, hosting, online tools" } },
  TRAINING: { es: "Capacitación y cursos", en: "Training and courses", hint: { es: "Cursos, sesiones de formación, certificaciones", en: "Courses, training sessions, certifications" } },
  MAINTENANCE: { es: "Mantenimiento y reparaciones", en: "Maintenance and repairs", hint: { es: "Arreglo de equipos, aseo, servicio técnico", en: "Equipment repair, cleaning, technical service" } },
  SERVICES: { es: "Servicios profesionales", en: "Professional services", hint: { es: "Contador, abogado, diseño, asesorías", en: "Accountant, lawyer, design, advice" } },
  TRAVEL: { es: "Viajes y transporte", en: "Travel and transport", hint: { es: "Tiquetes, hotel, taxis, peajes", en: "Tickets, hotel, taxis, tolls" } },
  OTHER: { es: "Otro", en: "Other", hint: { es: "Lo que no cabe en las demás", en: "Whatever fits nowhere else" } },
};
export const RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MAX_FILES = 6;

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const monthStart = (key: string) => new Date(`${key}-01T00:00:00Z`);
export const monthNext = (key: string) => { const d = monthStart(key); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); };
export const isMonthKey = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** The month a purchase belongs to in the report: the day it was bought. */
const row = { id: true, code: true, description: true, kind: true, category: true, amount: true, currency: true, amountUsd: true, boughtAt: true, supplierName: true, supplier: { select: { name: true } }, requester: { select: { name: true } }, decidedByName: true, files: { select: { id: true, name: true } } } as const;

/** Approved purchases bought in that month: what the month's report counts. In USD. */
export async function monthReport(key: string) {
  const rows = await db.internalPurchase.findMany({ where: { status: "APPROVED", boughtAt: { gte: monthStart(key), lt: monthNext(key) } }, orderBy: { boughtAt: "asc" }, select: row });
  const sum = (xs: typeof rows) => Math.round(xs.reduce((s, x) => s + Number(x.amountUsd), 0) * 100) / 100;
  const group = (f: (x: (typeof rows)[number]) => string) => [...rows.reduce((m, x) => m.set(f(x), [...(m.get(f(x)) ?? []), x]), new Map<string, typeof rows>())].map(([k, xs]) => ({ key: k, n: xs.length, usd: sum(xs) })).sort((a, b) => b.usd - a.usd);
  return { rows, total: sum(rows), products: sum(rows.filter((x) => x.kind !== "SERVICE")), services: sum(rows.filter((x) => x.kind === "SERVICE")), byCategory: group((x) => x.category ?? "OTHER"), byPerson: group((x) => x.requester.name), noReceipt: rows.filter((x) => x.files.length === 0).length };
}

/** The last `n` months, oldest first, split into products and services: the chart. */
export async function monthSeries(endKey: string, n = 6) {
  const end = monthNext(endKey);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - n, 1));
  const rows = await db.internalPurchase.findMany({ where: { status: "APPROVED", boughtAt: { gte: start, lt: end } }, select: { kind: true, amountUsd: true, boughtAt: true } });
  const out = Array.from({ length: n }, (_, k) => ({ key: monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k, 1))), products: 0, services: 0 }));
  for (const r of rows) { const m = out.find((o) => o.key === monthKey(r.boughtAt!)); if (m) m[r.kind === "SERVICE" ? "services" : "products"] += Number(r.amountUsd); }
  return out.map((o) => ({ ...o, products: Math.round(o.products * 100) / 100, services: Math.round(o.services * 100) / 100 }));
}

/** Internal spending inside any period (start inclusive, end exclusive): approved purchases by the day they were bought. */
export async function rangeSpend(start: Date, end: Date) {
  const rows = await db.internalPurchase.findMany({ where: { status: "APPROVED", boughtAt: { gte: start, lt: end } }, select: { kind: true, amountUsd: true } });
  const sum = (xs: typeof rows) => Math.round(xs.reduce((s, x) => s + Number(x.amountUsd), 0) * 100) / 100;
  return { n: rows.length, total: sum(rows), products: sum(rows.filter((x) => x.kind !== "SERVICE")), services: sum(rows.filter((x) => x.kind === "SERVICE")) };
}
