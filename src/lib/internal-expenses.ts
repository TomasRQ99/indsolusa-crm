// Compras internas, as the team uses them from Operaciones (owner, 2026-11-19): what the company buys for itself,
// products (a mouse, a laptop, staples) or services (training, maintenance, courses). It is not for sale and not for
// a customer. Anyone records a purchase with its receipt; once approved it counts in the month's spending report.
// It is the same record as Administración → Compras internas (InternalPurchase): one list, two doors.

import { db } from "./db";

type Txt = { es: string; en: string };
export const KINDS: Record<string, Txt> = { PRODUCT: { es: "Producto", en: "Product" }, SERVICE: { es: "Servicio", en: "Service" } };
export const CATEGORIES: Record<string, Txt & { hint: Txt }> = {
  // The owner's list of accounts (2026-11-19), in the names the bookkeeping uses, plus the ones the company already had.
  AUTO: { es: "Vehículos: auto y camión", en: "Auto & Truck Expenses", hint: { es: "Gasolina, aceite, llantas, reparaciones del vehículo", en: "Fuel, oil, tires, vehicle repairs" } },
  BANK: { es: "Cargos bancarios", en: "Bank Service Charges", hint: { es: "Cuota de manejo, costo de transferencias y giros", en: "Account fees, transfer and wire fees" } },
  INSURANCE: { es: "Seguros", en: "Insurance Expense", hint: { es: "Pólizas de la empresa, del vehículo, de responsabilidad", en: "Company, vehicle and liability policies" } },
  LICENSES: { es: "Licencias y permisos", en: "Licenses & Permits", hint: { es: "Permisos, registros y renovaciones (las del estado de Florida van aparte)", en: "Permits, registrations and renewals (Florida state ones go apart)" } },
  FL_LICENSES: { es: "Licencias del estado de Florida", en: "Florida State Licenses", hint: { es: "Reporte anual, registros y licencias ante el estado de Florida", en: "Annual report, registrations and licences with the State of Florida" } },
  MEALS: { es: "Comidas y atenciones", en: "Meals & Entertainment", hint: { es: "Almuerzos de trabajo, atención a clientes o visitantes", en: "Working lunches, hosting customers or visitors" } },
  OFFICE: { es: "Suministros de oficina", en: "Office Supplies", hint: { es: "Grapas, papel, tinta, cafetería", en: "Staples, paper, ink, pantry" } },
  ACCOUNTING: { es: "Honorarios profesionales: contabilidad", en: "Professional Fees: Accounting", hint: { es: "Contador, declaraciones, auditoría", en: "Accountant, tax returns, audit" } },
  SERVICES: { es: "Honorarios profesionales: otros", en: "Professional Fees: Other", hint: { es: "Abogado, diseño, asesorías", en: "Lawyer, design, advice" } },
  RENTAL_CAR: { es: "Alquiler de vehículo", en: "Rental Car", hint: { es: "Carro alquilado para un viaje o una visita", en: "A car rented for a trip or a visit" } },
  FURNITURE: { es: "Muebles y equipos pequeños", en: "Small Furniture & Equipment", hint: { es: "Sillas, escritorios, archivadores, herramientas pequeñas", en: "Chairs, desks, filing cabinets, small tools" } },
  SOFTWARE: { es: "Software y suscripciones", en: "Software", hint: { es: "Licencias, hosting, herramientas en línea", en: "Licences, hosting, online tools" } },
  TELEPHONE: { es: "Teléfono y celular", en: "Telephone Expenses", hint: { es: "Planes de celular, líneas fijas, llamadas", en: "Mobile plans, landlines, calls" } },
  TRAVEL: { es: "Viajes", en: "Travel Expenses", hint: { es: "Tiquetes aéreos, hotel, equipaje", en: "Air tickets, hotel, baggage" } },
  COMMISSION: { es: "Comisiones de ventas", en: "Sales Commission", hint: { es: "Comisión pagada a un vendedor o a un tercero por una venta", en: "Commission paid to a salesperson or a third party for a sale" } },
  PARKING: { es: "Parqueaderos y peajes", en: "Parking & Tolls", hint: { es: "Parqueadero, peajes, SunPass", en: "Parking, tolls, SunPass" } },
  TECH: { es: "Computadores e internet", en: "Computer & Internet", hint: { es: "Portátil, mouse, monitor, impresora, servicio de internet", en: "Laptop, mouse, monitor, printer, internet service" } },
  FINANCE_CHARGES: { es: "Cargos financieros", en: "Finance Charges", hint: { es: "Intereses, mora, costo de financiación", en: "Interest, late fees, financing cost" } },
  CARD_FEES: { es: "Comisiones de tarjeta de crédito", en: "Credit Card Fees", hint: { es: "Cuota anual de la tarjeta, comisión por cobrar con tarjeta", en: "Card annual fee, fee for charging a card" } },
  TRANSPORT: { es: "Transporte", en: "Transportation Expenses", hint: { es: "Taxi, Uber, bus, metro", en: "Taxi, Uber, bus, metro" } },
  // Added because the company already has these expenses.
  TRAINING: { es: "Capacitación y cursos", en: "Training & Courses", hint: { es: "Cursos, sesiones de formación, certificaciones", en: "Courses, training sessions, certifications" } },
  MAINTENANCE: { es: "Mantenimiento y reparaciones", en: "Repairs & Maintenance", hint: { es: "Arreglo de equipos, aseo, servicio técnico", en: "Equipment repair, cleaning, technical service" } },
  RENT: { es: "Arriendo de oficina o bodega", en: "Rent", hint: { es: "Arriendo mensual, administración del edificio", en: "Monthly rent, building fees" } },
  UTILITIES: { es: "Servicios públicos", en: "Utilities", hint: { es: "Energía, agua, gas", en: "Electricity, water, gas" } },
  MARKETING: { es: "Publicidad y mercadeo", en: "Advertising & Marketing", hint: { es: "Correos masivos, anuncios, ferias, tarjetas, material impreso", en: "Email campaigns, ads, trade shows, cards, printed material" } },
  SHIPPING: { es: "Mensajería y envíos internos", en: "Postage & Courier", hint: { es: "Documentos y paquetes de la empresa (no el envío de un pedido de cliente)", en: "Company documents and parcels (not the shipment of a customer order)" } },
  DUES: { es: "Afiliaciones y membresías", en: "Dues & Memberships", hint: { es: "Cámara de Comercio, gremios, asociaciones", en: "Chamber of Commerce, trade associations" } },
  TAXES: { es: "Impuestos y tasas", en: "Taxes & Government Fees", hint: { es: "Impuestos locales, tasas, timbres", en: "Local taxes, fees, stamps" } },
  OTHER: { es: "Otro", en: "Other", hint: { es: "Lo que no cabe en las demás", en: "Whatever fits nowhere else" } },
};
/** The categories for a list a person chooses from: by name in their language, "Other" at the end. */
export const categoryOptions = (es: boolean) => Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: es ? c.es : c.en, hint: es ? c.hint.es : c.hint.en })).sort((a, b) => (a.key === "OTHER" ? 1 : b.key === "OTHER" ? -1 : a.label.localeCompare(b.label, es ? "es" : "en")));
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

/** What was bought before, so nobody types it twice: one line per different purchase (by its name), the most recent
 *  first, with how many times it was recorded. Names, category and seller are shared by everyone; the amount and the
 *  reason are copied only from a person's own purchases, or for those who see the report anyway. */
export type PastPurchase = { id: string; description: string; kind: string; category: string; supplierName: string; currency: string; amount: number | null; need: string; times: number; last: string };
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export async function pastPurchases(userId: string, seeAll: boolean, take = 500): Promise<PastPurchase[]> {
  const rows = await db.internalPurchase.findMany({ where: { status: { notIn: ["REJECTED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take, select: { id: true, description: true, need: true, kind: true, category: true, supplierName: true, supplier: { select: { name: true } }, currency: true, amount: true, requesterId: true, boughtAt: true, createdAt: true } });
  const out = new Map<string, PastPurchase & { full: boolean }>();
  for (const r of rows) {
    const k = plain(r.description), full = seeAll || r.requesterId === userId, had = out.get(k);
    const money = { currency: r.currency, amount: Number(r.amount), need: r.need && plain(r.need) !== k ? r.need : "" };
    if (had) { had.times++; if (!had.full && full) Object.assign(had, money, { full: true }); continue; }
    out.set(k, { id: r.id, description: r.description, kind: KINDS[r.kind] ? r.kind : "PRODUCT", category: r.category && CATEGORIES[r.category] ? r.category : "", supplierName: r.supplier?.name ?? r.supplierName ?? "", ...(full ? money : { currency: r.currency, amount: null, need: "" }), times: 1, last: (r.boughtAt ?? r.createdAt).toISOString().slice(0, 10), full });
  }
  return [...out.values()].slice(0, 200).map(({ full: _f, ...p }) => p);
}
