import type { Role } from "@prisma/client";
import { db } from "./db";
import { addDays, invoiceCash, today } from "./domain";
import { sumMoney } from "./money";
import { periodOf, shiftPeriod } from "./goal-rules";
import { computePulse } from "./pulse";
import { futurePulse, interventionQueue } from "./future-pulse";
import { resourceExposure } from "./admin-home";
import { opsHome } from "./ops-home";
import { focusViews, getFocusPolicy } from "./focus";
import { highValueCommitments } from "./hv";
import { peopleCapacity } from "./gerencia-people";
import { decisionsNeeded, getGerenciaPolicy } from "./gerencia-store";
import { bridgeSplit, concentration, materialChanges, type BridgeKey, type Watched } from "./gerencia-rules";

// Módulo 15 §2 · Gerencia Home and §16–18 · the bridge to the future. Every figure here is read from the module that
// owns it (Informes pulse, Administración exposure, Operaciones, Comercial focus), so Gerencia never sees a number
// that differs from the one the team sees, and each one opens the place where its evidence lives (AC6, AC18).

type Txt = { es: string; en: string };
const tx = (es: string, en: string): Txt => ({ es, en });
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Figure = { label: Txt; value: number; unit: "usd" | "n" | "pct"; href: string; prev?: number | null; note?: Txt; tone?: "risk" | "attn"; metric?: string; state?: boolean };
export type Tile = { key: string; title: Txt; question: Txt; figures: Figure[]; href: string };

/** The figures the daily picture keeps, so a change is a fact (§14). */
export const WATCHED_TEXT: Record<string, Txt & { group: "risk" | "future" }> = {
  outstanding: { ...tx("Por cobrar", "Outstanding"), group: "risk" }, overdue: { ...tx("Cartera vencida", "Overdue receivables"), group: "risk" },
  available: { ...tx("Liquidez disponible", "Available liquidity"), group: "risk" }, overLimit: { ...tx("Crédito usado por encima de los cupos", "Credit used above limits"), group: "risk" },
  supplierAdvanced: { ...tx("Anticipado a proveedores sin recibir", "Advanced to suppliers, not received"), group: "risk" }, openExceptions: { ...tx("Excepciones operativas abiertas", "Open operational exceptions"), group: "risk" },
  quotedEsagara: { ...tx("Eságara en cotizaciones presentadas", "Eságara in presented quotes"), group: "future" }, contracted: { ...tx("Contratado por facturar", "Contracted, to invoice"), group: "future" },
  needs: { ...tx("Necesidades abiertas sin cotizar", "Open Needs not quoted"), group: "future" },
};

export async function gerenciaHome(u: { id: string; role: Role }) {
  const T = today();
  const period = periodOf(T);
  const [pulse, fut, exp, ops, people, needed, queue, market, strategic, lastSnap, pol] = await Promise.all([
    computePulse(period), futurePulse(), resourceExposure(u.id), opsHome(), peopleCapacity(T), decisionsNeeded(u), interventionQueue(u.id, 6),
    Promise.all([db.whiteSpace.count({ where: { status: { in: ["OPEN", "EXPLORING"] } } }), db.marketSignal.count({ where: { status: "NEW" } }), db.deal.count({ where: { internal: false, createdAt: { gte: addDays(T, -30) }, desiredResult: { not: null }, NOT: { desiredResult: "" } } })]),
    db.strategicAccount.findMany({ where: { active: true }, select: { id: true, nextMove: true, nextMoveOn: true, account: { select: { id: true, name: true } } } }),
    db.managementSnapshot.findFirst({ where: { day: { lt: T.toISOString().slice(0, 10) } }, orderBy: { day: "desc" } }),
    getGerenciaPolicy(),
  ]);
  const c = pulse.cur, p = pulse.prev, s = pulse.state;
  const atRisk = ops.atRisk.filter((x) => x.health === "BREACHED" || x.health === "AT_RISK");

  // A · Business Pulse: result, cash, fulfilment, exceptions, resources and people stay apart (AC4).
  const business: Tile[] = [
    { key: "result", title: tx("Resultado", "Result"), question: tx("¿Estamos creciendo y ganando Eságara?", "Are we growing and earning Eságara?"), href: "/informes/pulso", figures: [
      { label: tx("Venta del mes", "Sales this month"), value: c.sale, unit: "usd", prev: p.sale, href: "/informes/funcion", metric: "SALES" },
      { label: tx("Eságara ganada", "Eságara won"), value: c.esagara, unit: "usd", prev: p.esagara, href: "/gerencia/rentabilidad", metric: "ESAGARA_AMOUNT" },
      ...(c.esagaraPct != null ? [{ label: tx("Eságara % de la venta", "Eságara % of sales"), value: c.esagaraPct, unit: "pct" as const, prev: p.esagaraPct, href: "/gerencia/rentabilidad", metric: "ESAGARA_PCT" }] : []),
    ] },
    { key: "cash", title: tx("Caja y cartera", "Cash and receivables"), question: tx("¿Estamos cobrando?", "Are we collecting?"), href: "/administracion/tesoreria", figures: [
      { label: tx("Cobrado y conciliado en el mes", "Collected and reconciled this month"), value: c.collected, unit: "usd", prev: p.collected, href: "/administracion/pagos-recibidos" },
      { label: tx("Por cobrar hoy", "Outstanding today"), value: s.outstanding, unit: "usd", href: "/administracion/cobrar", state: true, metric: "OUTSTANDING" },
      { label: tx("Vencido hoy", "Overdue today"), value: s.overdue, unit: "usd", href: "/administracion/cobrar", state: true, tone: s.overdue > 0.005 ? "attn" : undefined, metric: "OVERDUE" },
    ] },
    { key: "promise", title: tx("Promesa al cliente", "Customer promise"), question: tx("¿Estamos cumpliendo?", "Are we delivering?"), href: "/operaciones", figures: [
      { label: tx("Entregas dentro de la promesa", "Deliveries within the promise"), value: c.onTime, unit: "n", prev: p.onTime, href: "/operaciones/metricas", note: tx(`de ${c.withPromise} con fecha prometida este mes`, `of ${c.withPromise} with a promised date this month`), metric: "CUSTOMER_PROMISE" },
      { label: tx("Promesas en riesgo o incumplidas hoy", "Promises at risk or missed today"), value: atRisk.length, unit: "n", href: "/operaciones", state: true, tone: atRisk.length ? "risk" : undefined },
      { label: tx("Entregado sin facturar", "Delivered, not invoiced"), value: s.notInvoiced, unit: "n", href: "/operaciones/por-facturar", state: true },
    ] },
    { key: "exceptions", title: tx("Excepciones operativas", "Operational exceptions"), question: tx("¿Qué se salió de lo normal?", "What left the normal path?"), href: "/operaciones", figures: [
      { label: tx("Abiertas hoy", "Open today"), value: s.openExc, unit: "n", href: "/operaciones", state: true, tone: s.openExc ? "attn" : undefined },
      { label: tx("Abiertas en el mes", "Opened this month"), value: c.exceptionsOpened, unit: "n", prev: p.exceptionsOpened, href: "/operaciones" },
      { label: tx("Resueltas en el mes", "Resolved this month"), value: c.exceptionsResolved, unit: "n", prev: p.exceptionsResolved, href: "/operaciones" },
    ] },
    { key: "resources", title: tx("Recursos expuestos", "Resources exposed"), question: tx("¿Dónde está el riesgo?", "Where is the risk?"), href: "/administracion/exposicion", figures: [
      { label: tx("Liquidez disponible", "Available liquidity"), value: exp.cash.available, unit: "usd", href: "/administracion/tesoreria#liquidez", state: true, tone: exp.cash.available < 0 || exp.cash.gap > 0 ? "risk" : undefined, note: exp.cash.gap > 0 ? tx("hay faltante en los próximos 90 días", "there is a gap in the next 90 days") : undefined },
      { label: tx("Crédito usado sobre los cupos", "Credit used above limits"), value: exp.customer.overUsd, unit: "usd", href: "/administracion/cupos", state: true, tone: exp.customer.overN ? "attn" : undefined, note: tx(`${exp.customer.overN} cliente(s)`, `${exp.customer.overN} customer(s)`) },
      { label: tx("Anticipado a proveedores sin recibir", "Advanced to suppliers, not received"), value: exp.supplier.advanced, unit: "usd", href: "/administracion/exposicion#proveedores", state: true },
    ] },
    { key: "people", title: tx("Personas y capacidad", "People and capacity"), question: tx("¿Tenemos con quién cumplir?", "Do we have the people to deliver?"), href: "/gerencia/personas", figures: [
      { label: tx("Ausencias en 30 días sin quien cubra", "Absences in 30 days with nobody covering"), value: people.uncovered.length, unit: "n", href: "/gerencia/personas#ausencias", state: true, tone: people.uncovered.length ? "attn" : undefined },
      { label: tx("Relaciones clave sin respaldo", "Key relationships with no backup"), value: people.noBackup.length, unit: "n", href: "/gerencia/personas#respaldo", state: true, tone: people.noBackup.length ? "attn" : undefined },
      { label: tx("Soporte que la empresa debe, escalado", "Support the company owes, escalated"), value: people.gaps.filter((g) => g.escalated).length, unit: "n", href: "/gerencia/personas#soporte", state: true, tone: people.gaps.some((g) => g.escalated) ? "risk" : undefined },
    ] },
  ];

  // B · Future Pulse: counts and amounts in real states, with their basis. No probability anywhere (AC5).
  const [whiteSpaces, newSignals, needs30] = market;
  const lateMoves = strategic.filter((a) => !a.nextMove || (a.nextMoveOn && a.nextMoveOn < T));
  const future: Tile[] = [
    { key: "needs", title: tx("Necesidades", "Needs"), question: tx("¿Estamos creando futuro?", "Are we creating future?"), href: "/gerencia/futuro", figures: [
      { label: tx("Abiertas sin cotizar", "Open, not quoted"), value: fut.commercial.needs, unit: "n", href: "/comercial/foco", state: true },
      { label: tx("Nuevas en 30 días", "New in 30 days"), value: needs30, unit: "n", href: "/deals" },
    ] },
    { key: "potential", title: tx("Eságara que puede venir", "Eságara that may come"), question: tx("¿Cuánto hay en decisión del cliente?", "How much is with the customer to decide?"), href: "/gerencia/futuro#esagara", figures: [
      { label: tx("En cotizaciones presentadas", "In presented quotes"), value: fut.commercial.presented.esagara, unit: "usd", href: "/cotizaciones", state: true, note: tx(`${fut.commercial.presented.n} cotización(es); el cliente puede decir sí o no`, `${fut.commercial.presented.n} quote(s); the customer may say yes or no`) },
      { label: tx("Decisiones esperadas en 30 días", "Decisions expected within 30 days"), value: fut.commercial.decisions.D30.n + fut.commercial.decisions.OVERDUE.n, unit: "n", href: "/comercial/foco", state: true, note: fut.commercial.decisions.OVERDUE.n ? tx(`${fut.commercial.decisions.OVERDUE.n} ya pasaron su fecha`, `${fut.commercial.decisions.OVERDUE.n} already past their date`) : undefined, tone: fut.commercial.decisions.OVERDUE.n ? "attn" : undefined },
    ] },
    { key: "contracted", title: tx("Contratado", "Contracted"), question: tx("¿Qué ya es compromiso?", "What is already a commitment?"), href: "/gerencia/futuro", figures: [
      { label: tx("Aceptado por facturar", "Accepted, to invoice"), value: fut.contracted.usd, unit: "usd", href: "/informes/futuro", state: true, note: tx(`${fut.contracted.n} Journey(s)`, `${fut.contracted.n} Journey(s)`) },
    ] },
    { key: "cash", title: tx("Dinero esperado y compromisos", "Expected money and commitments"), question: tx("¿Qué entra y qué sale en 30 días?", "What comes in and goes out in 30 days?"), href: "/administracion/tesoreria#proyeccion", figures: [
      { label: tx("Por cobrar que vence en 30 días", "Receivables due within 30 days"), value: fut.cashIn.D30.usd, unit: "usd", href: "/informes/administracion", state: true },
      { label: tx("Pagos a proveedores en 30 días", "Supplier payments within 30 days"), value: r2(fut.cashOut.D30.usd + fut.cashOut.OVERDUE.usd), unit: "usd", href: "/administracion/pagar#calendario", state: true },
      { label: tx("Obligaciones por pagar al año", "Obligations to pay per year"), value: exp.contractual.payYear, unit: "usd", href: "/administracion/obligaciones", state: true, note: exp.contractual.decide ? tx(`${exp.contractual.decide} por decidir`, `${exp.contractual.decide} to decide`) : undefined },
    ] },
    { key: "market", title: tx("Mercado", "Market"), question: tx("¿Qué vemos venir?", "What do we see coming?"), href: "/mercado", figures: [
      { label: tx("Oportunidades futuras en 90 días", "Future opportunities within 90 days"), value: fut.market.D30.n + fut.market.D90.n, unit: "n", href: "/mercado", state: true },
      { label: tx("Señales nuevas sin revisar", "New signals not reviewed"), value: newSignals, unit: "n", href: "/mercado", state: true },
      { label: tx("Espacios en blanco abiertos", "Open white spaces"), value: whiteSpaces, unit: "n", href: "/mercado", state: true },
    ] },
    { key: "accounts", title: tx("Cuentas estratégicas", "Strategic accounts"), question: tx("¿Estamos moviendo las cuentas que elegimos?", "Are we moving the accounts we chose?"), href: "/gerencia/cuentas", figures: [
      { label: tx("Cuentas elegidas", "Chosen accounts"), value: strategic.length, unit: "n", href: "/gerencia/cuentas", state: true },
      { label: tx("Sin próximo movimiento o con fecha pasada", "No next movement, or past its date"), value: lateMoves.length, unit: "n", href: "/gerencia/cuentas", state: true, tone: lateMoves.length ? "attn" : undefined },
    ] },
  ];

  // D · Resource & risk exposure: seven separate lines, never one score (AC14).
  const fxTotal = exp.fx.length;
  const exposure: { key: string; title: Txt; value: string; detail: Txt; tone: "risk" | "attn" | "ok"; href: string }[] = [
    { key: "cash", title: tx("Caja", "Cash"), value: usdTxt(exp.cash.available), detail: exp.cash.gap > 0 ? tx(`Faltante de ${usdTxt(exp.cash.gap)} hacia el ${exp.cash.lowOn?.toISOString().slice(0, 10) ?? "—"}`, `Gap of ${usdTxt(exp.cash.gap)} around ${exp.cash.lowOn?.toISOString().slice(0, 10) ?? "—"}`) : exp.cash.missing + exp.cash.stale > 0 ? tx(`${exp.cash.missing + exp.cash.stale} cuenta(s) sin saldo confirmado esta semana`, `${exp.cash.missing + exp.cash.stale} account(s) with no balance confirmed this week`) : tx("Disponible, sin faltante a 90 días", "Available, no gap within 90 days"), tone: exp.cash.gap > 0 || exp.cash.available < 0 ? "risk" : exp.cash.missing + exp.cash.stale > 0 ? "attn" : "ok", href: "/administracion/tesoreria" },
    { key: "customer", title: tx("Clientes", "Customers"), value: usdTxt(r2(exp.customer.ar + exp.customer.uninvoiced)), detail: tx(`Por cobrar ${usdTxt(exp.customer.ar)} (vencido ${usdTxt(exp.customer.overdue)}) + aceptado sin facturar ${usdTxt(exp.customer.uninvoiced)}`, `Receivable ${usdTxt(exp.customer.ar)} (overdue ${usdTxt(exp.customer.overdue)}) + accepted, not invoiced ${usdTxt(exp.customer.uninvoiced)}`), tone: exp.customer.overN ? "attn" : "ok", href: "/administracion/exposicion#clientes" },
    { key: "supplier", title: tx("Proveedores", "Suppliers"), value: usdTxt(exp.supplier.advanced), detail: tx(`Pagado sin recibir; órdenes abiertas por ${usdTxt(exp.supplier.open)} con ${exp.supplier.n} proveedor(es)`, `Paid, not received; open orders of ${usdTxt(exp.supplier.open)} with ${exp.supplier.n} supplier(s)`), tone: "ok", href: "/administracion/exposicion#proveedores" },
    { key: "inventory", title: tx("Inventario", "Stock"), value: `${exp.inventory.byState.reduce((n, x) => n + x.qty, 0)} u`, detail: tx(`Unidades en bodega; compras para inventario aprobadas ${usdTxt(exp.inventory.approvedUsd)}. SOLU no valora el inventario`, `Units in stock; approved stock purchases ${usdTxt(exp.inventory.approvedUsd)}. SOLU doesn't value stock`), tone: "ok", href: "/operaciones/inventario" },
    { key: "fx", title: tx("Otras monedas", "Other currencies"), value: fxTotal ? exp.fx.map((f) => f.currency).join(", ") : "—", detail: fxTotal ? tx(exp.fx.map((f) => `${f.currency}: en banco ${f.bank.toLocaleString("en-US")}, por pagar ${(f.toPay + f.obligations).toLocaleString("en-US")}`).join(" · "), exp.fx.map((f) => `${f.currency}: in bank ${f.bank.toLocaleString("en-US")}, to pay ${(f.toPay + f.obligations).toLocaleString("en-US")}`).join(" · ")) : tx("Nada en otra moneda", "Nothing in another currency"), tone: "ok", href: "/administracion/exposicion#monedas" },
    { key: "contractual", title: tx("Contratos", "Contracts"), value: `${exp.contractual.n}`, detail: tx(`Vigentes; por pagar al año ${usdTxt(exp.contractual.payYear)}; ${exp.contractual.decide} por decidir`, `In force; to pay per year ${usdTxt(exp.contractual.payYear)}; ${exp.contractual.decide} to decide`), tone: exp.contractual.decide ? "attn" : "ok", href: "/administracion/obligaciones" },
    { key: "people", title: tx("Capacidad de personas", "People capacity"), value: `${people.uncovered.length + people.overload.length + people.noBackup.length}`, detail: tx(`${people.uncovered.length} ausencia(s) sin cubrir · ${people.overload.length} persona(s) cubriendo de más · ${people.noBackup.length} relación(es) clave sin respaldo`, `${people.uncovered.length} absence(s) uncovered · ${people.overload.length} person(s) over-covering · ${people.noBackup.length} key relationship(s) with no backup`), tone: people.uncovered.length + people.overload.length + people.noBackup.length ? "attn" : "ok", href: "/gerencia/personas" },
  ];

  const watched: Watched = { outstanding: s.outstanding, overdue: s.overdue, available: exp.cash.available, overLimit: exp.customer.overUsd, supplierAdvanced: exp.supplier.advanced, openExceptions: s.openExc, quotedEsagara: fut.commercial.presented.esagara, contracted: fut.contracted.usd, needs: fut.commercial.needs };
  const changes = materialChanges((lastSnap?.data as { watched?: Watched } | null)?.watched ?? null, watched, pol.value.changePct);
  return { asOf: new Date(), period, prevPeriod: shiftPeriod(period, -1), business, future, exposure, needed, queue: queue.filter((q) => !needed.shown.some((n) => n.href === q.href)), watched, changes, since: lastSnap?.day ?? null, strategicLate: lateMoves, policy: pol };
}
const usdTxt = (n: number) => `USD ${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ---------- §16–18 · Executive Future Bridge, visible future Eságara, high-value focus ----------

export type BridgeStage = { key: BridgeKey; n: number; usd: number | null; esagara: number | null; basis: Txt; href: string };

export async function futureBridge() {
  const T = today();
  const [fpol, gpol] = await Promise.all([getFocusPolicy(), getGerenciaPolicy()]);
  const [views, hv, opportunities, accepted, invoices, openPos] = await Promise.all([
    focusViews(null, fpol.value), highValueCommitments(),
    db.futureOpportunity.count({ where: { status: "OPEN" } }),
    db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" } }, select: {
      id: true, code: true, title: true, account: { select: { id: true, name: true } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { protSale: true, protEsagra: true } },
      invoices: { select: { amount: true } },
      deliveries: { where: { invoice: null }, select: { lines: { select: { qty: true, dealItem: { select: { unitPrice: true } } } } } },
      supplierPos: { where: { releasedAt: { not: null } }, select: { id: true }, take: 1 }, dispatchOrders: { where: { cancelledAt: null }, select: { id: true }, take: 1 }, stockLots: { where: { state: "COMMITTED" }, select: { id: true }, take: 1 },
    } }),
    db.invoice.findMany({ select: { amount: true, esagraAtIssue: true, accountId: true, account: { select: { name: true } }, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
    db.supplierPO.findMany({ where: { releasedAt: { not: null }, receivedAt: null, currency: "USD" }, select: { amount: true, supplierId: true, supplier: { select: { name: true } } } }),
  ]);
  const items = views.items;
  const needs = items.filter((x) => !x.quoteStatus), drafts = items.filter((x) => x.quoteStatus === "DRAFT"), presented = items.filter((x) => x.quoteStatus === "PRESENTED");
  const sum = (xs: (number | null)[]) => sumMoney(xs.map((x) => x ?? 0));

  let contracted = 0, executing = 0, toInvoice = 0, eC = 0, eX = 0, eI = 0, nC = 0, nX = 0, nI = 0;
  const byCustomer = new Map<string, { name: string; value: number }>();
  for (const d of accepted) {
    const q = d.quotes[0];
    if (!q || q.protSale == null) continue;
    const sp = bridgeSplit({ sale: Number(q.protSale), esagara: Number(q.protEsagra ?? 0), invoiced: sumMoney(d.invoices.map((i) => i.amount)), deliveredNotInvoiced: sumMoney(d.deliveries.flatMap((x) => x.lines.map((l) => l.qty * Number(l.dealItem.unitPrice)))), started: d.supplierPos.length + d.dispatchOrders.length + d.stockLots.length > 0 });
    if (sp.contracted > 0.005) { contracted = r2(contracted + sp.contracted); eC = r2(eC + sp.esagara.contracted); nC++; }
    if (sp.executing > 0.005) { executing = r2(executing + sp.executing); eX = r2(eX + sp.esagara.executing); nX++; }
    if (sp.toInvoice > 0.005) { toInvoice = r2(toInvoice + sp.toInvoice); eI = r2(eI + sp.esagara.toInvoice); nI++; }
    const open = sp.esagara.contracted + sp.esagara.executing + sp.esagara.toInvoice;
    if (open > 0.005) { const g = byCustomer.get(d.account.id) ?? { name: d.account.name, value: 0 }; g.value = r2(g.value + open); byCustomer.set(d.account.id, g); }
  }
  let collect = 0, eCol = 0, nCol = 0;
  for (const i of invoices) {
    const c = invoiceCash(i); const bal = c.balance - c.pendingReconcile;
    if (bal <= 0.005) continue;
    collect = r2(collect + bal); nCol++;
    eCol = r2(eCol + (Number(i.amount) > 0 ? (Number(i.esagraAtIssue) * bal) / Number(i.amount) : 0));
  }
  const stages: BridgeStage[] = [
    { key: "OPPORTUNITY", n: opportunities, usd: null, esagara: null, basis: tx("Conteo. No se valoran.", "Count. Not valued."), href: "/mercado" },
    { key: "NEED", n: needs.length, usd: null, esagara: null, basis: tx("Conteo. Sin precio todavía.", "Count. No price yet."), href: "/comercial/foco" },
    { key: "QUOTE", n: drafts.length, usd: sum(drafts.map((x) => x.sale)), esagara: sum(drafts.map((x) => x.esagara)), basis: tx("Precio y costo del borrador; pueden cambiar.", "Draft price and cost; they may change."), href: "/cotizaciones" },
    { key: "DECISION", n: presented.length, usd: sum(presented.map((x) => x.sale)), esagara: sum(presented.map((x) => x.esagara)), basis: tx("Eságara protegida al presentar. El cliente no ha decidido.", "Eságara protected when presented. The customer hasn't decided."), href: "/cotizaciones" },
    { key: "CONTRACTED", n: nC, usd: contracted, esagara: eC, basis: tx("Orden aceptada, nada comprado ni despachado aún. Eságara protegida.", "Order accepted, nothing bought or dispatched yet. Protected Eságara."), href: "/operaciones/sin-despachar" },
    { key: "EXECUTION", n: nX, usd: executing, esagara: eX, basis: tx("Parte de la orden aún sin entregar, con compra o despacho en curso. Eságara protegida: la real depende de los costos.", "Part of the order not delivered yet, with a purchase or dispatch under way. Protected Eságara: the real one depends on costs."), href: "/operaciones/compromisos" },
    { key: "INVOICE", n: nI, usd: toInvoice, esagara: eI, basis: tx("Unidades entregadas × precio, sin factura. Eságara protegida en proporción.", "Units delivered × price, no invoice. Protected Eságara in proportion."), href: "/operaciones/por-facturar" },
    { key: "COLLECTION", n: nCol, usd: collect, esagara: eCol, basis: tx("Saldo de facturas después de pagos. Eságara de la factura en proporción al saldo.", "Invoice balances after payments. The invoice's Eságara in proportion to the balance."), href: "/administracion/cobrar" },
  ];

  // Concentration: how much of what is open depends on one customer, and of what is on order on one supplier.
  const bySupplier = new Map<string, { name: string; value: number }>();
  for (const p of openPos) { const g = bySupplier.get(p.supplierId) ?? { name: p.supplier.name, value: 0 }; g.value = r2(g.value + Number(p.amount)); bySupplier.set(p.supplierId, g); }
  const arBy = new Map<string, { name: string; value: number }>();
  for (const i of invoices) { const c = invoiceCash(i); const bal = c.balance - c.pendingReconcile; if (bal > 0.005) { const g = arBy.get(i.accountId) ?? { name: i.account.name, value: 0 }; g.value = r2(g.value + bal); arBy.set(i.accountId, g); } }
  const list = (m: Map<string, { name: string; value: number }>) => [...m.entries()].map(([key, g]) => ({ key, ...g }));
  const conc = {
    pct: gpol.value.concentrationPct,
    customerEsagara: concentration(list(byCustomer), gpol.value.concentrationPct),
    customerAr: concentration(list(arBy), gpol.value.concentrationPct),
    supplier: concentration(list(bySupplier), gpol.value.concentrationPct),
  };
  return { asOf: new Date(), stages, views, hv, conc, focus: fpol.value, now: T };
}
export type FutureBridge = Awaited<ReturnType<typeof futureBridge>>;
