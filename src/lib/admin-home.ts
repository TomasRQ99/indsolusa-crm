import { db } from "./db";
import { daysBetween, today } from "./domain";
import { sumMoney } from "./money";
import { matchState } from "./bank-csv";
import { loadCredit, loadReceivables, loadSupplierPayments } from "./queries";
import { profitSummary } from "./profit-summary";
import { assetDue, discountOf, obligationView, yearlyAmount } from "./admin-rules";
import { getAdminPolicy, loadBudgets, loadSupplierInvoices } from "./admin-store";
import { treasuryView } from "./treasury";
import { dirOf } from "./treasury-rules";

// Módulo 14 §4 · Administration Home and §5 · Resource Exposure. One read of the same records every other screen
// uses. The Home lists only what needs a person: each line carries its impact, the reason and where to act (AC17).
// Exposure is shown as seven separate figures and never merged into a score (AC13).

type Txt = { es: string; en: string };
export type HomeItem = { tone: "risk" | "attn"; what: Txt; impact: string | null; why: Txt; action: Txt; href: string };
export type HomeSection = { key: string; title: Txt; items: HomeItem[]; quiet: Txt; href: string };
const usd = (n: number) => `USD ${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tx = (es: string, en: string): Txt => ({ es, en });

async function facts(userId: string) {
  const T = today();
  const [tv, credit, receivables, payments, ap, budgets, ipOpen, assets, obligations, bankTx, unreconciled, profit, reviews, absences, gaps, pol, stock, stockApproved, openPos] = await Promise.all([
    treasuryView(), loadCredit(), loadReceivables(), loadSupplierPayments({ executedAt: null }), loadSupplierInvoices({ paidAt: null }), loadBudgets({ closedAt: null }),
    db.internalPurchase.findMany({ where: { status: "REQUESTED" }, select: { id: true, amountUsd: true, createdAt: true } }),
    db.asset.findMany({ where: { status: { not: "DISPOSED" } }, select: { id: true, code: true, name: true, status: true, value: true, currency: true, warrantyUntil: true, insuranceUntil: true, nextMaintenanceOn: true, custodianId: true } }),
    db.obligation.findMany({ where: { status: "ACTIVE" }, select: { id: true, kind: true, party: true, purpose: true, status: true, endsOn: true, renewal: true, noticeDays: true, decision: true, material: true, amount: true, currency: true, frequency: true, moneyDirection: true, nextDueOn: true } }),
    db.bankTransaction.findMany({ select: { amount: true, classifiedAs: true, matches: { select: { amount: true } } } }),
    db.customerPayment.findMany({ where: { kind: "CASH", reconciledAt: null }, select: { amount: true } }),
    profitSummary(userId),
    db.creditReviewRequest.count({ where: { status: "OPEN" } }),
    db.absenceRecord.count({ where: { status: "REQUESTED" } }),
    db.supportGap.count({ where: { status: "ESCALATED" } }),
    getAdminPolicy(),
    db.stockLot.groupBy({ by: ["state"], where: { outAt: null }, _sum: { qty: true } }),
    db.purchaseRequirement.aggregate({ where: { stockStatus: "APPROVED", cancelledAt: null }, _sum: { stockAmount: true } }),
    db.supplierPO.findMany({ where: { releasedAt: { not: null }, receivedAt: null }, select: { id: true, amount: true, currency: true, supplier: { select: { id: true, name: true } }, payments: { where: { executedAt: { not: null } }, select: { amountUsd: true, amount: true, currency: true } } } }),
  ]);
  return { T, tv, credit, receivables, payments, ap, budgets, ipOpen, assets, obligations, bankTx, unreconciled, profit, reviews, absences, gaps, pol: pol.value, stock, stockApproved, openPos };
}

export async function adminHome(userId: string): Promise<{ asOf: Date; sections: HomeSection[]; available: number; total: number }> {
  const f = await facts(userId);
  const { T, tv } = f;
  const S: HomeSection[] = [];

  // 1 · Cash
  const cash: HomeItem[] = [];
  if (tv.low.gap > 0) cash.push({ tone: "risk", what: tx("Faltante de caja en los próximos 90 días", "Cash gap in the next 90 days"), impact: usd(tv.low.gap), why: tx(`Lo que sale supera a lo que hay y lo que entra hacia el ${tv.low.lowOn?.toISOString().slice(0, 10) ?? "—"}`, `What goes out exceeds what there is and what comes in around ${tv.low.lowOn?.toISOString().slice(0, 10) ?? "—"}`), action: tx("Ver qué se puede mover", "See what can move"), href: "/administracion/tesoreria#proyeccion" });
  if (tv.bank.length === 0) cash.push({ tone: "attn", what: tx("No hay cuentas bancarias registradas", "No bank accounts recorded"), impact: null, why: tx("Sin saldos, SOLU no puede decir cuánta liquidez hay", "Without balances SOLU can't say how much liquidity there is"), action: tx("Crear la cuenta en Banco", "Create the account in Bank"), href: "/administracion/banco" });
  else if (tv.missingBalance + tv.staleBalance > 0) cash.push({ tone: "attn", what: tx(`${tv.missingBalance + tv.staleBalance} cuenta(s) sin saldo confirmado esta semana`, `${tv.missingBalance + tv.staleBalance} account(s) without a balance confirmed this week`), impact: null, why: tx("La liquidez y la proyección parten de un dato viejo o incompleto", "Liquidity and the projection start from an old or incomplete figure"), action: tx("Confirmar saldos", "Confirm balances"), href: "/administracion/tesoreria#cuentas" });
  if (tv.liq.available < 0 && tv.low.gap <= 0) cash.push({ tone: "risk", what: tx("Lo comprometido supera lo que hay en bancos", "What is committed exceeds what is in the banks"), impact: usd(tv.liq.available), why: tx("Bancos menos restringido, reservado y aprobado sin pagar", "Banks less restricted, reserved and approved unpaid"), action: tx("Abrir Tesorería", "Open Treasury"), href: "/administracion/tesoreria#liquidez" });
  S.push({ key: "cash", title: tx("CAJA", "CASH"), items: cash, quiet: tx(`Disponible ${usd(tv.liq.available)}, sin faltante a 90 días`, `Available ${usd(tv.liq.available)}, no gap within 90 days`), href: "/administracion/tesoreria" });

  // 2 · Credit & exposure
  const cr: HomeItem[] = [];
  const over = f.credit.filter((a) => a.limit != null && a.used > a.limit + 0.005);
  for (const a of over.sort((x, y) => (y.used - (y.limit ?? 0)) - (x.used - (x.limit ?? 0))).slice(0, 4)) cr.push({ tone: a.blocking.length ? "risk" : "attn", what: tx(`${a.name} usa más crédito que su cupo`, `${a.name} uses more credit than its limit`), impact: usd(a.used - (a.limit ?? 0)), why: tx(`Debe ${usd(a.openInvoices)} y tiene ${usd(a.uninvoiced)} aceptado sin facturar; cupo ${usd(a.limit ?? 0)}`, `Owes ${usd(a.openInvoices)} and has ${usd(a.uninvoiced)} accepted, not invoiced; limit ${usd(a.limit ?? 0)}`), action: a.blocking.length ? tx("Decidir: excepción, anticipo o cupo", "Decide: exception, advance or limit") : tx("Revisar el cupo", "Review the limit"), href: `/administracion/cupos#${a.id}` });
  if (f.reviews > 0) cr.push({ tone: "attn", what: tx(`${f.reviews} solicitud(es) de crédito esperan decisión`, `${f.reviews} credit request(s) await a decision`), impact: null, why: tx("Comercial pidió revisar un cupo o un plazo", "Commercial asked to review a limit or terms"), action: tx("Decidir", "Decide"), href: "/administracion/cupos#solicitudes" });
  S.push({ key: "credit", title: tx("CRÉDITO Y EXPOSICIÓN", "CREDIT AND EXPOSURE"), items: cr, quiet: tx("Ningún cliente por encima de su cupo", "No customer above its limit"), href: "/administracion/cupos" });

  // 3 · Collections
  const co: HomeItem[] = [];
  const broken = f.receivables.filter((r) => r.state === "BROKEN"), late = f.receivables.filter((r) => r.state === "NEEDS_ACTION");
  if (broken.length) co.push({ tone: "risk", what: tx(`${broken.length} promesa(s) de pago incumplida(s)`, `${broken.length} payment promise(s) missed`), impact: usd(sumMoney(broken.map((r) => r.cash.balance))), why: tx("Pasó la fecha prometida y no hay dinero conciliado", "The promised date passed and no cash is reconciled"), action: tx("Definir el siguiente paso de cobro", "Set the next collection step"), href: "/administracion/cobrar" });
  if (late.length) co.push({ tone: "attn", what: tx(`${late.length} factura(s) vencida(s) sin promesa ni próximo paso`, `${late.length} overdue invoice(s) with no promise or next step`), impact: usd(sumMoney(late.map((r) => r.cash.balance))), why: tx("Vencieron por contrato y nadie registró qué sigue", "They are past their contractual due date and nobody recorded what comes next"), action: tx("Registrar promesa o próximo paso", "Record a promise or next step"), href: "/administracion/cobrar" });
  S.push({ key: "collections", title: tx("COBROS", "COLLECTIONS"), items: co, quiet: tx("Cartera con promesa o al día", "Receivables promised or current"), href: "/administracion/cobrar" });

  // 4 · Payments
  const pa: HomeItem[] = [];
  const dueNow = tv.items.filter((x) => dirOf(x.bucket) === "OUT" && x.on && daysBetween(T, x.on) <= 0);
  if (dueNow.length) pa.push({ tone: "risk", what: tx(`${dueNow.length} pago(s) para hoy o vencidos`, `${dueNow.length} payment(s) due today or overdue`), impact: usd(sumMoney(dueNow.map((x) => x.amount))), why: tx("Llegó su fecha y no están pagados", "Their date arrived and they aren't paid"), action: tx("Abrir el calendario de pagos", "Open the payment calendar"), href: "/administracion/pagar#calendario" });
  const verify = f.payments.filter((p) => p.state === "VERIFY"), approve = f.payments.filter((p) => p.state === "APPROVE"), uncertain = f.payments.filter((p) => p.state === "UNCERTAIN");
  if (verify.length) pa.push({ tone: "risk", what: tx(`${verify.length} pago(s) con datos bancarios distintos del perfil verificado`, `${verify.length} payment(s) with bank data different from the verified profile`), impact: null, why: tx("Un cambio de cuenta bancaria es la forma más común de fraude", "A changed bank account is the most common form of fraud"), action: tx("Verificar por un canal independiente", "Verify through an independent channel"), href: "/administracion/pagos-proveedores" });
  if (approve.length) pa.push({ tone: "attn", what: tx(`${approve.length} pago(s) a proveedores esperan aprobación`, `${approve.length} supplier payment(s) await approval`), impact: usd(sumMoney(approve.map((p) => p.amountUsd ?? 0))), why: tx("Sin aprobar, Tesorería no puede enviarlos", "Without approval Treasury can't send them"), action: tx("Aprobar o devolver", "Approve or return"), href: "/administracion/pagos-proveedores" });
  const unmatched = f.ap.filter((r) => !r.match.payable && r.match.kind !== "NOT_RECEIVED");
  if (unmatched.length) pa.push({ tone: "attn", what: tx(`${unmatched.length} factura(s) de proveedor no cuadran con su orden o recibo`, `${unmatched.length} supplier invoice(s) don't agree with their order or receipt`), impact: usd(sumMoney(unmatched.map((r) => r.amountUsd ?? 0))), why: tx("Facturado de más, sin orden, o servicio sin aceptar", "Over-invoiced, no order, or service not accepted"), action: tx("Resolver o aceptar la diferencia", "Resolve or accept the difference"), href: "/administracion/pagar#facturas" });
  const disc = f.ap.map((r) => ({ r, d: discountOf(r, T) })).filter((x) => x.d?.open && x.d.daysLeft <= 7);
  if (disc.length) pa.push({ tone: "attn", what: tx(`${disc.length} descuento(s) por pago anticipado vencen esta semana`, `${disc.length} early-payment discount(s) expire this week`), impact: usd(sumMoney(disc.map((x) => x.d!.saving))), why: tx("Pagar antes de la fecha ahorra ese valor", "Paying before the date saves that amount"), action: tx("Ver los descuentos", "See the discounts"), href: "/administracion/pagar#descuentos" });
  S.push({ key: "payments", title: tx("PAGOS", "PAYMENTS"), items: pa, quiet: tx("Nada vencido ni esperando aprobación", "Nothing overdue or awaiting approval"), href: "/administracion/pagar" });

  // 5 · Budget & spend
  const bu: HomeItem[] = [];
  for (const b of f.budgets.filter((x) => x.view.over).slice(0, 3)) bu.push({ tone: "risk", what: tx(`Presupuesto «${b.name}» superado`, `Budget "${b.name}" exceeded`), impact: usd(-b.view.available), why: tx(`Comprometido ${usd(b.view.committed)} + gastado ${usd(b.view.spent)} de ${usd(b.view.amount)}`, `Committed ${usd(b.view.committed)} + spent ${usd(b.view.spent)} of ${usd(b.view.amount)}`), action: tx("Revisar con su responsable", "Review with its owner"), href: `/administracion/presupuesto#b-${b.id}` });
  for (const b of f.budgets.filter((x) => !x.view.over && x.view.forecastGap != null && x.view.forecastGap < -0.005).slice(0, 2)) bu.push({ tone: "attn", what: tx(`«${b.name}»: el responsable espera pasarse`, `"${b.name}": the owner expects to go over`), impact: usd(-(b.view.forecastGap ?? 0)), why: tx("Su pronóstico al final del periodo supera lo asignado", "Their forecast for the end of the period exceeds what is assigned"), action: tx("Decidir si se ajusta", "Decide whether to adjust"), href: `/administracion/presupuesto#b-${b.id}` });
  if (f.ipOpen.length) bu.push({ tone: "attn", what: tx(`${f.ipOpen.length} compra(s) interna(s) esperan decisión`, `${f.ipOpen.length} internal purchase(s) await a decision`), impact: usd(sumMoney(f.ipOpen.map((p) => p.amountUsd))), why: tx("Alguien las pidió y nadie las ha aprobado ni devuelto", "Someone requested them and nobody has approved or returned them"), action: tx("Decidir", "Decide"), href: "/administracion/compras-internas#decidir" });
  S.push({ key: "budget", title: tx("PRESUPUESTO Y GASTO", "BUDGET AND SPEND"), items: bu, quiet: f.budgets.length ? tx("Todos los presupuestos dentro de lo asignado", "Every budget within what is assigned") : tx("Aún no hay presupuestos asignados", "No budgets assigned yet"), href: "/administracion/presupuesto" });

  // 6 · Assets & obligations
  const ao: HomeItem[] = [];
  const obl = f.obligations.map((o) => ({ o, v: obligationView({ ...o, amount: o.amount == null ? null : Number(o.amount) }, T, f.pol) })).filter((x) => x.v.alert);
  for (const { o, v } of obl.slice(0, 4)) ao.push({ tone: v.state === "DECIDE" ? "attn" : "risk", what: tx(`${o.party}: ${o.purpose}`, `${o.party}: ${o.purpose}`), impact: v.yearly != null ? `${o.currency} ${v.yearly.toLocaleString("en-US", { minimumFractionDigits: 2 })} / año` : null, why: v.state === "DECIDE" ? tx(`Hay que avisar antes del ${v.noticeBy?.toISOString().slice(0, 10)} (${v.daysToNotice} días)`, `Notice is due before ${v.noticeBy?.toISOString().slice(0, 10)} (${v.daysToNotice} days)`) : v.state === "EXPIRED" ? tx("Venció y sigue como vigente", "It expired and is still marked in force") : tx("Pasó la fecha de aviso sin decisión", "The notice date passed with no decision"), action: tx("Decidir: renovar o terminar", "Decide: renew or end"), href: `/administracion/obligaciones#o-${o.id}` });
  const due = f.assets.flatMap((a) => assetDue(a, T, f.pol.obligationLeadDays).filter((d) => d.key !== "NO_CUSTODIAN" && d.key !== "WARRANTY").map((d) => ({ a, d })));
  if (due.length) ao.push({ tone: due.some((x) => x.d.late) ? "risk" : "attn", what: tx(`${due.length} activo(s) con seguro o mantenimiento por vencer`, `${due.length} asset(s) with insurance or maintenance coming due`), impact: null, why: tx("Un activo sin seguro o sin mantenimiento es un riesgo que hoy se puede evitar", "An uninsured or unmaintained asset is a risk that can be avoided today"), action: tx("Ver cuáles", "See which"), href: "/administracion/activos#atencion" });
  const noOne = f.assets.filter((a) => !a.custodianId && a.status !== "REQUESTED").length;
  if (noOne) ao.push({ tone: "attn", what: tx(`${noOne} activo(s) sin nadie a cargo`, `${noOne} asset(s) with nobody responsible`), impact: null, why: tx("Sin custodio nadie responde por su estado", "Without a custodian nobody answers for its condition"), action: tx("Asignarlos", "Assign them"), href: "/administracion/activos" });
  S.push({ key: "assets", title: tx("ACTIVOS Y OBLIGACIONES", "ASSETS AND OBLIGATIONS"), items: ao, quiet: tx("Nada que decidir ni por vencer", "Nothing to decide or coming due"), href: "/administracion/obligaciones" });

  // 7 · Unreconciled money
  const un: HomeItem[] = [];
  const open = f.bankTx.map((x) => matchState(Number(x.amount), sumMoney(x.matches.map((m) => m.amount)), x.classifiedAs)).filter((m) => m.state === "UNMATCHED" || m.state === "PARTIAL");
  if (open.length) un.push({ tone: "attn", what: tx(`${open.length} movimiento(s) del banco sin explicar`, `${open.length} bank movement(s) not explained`), impact: usd(sumMoney(open.map((m) => m.open))), why: tx("Entró o salió dinero que SOLU no sabe a qué corresponde", "Money came in or went out and SOLU doesn't know what it is"), action: tx("Cruzarlos o clasificarlos", "Match or classify them"), href: "/administracion/banco" });
  if (f.unreconciled.length) un.push({ tone: "attn", what: tx(`${f.unreconciled.length} pago(s) de clientes sin conciliar`, `${f.unreconciled.length} customer payment(s) not reconciled`), impact: usd(sumMoney(f.unreconciled.map((p) => p.amount))), why: tx("Registrados como recibidos pero nadie confirmó que están en el banco", "Recorded as received but nobody confirmed they are in the bank"), action: tx("Conciliar", "Reconcile"), href: "/administracion/pagos-recibidos" });
  if (uncertain.length) un.push({ tone: "risk", what: tx(`${uncertain.length} pago(s) a proveedor en estado incierto`, `${uncertain.length} supplier payment(s) in an uncertain state`), impact: usd(sumMoney(uncertain.map((p) => p.amountUsd ?? 0))), why: tx("Se envió al banco y no se sabe si salió: pagar de nuevo sería duplicar", "It was sent to the bank and nobody knows if it left: paying again would duplicate it"), action: tx("Confirmar con el banco", "Confirm with the bank"), href: "/administracion/pagos-proveedores" });
  S.push({ key: "unreconciled", title: tx("DINERO SIN CONCILIAR", "UNRECONCILED MONEY"), items: un, quiet: tx("Todo movimiento está explicado", "Every movement is explained"), href: "/administracion/banco" });

  // 8 · Economics & commission settlement
  const ec: HomeItem[] = [];
  const P = f.profit;
  if (P.readyToClose.length) ec.push({ tone: "attn", what: tx(`${P.readyToClose.length} Journey(s) listos para cierre económico`, `${P.readyToClose.length} Journey(s) ready for economic close`), impact: usd(sumMoney(P.readyToClose.map((x) => x.esagara))), why: tx("Tienen todo para fijar su Eságara final", "They have everything to fix their final Eságara"), action: tx("Cerrar", "Close"), href: "/administracion/cierre" });
  const toApprove = P.commission.saleReady.usd + P.commission.collectionReady.usd;
  if (toApprove > 0.005) ec.push({ tone: "attn", what: tx("Comisiones listas para aprobar", "Commissions ready to approve"), impact: usd(toApprove), why: tx("Se facturó o se recaudó: la política ya las hace exigibles", "Invoiced or collected: the policy already makes them payable"), action: tx("Abrir la liquidación", "Open the settlement"), href: "/gerencia/liquidacion" });
  if (P.runsUnpaid.length) ec.push({ tone: "attn", what: tx(`${P.runsUnpaid.length} liquidación(es) aprobada(s) sin pagar`, `${P.runsUnpaid.length} settlement(s) approved, not paid`), impact: usd(sumMoney(P.runsUnpaid.map((r) => r.total))), why: tx("Aprobadas por Gerencia y aún no pagadas a las personas", "Approved by Management and not yet paid to people"), action: tx("Registrar el pago", "Record the payment"), href: "/gerencia/liquidacion#corridas" });
  S.push({ key: "economics", title: tx("ESÁGARA Y LIQUIDACIÓN DE COMISIONES", "ESÁGARA AND COMMISSION SETTLEMENT"), items: ec, quiet: tx("Nada listo para cerrar o aprobar", "Nothing ready to close or approve"), href: "/administracion/cierre" });

  // People (v1.1–1.2): only when something waits.
  const pe: HomeItem[] = [];
  if (f.absences) pe.push({ tone: "attn", what: tx(`${f.absences} ausencia(s) por decidir`, `${f.absences} absence(s) to decide`), impact: null, why: tx("Alguien pidió días y espera respuesta", "Someone asked for days off and awaits an answer"), action: tx("Decidir", "Decide"), href: "/administracion/personas#decidir" });
  if (f.gaps) pe.push({ tone: "risk", what: tx(`${f.gaps} falta(s) de soporte escalada(s)`, `${f.gaps} support gap(s) escalated`), impact: null, why: tx("A alguien le falta una herramienta, acceso o equipo para hacer su rol y no se resolvió", "Someone lacks a tool, access or equipment to do their role and it wasn't resolved"), action: tx("Ver y resolver", "See and resolve"), href: "/administracion/personas#soporte" });
  if (pe.length) S.push({ key: "people", title: tx("PERSONAS", "PEOPLE"), items: pe, quiet: tx("", ""), href: "/administracion/personas" });

  return { asOf: tv.asOf, sections: S, available: tv.liq.available, total: S.reduce((n, s) => n + s.items.length, 0) };
}

export async function resourceExposure(userId: string) {
  const f = await facts(userId);
  const { T, tv } = f;
  const usdOnly = <X extends { currency: string }>(xs: X[]) => xs.filter((x) => x.currency === "USD");
  // Customer
  const ar = sumMoney(f.credit.map((a) => a.openInvoices)), uninvoiced = sumMoney(f.credit.map((a) => a.uninvoiced));
  const overdue = sumMoney(f.receivables.filter((r) => r.dueAt < T).map((r) => r.cash.balance));
  const over = f.credit.filter((a) => a.limit != null && a.used > a.limit + 0.005);
  const topCustomers = [...f.credit].sort((a, b) => b.used - a.used).slice(0, 5).filter((a) => a.used > 0.005).map((a) => ({ id: a.id, name: a.name, used: Math.round(a.used * 100) / 100, limit: a.limit }));
  // Supplier: money already paid for goods not yet received, and orders placed and not yet received.
  const bySupplier = new Map<string, { name: string; advanced: number; open: number }>();
  for (const p of usdOnly(f.openPos)) {
    const g = bySupplier.get(p.supplier.id) ?? { name: p.supplier.name, advanced: 0, open: 0 };
    g.open = Math.round((g.open + Number(p.amount)) * 100) / 100;
    g.advanced = Math.round((g.advanced + sumMoney(p.payments.map((x) => x.amountUsd ?? (x.currency === "USD" ? x.amount : 0)))) * 100) / 100;
    bySupplier.set(p.supplier.id, g);
  }
  const suppliers = [...bySupplier.entries()].map(([id, g]) => ({ id, ...g })).sort((a, b) => b.advanced - a.advanced || b.open - a.open);
  // FX: everything held or owed in a currency other than USD, by currency, never converted.
  const fx = new Map<string, { bank: number; toPay: number; obligations: number }>();
  const bump = (c: string, k: "bank" | "toPay" | "obligations", v: number) => { const g = fx.get(c) ?? { bank: 0, toPay: 0, obligations: 0 }; g[k] = Math.round((g[k] + v) * 100) / 100; fx.set(c, g); };
  for (const b of tv.bank) if (b.currency !== "USD" && b.balance) bump(b.currency, "bank", b.balance.amount);
  for (const p of f.payments) if (p.currency !== "USD") bump(p.currency, "toPay", Number(p.amount));
  for (const r of f.ap) if (r.currency !== "USD") bump(r.currency, "toPay", Number(r.amount));
  for (const p of f.openPos) if (p.currency !== "USD") bump(p.currency, "toPay", Number(p.amount));
  for (const o of f.obligations) if (o.currency !== "USD" && o.amount != null && o.moneyDirection === "PAY") bump(o.currency, "obligations", yearlyAmount({ amount: Number(o.amount), frequency: o.frequency }) ?? 0);
  // Assets
  const assetsUsd = usdOnly(f.assets);
  const uninsured = f.assets.filter((a) => !a.insuranceUntil || a.insuranceUntil < T);
  // Contractual
  const act = f.obligations.map((o) => ({ o, v: obligationView({ ...o, amount: o.amount == null ? null : Number(o.amount) }, T, f.pol) }));
  const yearly = (dir: string) => sumMoney(act.filter((x) => x.o.moneyDirection === dir && x.o.currency === "USD").map((x) => x.v.yearly ?? 0));
  return {
    asOf: tv.asOf,
    cash: { ...tv.liq, gap: tv.low.gap, lowOn: tv.low.lowOn, missing: tv.missingBalance, stale: tv.staleBalance, accounts: tv.bank.length },
    customer: { ar, uninvoiced, overdue, overN: over.length, overUsd: sumMoney(over.map((a) => a.used - (a.limit ?? 0))), top: topCustomers },
    supplier: { advanced: sumMoney(suppliers.map((s) => s.advanced)), open: sumMoney(suppliers.map((s) => s.open)), top: suppliers.slice(0, 5), n: suppliers.length },
    inventory: { byState: f.stock.map((s) => ({ state: s.state, qty: s._sum.qty ?? 0 })), approvedUsd: Number(f.stockApproved._sum.stockAmount ?? 0) },
    fx: [...fx.entries()].map(([currency, g]) => ({ currency, ...g })),
    asset: { n: f.assets.length, valueUsd: sumMoney(assetsUsd.map((a) => a.value ?? 0)), noValue: f.assets.filter((a) => a.value == null).length, uninsuredN: uninsured.length, uninsuredUsd: sumMoney(usdOnly(uninsured).map((a) => a.value ?? 0)), unassigned: f.assets.filter((a) => !a.custodianId).length },
    contractual: { n: act.length, payYear: yearly("PAY"), collectYear: yearly("COLLECT"), decide: act.filter((x) => x.v.needsAction).length, guarantees: act.filter((x) => x.o.kind === "GUARANTEE" || x.o.kind === "INSURANCE").length },
  };
}
