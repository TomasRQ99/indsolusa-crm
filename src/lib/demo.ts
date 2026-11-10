import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { refreshUnderstanding } from "./comm-store";
import { refreshPaymentBehaviorSafe } from "./pay-behavior";
import { addDays, nextCode, nextDocNumber, today } from "./domain";
import { subMoney } from "./money";
import { loadCredit } from "./queries";
import { VALUE_SEED } from "./proposal-rules";

// Sample data so every SOLU screen can be seen working. Every record is marked
// "(ejemplo)" and can be removed in one step without touching real data.

const DEMO_DOMAIN = "@ejemplo.solu";
const TAG = " (ejemplo)";

export async function demoLoaded() {
  return (await db.account.count({ where: { isDemo: true } })) > 0;
}

export async function ensureDefaultPolicy() {
  if ((await db.commissionPolicy.count()) > 0) return;
  await db.commissionPolicy.create({
    data: {
      version: 1,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      tiers: [{ min: 0, rate: 0 }, { min: 12, rate: 8 }, { min: 18, rate: 10 }],
      newClientBonus: 2,
      salePercent: 50,
      lossDays: 90,
      approvedBy: "Gerencia (valores de ejemplo, pendiente D-06)",
      notes: "50 % a la venta (factura emitida) y 50 % al recaudo (pago conciliado).",
    },
  });
}

export async function loadDemo(adminId: string) {
  if (await demoLoaded()) return topUpMarketDemo();
  await ensureDefaultPolicy();
  const T = today();
  const d = (n: number) => addDays(T, n);
  const unusable = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  await db.$transaction(
    async (tx) => {
      const paola = await tx.user.upsert({
        where: { email: `paola${DEMO_DOMAIN}` },
        update: {},
        create: { email: `paola${DEMO_DOMAIN}`, name: `Paola Gómez${TAG}`, role: "NEGOCIADOR_COMERCIAL", passwordHash: unusable },
      });
      const diana = await tx.user.upsert({
        where: { email: `diana${DEMO_DOMAIN}` },
        update: {},
        create: { email: `diana${DEMO_DOMAIN}`, name: `Diana Ruiz${TAG}`, role: "DIRECTOR_COMERCIAL", passwordHash: unusable },
      });

      const account = (name: string, extra: Partial<Prisma.AccountUncheckedCreateInput> = {}) =>
        tx.account.create({
          // Long-standing customers by default; only those with a recent createdAt count as new.
          data: { name: name + TAG, ownerId: paola.id, isDemo: true, taxDataComplete: true, industry: "Industria", createdAt: d(-700), ...extra },
        });

      const lacteos = await account("Lácteos del Valle", { industry: "Alimentos y bebidas", creditLimit: 30000, address: "Planta Tuluá, Valle" });
      const sider = await account("Siderúrgica del Norte", { industry: "Metalurgia", creditLimit: 40000, requiresReceptionCode: true, billingContact: "cuentasporpagar@siderurgica.example", taxId: "900.412.118-3" });
      const cementos = await account("Cementos Andinos", { industry: "Cemento y construcción", creditLimit: 50000, requiresPortal: true, portalValidUntil: d(-4), billingContact: "facturas@cementos.example", allowsPartialBilling: false });
      const minera = await account("Minera El Roble", { industry: "Minería", creditLimit: 17000 });
      const ingenio = await account("Ingenio San Rafael", { industry: "Azúcar y etanol", creditLimit: 40000 });
      const pacifico = await account("Alimentos del Pacífico", { industry: "Alimentos y bebidas", taxDataComplete: false, createdAt: d(-20) });
      const quimica = await account("Química Andina", { industry: "Química", ownerId: adminId });
      const papeles = await account("Papeles del Sur", { industry: "Papel y pulpa", ownerId: adminId });

      await tx.contact.createMany({
        data: [
          { firstName: "Sandra", lastName: "Gómez", title: "Tesorería", email: "sandra.gomez@siderurgica.example", accountId: sider.id },
          { firstName: "Andrés", lastName: "Mejía", title: "Tesorería", email: "a.mejia@cementos.example", accountId: cementos.id },
          { firstName: "Jorge", lastName: "Pérez", title: "Mantenimiento", email: "jorge.perez@lacteos.example", accountId: lacteos.id },
          { firstName: "Laura", lastName: "Ríos", title: "Compras", email: "laura.rios@minera.example", accountId: minera.id },
        ],
      });

      const supplier = (name: string, extra: Partial<Prisma.SupplierUncheckedCreateInput>) =>
        tx.supplier.create({ data: { name: name + TAG, isDemo: true, ...extra } });
      const siemens = await supplier("Distribuidor Siemens Miami", { paymentTerms: "100 % contra pago antes de despacho", advancePct: 100, transitDays: 4, country: "Estados Unidos", currency: "USD", phone: "+1 305 000 0000", bankBeneficiary: "Siemens Dist. LLC", bankName: "Bank of America", bankAccount: "000123456789", bankSwift: "BOFAUS3N", bankVerifiedAt: d(-200), bankVerifiedById: diana.id });
      const rodamientos = await supplier("Rodamientos Bogotá", { paymentTerms: "100 % antes de despacho", advancePct: 100, transitDays: 1, country: "Colombia", currency: "USD", phone: "+57 601 000 0000", bankBeneficiary: "Rodamientos Bogotá SAS", bankName: "Bancolombia", bankAccount: "1234-5678-90", bankSwift: "COLOCOBM", bankVerifiedAt: d(-120), bankVerifiedById: diana.id });
      const iberica = await supplier("Bombas Ibérica", { paymentTerms: "50 % anticipo / 50 % contra despacho", advancePct: 50, transitDays: 12, country: "España", currency: "EUR", phone: "+34 900 000 000" });
      const general = await supplier("Distribuidor Industrial A", { paymentTerms: "100 % antes de despacho", advancePct: 100, transitDays: 5, country: "Estados Unidos", currency: "USD", phone: "+1 786 000 0000", bankBeneficiary: "Industrial A Inc", bankName: "Chase", bankAccount: "987654321", bankSwift: "CHASUS33", bankVerifiedAt: d(-300), bankVerifiedById: diana.id });

      type DealIn = Partial<Prisma.DealUncheckedCreateInput> & { title: string; amount: number; accountId: string };
      const deal = async (data: DealIn) => {
        const code = await nextCode("J", "deal", tx);
        return tx.deal.create({ data: { ownerId: paola.id, ...data, code } });
      };
      const invoice = async (dealId: string, accountId: string, amount: number, esagraAtIssue: number, issuedAt: Date, terms = 30, deliveryId?: string) => {
        const number = await nextDocNumber(tx);
        return tx.invoice.create({ data: { number, dealId, accountId, amount, esagraAtIssue, issuedAt, dueAt: addDays(issuedAt, terms), issuedById: paola.id, deliveryId } });
      };
      const delivery = async (dealId: string, deliveredAt: Date, lines: { dealItemId: string; qty: number; serials?: string }[], extra: Partial<Prisma.DeliveryUncheckedCreateInput> = {}) => {
        const code = await nextCode("REM", "delivery", tx);
        return tx.delivery.create({ data: { code, dealId, deliveredAt, deliveredBy: "Transportes Rápidos", receivedByName: "Almacén", podReceived: true, ...extra, lines: { create: lines } } });
      };
      // Supplier PO released (v1) with its lines and payment milestones (Payment Requirements).
      type Ln = { qty: number; code: string; description: string; unitCost: number };
      type Ms = { label: string; percent: number; amount: number; trigger: string; dueBy: Date | null };
      const spo = async (dealId: string, supplierId: string, amount: number, currency: string, extra: Partial<Prisma.SupplierPOUncheckedCreateInput> = {}, lines: Ln[] = [], reqs: Ms[] = []) => {
        const code = await nextCode("SPO", "supplierPO", tx);
        const releasedAt = extra.confirmedAt ? addDays(extra.confirmedAt as Date, -1) : d(-1);
        return tx.supplierPO.create({
          data: {
            code, dealId, supplierId, amount, currency, releasedAt, releasedByName: paola.name, ...extra,
            lines: { create: lines.map((l, n) => ({ ...l, position: n })) },
            requirements: { create: reqs.map((r, n) => ({ ...r, position: n })) },
          },
          include: { requirements: { orderBy: { position: "asc" } } },
        });
      };
      // A payment counts as paid only with a CONFIRMED execution (bank or supplier evidence).
      const confirmed = (paymentId: string, amount: number, sentAt: Date, bankRef: string) =>
        tx.paymentExecution.create({ data: { paymentId, amount, sentAt, bankRef, state: "CONFIRMED", recordedById: diana.id, recordedByName: diana.name, resolvedAt: sentAt, resolvedByName: diana.name, evidence: "Confirmación del banco (ejemplo)" } });

      // 1. Lácteos del Valle: pumps invoiced, payment received but not reconciled.
      const lac1 = await deal({ title: "Bombas centrífugas línea de pasteurización", amount: 6240, supplierCost: 4600, freightCost: 230, otherCosts: 100, accountId: lacteos.id, stage: "WON", customerPo: "4500-1877", poAcceptedAt: d(-40), desiredResult: "Pasteurizadora operando sin paradas", promiseText: "Bombas instaladas antes del cierre de mes", promisedDate: d(-28), waitingFor: "Que Tesorería concilie el pago", waitingUntil: d(2) });
      const lacItem = await tx.dealItem.create({ data: { dealId: lac1.id, qty: 2, code: "CPX-50", description: "Bomba centrífuga sanitaria 5 HP", unitPrice: 3120 } });
      const lacSpo = await spo(lac1.id, general.id, 4600, "USD", { confirmedAt: d(-38), shippedAt: d(-35), receivedAt: d(-31), terms: "100 % antes de despacho", shipBy: d(-35), proformaRef: "Cotización Distribuidor Industrial A" },
        [{ qty: 2, code: "CPX-50", description: "Bomba centrífuga sanitaria 5 HP", unitCost: 2300 }],
        [{ label: "Pago total antes de despacho", percent: 100, amount: 4600, trigger: "El proveedor despacha contra pago", dueBy: d(-36) }]);
      const lacPay = await tx.supplierPayment.create({ data: { supplierPoId: lacSpo.id, requirementId: lacSpo.requirements[0].id, amount: 4600, currency: "USD", amountUsd: 4600, reason: "El distribuidor despacha contra pago", dueBy: d(-36), docBeneficiary: "Industrial A Inc", docBankName: "Chase", docAccount: "987654321", docSwift: "CHASUS33", docSource: "Cotización Distribuidor Industrial A", requestedById: paola.id, approvedById: adminId, approvedAt: d(-37), executedById: diana.id, executedAt: d(-36), executedRef: "Wire 54210", createdAt: d(-38) } });
      await confirmed(lacPay.id, 4600, d(-36), "Wire 54210");
      const lacDel = await delivery(lac1.id, d(-28), [{ dealItemId: lacItem.id, qty: 2, serials: "CPX50-8812, CPX50-8813" }]);
      const lacInv = await invoice(lac1.id, lacteos.id, 6240, 1310, d(-27), 30, lacDel.id);
      // Overpayment: the transfer is USD 60 more than the invoice and Lácteos has no other open invoice.
      await tx.customerPayment.create({ data: { accountId: lacteos.id, amount: 6300, receivedAt: d(-1), reference: "TRF 88231", createdById: adminId, applications: { create: [{ invoiceId: lacInv.id, amount: 6240 }] } } });
      await tx.invoice.update({ where: { id: lacInv.id }, data: { syncState: "CONFIRMED", externalSystem: "QuickBooks", externalId: "QB-10482", syncAt: d(-27) } });

      // 2. Lácteos: transmitters, 4 of 6 delivered and ready to invoice; 2 in transit.
      const lac2 = await deal({ title: "Transmisores de presión Siemens", amount: 3600, supplierCost: 2600, freightCost: 200, otherCosts: 98, accountId: lacteos.id, stage: "WON", customerPo: "4500-1902", poAcceptedAt: d(-20), promiseText: "6 transmisores antes del 15", promisedDate: d(9) });
      const txItem = await tx.dealItem.create({ data: { dealId: lac2.id, qty: 6, code: "7MF0340", description: "Transmisor de presión Sitrans P", unitPrice: 600 } });
      // Partial / milestone payment: Siemens ships in two lots and is paid per lot. Lot 1 paid (confirmed);
      // lot 2 requested, bank profile verified, no duplicates: ready for approval ("Payment ready").
      const lac2Spo = await spo(lac2.id, siemens.id, 2598, "USD", { confirmedAt: d(-18), shippedAt: d(-2), eta: d(6), terms: "Pago por lote, antes de cada despacho", shipBy: d(1), proformaRef: "Proforma SIE-4498" },
        [{ qty: 6, code: "7MF0340", description: "Transmisor de presión Sitrans P", unitCost: 433 }],
        [
          { label: "Lote 1 · 4 transmisores", percent: 67, amount: 1732, trigger: "Antes del despacho del lote 1", dueBy: d(-4) },
          { label: "Lote 2 · 2 transmisores", percent: 33, amount: 866, trigger: "Antes del despacho del lote 2", dueBy: d(1) },
        ]);
      const lot1 = await tx.supplierPayment.create({ data: { supplierPoId: lac2Spo.id, requirementId: lac2Spo.requirements[0].id, amount: 1732, currency: "USD", amountUsd: 1732, reason: "Siemens despacha el lote 1 (4 transmisores) contra pago", dueBy: d(-4), docBeneficiary: "Siemens Dist. LLC", docBankName: "Bank of America", docAccount: "000123456789", docSwift: "BOFAUS3N", docSource: "Proforma SIE-4498 · lote 1", requestedById: paola.id, approvedById: adminId, approvedAt: d(-5), executedById: diana.id, executedAt: d(-4), executedRef: "Wire 55302", createdAt: d(-6) } });
      await confirmed(lot1.id, 1732, d(-4), "Wire 55302");
      await tx.supplierPayment.create({ data: { supplierPoId: lac2Spo.id, requirementId: lac2Spo.requirements[1].id, amount: 866, currency: "USD", amountUsd: 866, reason: "Siemens despacha el lote 2 (2 transmisores) contra pago; sin ellos no se cumple \"6 transmisores antes del 15\"", dueBy: d(1), docBeneficiary: "Siemens Dist. LLC", docBankName: "Bank of America", docAccount: "000123456789", docSwift: "BOFAUS3N", docSource: "Proforma SIE-4498 · lote 2", requestedById: paola.id } });
      await delivery(lac2.id, d(-1), [{ dealItemId: txItem.id, qty: 4, serials: "SP-1101…1104" }]);

      // 3. Siderúrgica: freight arrived after invoicing (esagra 19 % → 16 %); promise for Friday.
      const sid1 = await deal({ title: "Reductor para laminador", amount: 9800, supplierCost: 7640, freightCost: 290, otherCosts: 300, accountId: sider.id, stage: "WON", customerPo: "SN-77120", poAcceptedAt: d(-70), resultAchievedAt: d(-30) });
      const sidItem = await tx.dealItem.create({ data: { dealId: sid1.id, qty: 1, code: "RD-450", description: "Reductor helicoidal 450 kW", unitPrice: 9800 } });
      const sidDel = await delivery(sid1.id, d(-52), [{ dealItemId: sidItem.id, qty: 1 }], { receptionCode: "EM-55102" });
      const sidInv = await invoice(sid1.id, sider.id, 9800, 1860, d(-50), 30, sidDel.id);
      // Accounting integration uncertain: sent to QuickBooks, connection error, no ID came back.
      await tx.invoice.update({ where: { id: sidInv.id }, data: { syncState: "UNCERTAIN", externalSystem: "QuickBooks", syncAt: d(-50), syncNote: "Error de conexión al enviar; QuickBooks no devolvió ID." } });
      await tx.paymentPromise.create({ data: { invoiceId: sidInv.id, promisedFor: d(2), promisedBy: "Sandra Gómez (Tesorería)", source: "Llamada: \"queda programado para el viernes\"", recordedById: paola.id } });

      // 4. Siderúrgica: rollers delivered, invoice blocked by the goods-receipt code.
      const sid2 = await deal({ title: "Rodillos de transporte", amount: 5600, supplierCost: 4300, freightCost: 150, accountId: sider.id, stage: "WON", customerPo: "SN-77311", poAcceptedAt: d(-25), waitingFor: "Código de recepción de mercancía (Sandra)", waitingUntil: d(1) });
      const rodItem = await tx.dealItem.create({ data: { dealId: sid2.id, qty: 8, code: "RT-120", description: "Rodillo de transporte 120 mm", unitPrice: 700 } });
      // Billing Readiness: receiving code already requested (still missing) and no signed POD.
      const sidDel2 = await delivery(sid2.id, d(-6), [{ dealItemId: rodItem.id, qty: 8 }], { podReceived: false, receivedByName: null });
      await tx.billingRequest.create({ data: { dealId: sid2.id, deliveryId: sidDel2.id, kind: "RECEPTION_CODE", sentTo: "sandra.gomez@siderurgica.example", note: "Por correo, con copia a almacén", requestedAt: d(-2), requestedById: paola.id } });

      // 5. Cementos: broken payment promise; portal registration expired.
      const cem1 = await deal({ title: "Motorreductor molino de crudo", amount: 12380, supplierCost: 9500, freightCost: 400, otherCosts: 252, accountId: cementos.id, stage: "WON", customerPo: "CA-OC-2609-031", poAcceptedAt: d(-60) });
      const cemInv = await invoice(cem1.id, cementos.id, 12380, 2228, d(-45));
      await tx.paymentPromise.create({ data: { invoiceId: cemInv.id, promisedFor: d(-2), promisedBy: "A. Mejía (Tesorería)", source: "Correo: \"el pago sale el lunes\"", recordedById: paola.id } });
      await tx.invoice.update({ where: { id: cemInv.id }, data: { syncState: "CONFIRMED", externalSystem: "QuickBooks", externalId: "QB-10377", syncAt: d(-45) } });
      // Cash arrives unallocated: a transfer with no reference. It is NOT "invoice paid" until allocated and reconciled.
      await tx.customerPayment.create({ data: { accountId: cementos.id, amount: 12380, receivedAt: d(-1), reference: null, createdById: adminId } });

      // 6. Cementos: urgent bearing; supplier payment blocked by a bank change by email.
      const cem2 = await deal({ title: "Rodamiento 23148 molino", amount: 17900, supplierCost: 14200, freightCost: 600, accountId: cementos.id, stage: "WON", customerPo: "CA-OC-2611-058", poAcceptedAt: d(-3), desiredResult: "Molino andando antes del sábado", promiseText: "Molino andando antes del sábado", promisedDate: d(3) });
      await tx.dealItem.create({ data: { dealId: cem2.id, qty: 1, code: "23148 CC/W33", description: "Rodamiento de rodillos a rótula", unitPrice: 17900 } });
      const cemSpo = await spo(cem2.id, rodamientos.id, 17600, "USD", { confirmedAt: d(-2), terms: "100 % antes de despacho", shipBy: d(1), proformaRef: "Cotización RB-1187" },
        [{ qty: 1, code: "23148 CC/W33", description: "Rodamiento de rodillos a rótula", unitCost: 17600 }],
        [{ label: "Pago total antes de despacho", percent: 100, amount: 17600, trigger: "El proveedor despacha contra pago", dueBy: d(0) }]);
      await tx.supplierPayment.create({ data: { supplierPoId: cemSpo.id, requirementId: cemSpo.requirements[0].id, amount: 17600, currency: "USD", amountUsd: 17600, reason: "El proveedor despacha al confirmar el pago; el molino debe arrancar el sábado", dueBy: d(1), docBeneficiary: "Rodamientos Bogotá SAS", docBankName: "Banco de Bogotá", docAccount: "9988-7766-55", docSwift: "BBOGCOBB", docSource: "Correo del 4 nov: \"cambiamos de cuenta\"", requestedById: paola.id } });

      // 7. Minera: overdue invoice without promise; new order exceeds the credit limit.
      const min1 = await deal({ title: "Repuestos bomba de lodos", amount: 8400, supplierCost: 6800, freightCost: 200, accountId: minera.id, stage: "WON", customerPo: "MER-OC-9810", poAcceptedAt: d(-55) });
      await invoice(min1.id, minera.id, 8400, 1400, d(-40));
      const min2 = await deal({ title: "Kit de bomba de lodos", amount: 11200, supplierCost: 8900, freightCost: 300, accountId: minera.id, stage: "WON", customerPo: "MER-OC-9921", poAcceptedAt: d(-1), promiseText: "Entrega lunes 16", promisedDate: d(12) });
      await tx.dealItem.create({ data: { dealId: min2.id, qty: 1, code: "KBL-6", description: "Kit de bomba de lodos 6\"", unitPrice: 11200 } });

      // 8. Minera: an older Journey fully collected; commission halves approved and paid.
      const min0 = await deal({ title: "Válvulas de cuchillo", amount: 7400, supplierCost: 5600, freightCost: 220, otherCosts: 100, accountId: minera.id, stage: "WON", customerPo: "MER-OC-9604", poAcceptedAt: d(-110), resultAchievedAt: d(-70) });
      const minInv0 = await invoice(min0.id, minera.id, 7400, 1480, d(-95));
      await tx.customerPayment.create({ data: { accountId: minera.id, amount: 7400, receivedAt: d(-66), reference: "TRF 71002", createdById: adminId, reconciledAt: d(-65), reconciledById: diana.id, applications: { create: [{ invoiceId: minInv0.id, amount: 7400 }] } } });
      await tx.commissionEntry.createMany({
        data: [
          { invoiceId: minInv0.id, half: "SALE", userId: paola.id, amount: 74, calculation: "v1 · 1480.00 × 10 % × 50 %", approvedById: diana.id, approvedAt: d(-80), paidAt: d(-75), payrollRef: "Nómina (ejemplo)" },
          { invoiceId: minInv0.id, half: "COLLECTION", userId: paola.id, amount: 74, calculation: "v1 · 1480.00 × 10 % − 74.00", approvedById: diana.id, approvedAt: d(-60), paidAt: d(-50), payrollRef: "Nómina (ejemplo)" },
        ],
      });

      // 9. Ingenio: foreign payment in EUR, verified by Diana, waiting for management approval.
      const ing = await deal({ title: "Impulsor bomba de jugo", amount: 11850, supplierCost: 9100, freightCost: 450, otherCosts: 180, accountId: ingenio.id, stage: "WON", customerPo: "ISR-4410-77", poAcceptedAt: d(-5), desiredResult: "Bomba instalada antes de la zafra", promiseText: "Instalado antes de la zafra", promisedDate: d(19) });
      await tx.dealItem.create({ data: { dealId: ing.id, qty: 1, code: "IMP-JG-320", description: "Impulsor bomba de jugo 320 mm", unitPrice: 11850 } });
      // Uncertain external execution: the 50 % advance was sent, the bank says "in process" and Ibérica
      // hasn't confirmed receipt. It doesn't count as paid and isn't retried until reconciled.
      const ingSpo = await spo(ing.id, iberica.id, 8420, "EUR", { confirmedAt: d(-4), terms: "50 % anticipo / 50 % contra despacho", shipBy: d(3), proformaRef: "Proforma PF-2611-118" },
        [{ qty: 1, code: "IMP-JG-320", description: "Impulsor bomba de jugo 320 mm", unitCost: 8420 }],
        [
          { label: "Anticipo 50 %", percent: 50, amount: 4210, trigger: "Al liberar la Supplier PO · la fabricación arranca con el pago", dueBy: d(-2) },
          { label: "Saldo 50 %", percent: 50, amount: 4210, trigger: "Contra aviso de despacho", dueBy: d(3) },
        ]);
      const ingPay = await tx.supplierPayment.create({ data: { supplierPoId: ingSpo.id, requirementId: ingSpo.requirements[0].id, amount: 4210, currency: "EUR", amountUsd: 4550, reason: "Fabricación arranca con el anticipo; la zafra empieza el 23", dueBy: d(-2), docBeneficiary: "Bombas Ibérica S.L.", docBankName: "CaixaBank", docAccount: "ES12 2100 0000 0000 0000", docSwift: "CAIXESBB", docSource: "Proforma PF-2611-118", requestedById: paola.id, verifiedById: diana.id, verifiedAt: d(-4), verificationNote: "Llamada al teléfono registrado: confirmó beneficiario, banco e IBAN.", approvedById: adminId, approvedAt: d(-3), dupCheckedByName: "Administrador", createdAt: d(-4) } });
      await tx.paymentExecution.create({ data: { paymentId: ingPay.id, amount: 4210, sentAt: d(-2), bankRef: "MT103 88-4471", state: "UNCERTAIN", note: "Banco: \"en proceso\". Ibérica no confirma recepción y no arranca la fabricación.", recordedById: diana.id, recordedByName: diana.name } });
      await tx.supplier.update({ where: { id: iberica.id }, data: { bankBeneficiary: "Bombas Ibérica S.L.", bankName: "CaixaBank", bankAccount: "ES12 2100 0000 0000 0000", bankSwift: "CAIXESBB", bankVerifiedAt: d(-4), bankVerifiedById: diana.id } });

      // 10. Alimentos del Pacífico (new customer): delivered, invoice blocked by tax data.
      const pac = await deal({ title: "Sellos mecánicos envasadora", amount: 1870, supplierCost: 1300, freightCost: 140, accountId: pacifico.id, stage: "WON", customerPo: "ADP-0012", poAcceptedAt: d(-12) });
      const pacItem = await tx.dealItem.create({ data: { dealId: pac.id, qty: 4, code: "SM-35", description: "Sello mecánico 35 mm", unitPrice: 467.5 } });
      await delivery(pac.id, d(-3), [{ dealItemId: pacItem.id, qty: 4 }]);

      // 10b. Química Andina: short payment. The customer withheld 2 % and paid USD 96 less; the balance stays open.
      const qkit = await deal({ title: "Kit de mantenimiento bombas dosificadoras", amount: 4800, supplierCost: 3500, freightCost: 120, accountId: quimica.id, ownerId: adminId, stage: "WON", customerPo: "QA-OC-1102", poAcceptedAt: d(-50), resultAchievedAt: d(-30) });
      const qkitItem = await tx.dealItem.create({ data: { dealId: qkit.id, qty: 4, code: "KM-BD", description: "Kit de mantenimiento bomba dosificadora", unitPrice: 1200 } });
      const qkitDel = await delivery(qkit.id, d(-40), [{ dealItemId: qkitItem.id, qty: 4 }], { receivedByName: "Carlos Duarte" });
      const qkitInv = await invoice(qkit.id, quimica.id, 4800, 1180, d(-38), 30, qkitDel.id);
      await tx.invoice.update({ where: { id: qkitInv.id }, data: { syncState: "CONFIRMED", externalSystem: "QuickBooks", externalId: "QB-10455", syncAt: d(-38) } });
      await tx.customerPayment.create({ data: { accountId: quimica.id, amount: 4704, receivedAt: d(-7), reference: "QA PAGO 5521", createdById: adminId, reconciledAt: d(-6), reconciledById: diana.id, applications: { create: [{ invoiceId: qkitInv.id, amount: 4704 }] } } });

      // 10c. Result & Closure variants. Delivery never counts as the result: each state rests on evidence.
      const ds = (n: number) => d(n).toISOString().slice(0, 10);
      const ev = (dealId: string, kind: string, stance: string, text: string, who: string, at: Date, source?: string) =>
        tx.resultEvidence.create({ data: { dealId, kind, stance, text, who, at, source, recordedByName: paola.name } });
      // Achieved: the customer's own words are the basis.
      await ev(sid1.id, "VISIT", "SUPPORTS", "Arranque supervisado del reductor; vibración 2,1 mm/s, dentro de lo normal", "Paola Gómez (visita)", d(-48), "Visita a planta");
      await ev(sid1.id, "CUSTOMER", "SUPPORTS", "Ya instalamos el reductor y quedó funcionando; el laminador lleva un mes sin paradas", "Ing. Ramiro Torres (Mantenimiento)", d(-30), "WhatsApp");
      await tx.deal.update({ where: { id: sid1.id }, data: { resultState: "ACHIEVED", actualResult: "Laminador operando con el reductor nuevo, sin paradas desde la instalación", reliefNote: "Dejaron de perder unas 6 horas por semana en paradas del laminador", resultConfirmedAt: d(-30), resultConfirmedByName: paola.name, desiredResult: "Laminador sin paradas por falla del reductor" } });
      // Partial: production restored, redundancy pending → Recovery open with an option chosen.
      const sidCw = await deal({ title: "Bombas de agua de enfriamiento horno (principal + respaldo)", amount: 5800, supplierCost: 4300, freightCost: 180, accountId: sider.id, stage: "WON", customerPo: "SN-77502", poAcceptedAt: d(-20), desiredResult: "Horno enfriado con bomba principal y respaldo (redundancia N+1)", successMeasure: "Respaldo arranca solo si falla la principal", promiseText: "Bombas en planta Barranquilla", originalPromisedDate: d(-14), promisedDate: d(-9), promiseRevisions: 1, promiseRevisedAt: d(-16), promiseChangeCause: "SUPPLIER" });
      const sidCwItem = await tx.dealItem.create({ data: { dealId: sidCw.id, qty: 2, code: "CW-80", description: "Bomba de agua de enfriamiento 80 m³/h", unitPrice: 2900 } });
      const sidCwDel = await delivery(sidCw.id, d(-9), [{ dealItemId: sidCwItem.id, qty: 2 }], { receptionCode: "EM-55870", receivedByName: "Almacén · J. Ruiz" });
      await invoice(sidCw.id, sider.id, 5800, 1050, d(-8), 30, sidCwDel.id);
      await ev(sidCw.id, "CUSTOMER", "PARTIAL", "La principal ya quedó andando y el horno volvió a producir, pero la de respaldo no la pudimos montar: no trae el acople", "Ing. Ramiro Torres (Mantenimiento)", d(-6), "Llamada");
      await tx.deal.update({ where: { id: sidCw.id }, data: { resultState: "PARTIAL", actualResult: "Horno enfriando con la bomba principal: producción restaurada", resultPendingNote: "Bomba de respaldo sin instalar (falta el acople flexible): no hay redundancia N+1", reliefNote: "El horno volvió a producir después de 2 días parado", resultConfirmedAt: d(-6), resultConfirmedByName: paola.name, nextMove: "Recovery: enviar el acople por courier", nextMoveDate: d(2) } });
      await tx.recovery.create({ data: { dealId: sidCw.id, openedAt: d(-6), openedByName: paola.name, whatChanged: "La bomba de respaldo llegó sin el acople flexible", impact: "El horno opera sin redundancia: si falla la principal, para la producción", options: [
        { key: "o1", title: "Enviar el acople original por courier", detail: "El proveedor lo despacha hoy; llega en 2 días hábiles", eta: ds(-1) },
        { key: "o2", title: "Mecanizar un acople localmente", detail: "Taller en Barranquilla; más rápido pero sin garantía del fabricante", eta: ds(1) },
        { key: "o3", title: "Prestar una bomba de respaldo mientras llega", detail: "De nuestro inventario de demostración", eta: ds(0) },
      ], selectedKey: "o1", selectedAt: d(-5), selectedByName: paola.name, selectedNote: "Ramiro prefiere la pieza original", expectedBy: d(-1), cause: "SUPPLIER" } });
      // Not achieved: incompatible product → Recovery open, no option chosen yet.
      const ing2 = await deal({ title: "Motor ventilador secador de bagazo", amount: 6900, supplierCost: 5200, freightCost: 210, accountId: ingenio.id, stage: "WON", customerPo: "ISR-4415-02", poAcceptedAt: d(-18), desiredResult: "Secador de bagazo funcionando a plena carga antes de la zafra", promiseText: "Motor en planta el 1 de noviembre", promisedDate: d(-4) });
      const ing2Item = await tx.dealItem.create({ data: { dealId: ing2.id, qty: 1, code: "M-40HP", description: "Motor eléctrico 40 HP 4 polos", unitPrice: 6900 } });
      await delivery(ing2.id, d(-4), [{ dealItemId: ing2Item.id, qty: 1 }], { receivedByName: "Almacén Ingenio" });
      await ev(ing2.id, "TECHNICAL", "CONTRADICTS", "El motor llegó con brida IEC B5; la base del ventilador es NEMA 286T. No se puede montar.", "Técnico de montaje (Ingenio)", d(-3), "Visita de montaje");
      await tx.deal.update({ where: { id: ing2.id }, data: { resultState: "NOT_ACHIEVED", actualResult: "El motor llegó pero no se puede montar: el secador sigue parado", resultConfirmedAt: d(-3), resultConfirmedByName: paola.name } });
      await tx.recovery.create({ data: { dealId: ing2.id, openedAt: d(-3), openedByName: paola.name, whatChanged: "El motor es IEC B5 y la base del cliente es NEMA 286T (producto incompatible)", cause: "SPEC",impact: "El secador de bagazo sigue parado; la zafra empieza el 23 y sin secador no hay combustible para calderas", options: [
        { key: "o1", title: "Reemplazar por motor NEMA 286T", detail: "El proveedor tiene stock en Miami; 7 días a planta", eta: ds(9) },
        { key: "o2", title: "Fabricar placa adaptadora IEC→NEMA", detail: "Taller local; el cliente debe aprobar el montaje", eta: ds(3) },
        { key: "o3", title: "Devolver y emitir nota crédito", detail: "Asumimos el error de especificación", eta: null },
      ] } });
      // No longer relevant: the customer decommissioned the line.
      const pap1 = await deal({ title: "Repuesto bomba línea 1 de pulpa", amount: 3200, supplierCost: 2400, accountId: papeles.id, ownerId: adminId, stage: "WON", customerPo: "PDS-OC-3290", poAcceptedAt: d(-15), desiredResult: "Línea 1 de pulpa con bomba de respaldo" });
      await tx.dealItem.create({ data: { dealId: pap1.id, qty: 1, code: "IMP-P1", description: "Impulsor bomba de pulpa", unitPrice: 3200 } });
      await ev(pap1.id, "CUSTOMER", "NEUTRAL", "Gerencia decidió desmontar la línea 1; ya no necesitamos el repuesto. Cancelen la OC.", "Marta León (Compras)", d(-2), "Correo");
      await tx.deal.update({ where: { id: pap1.id }, data: { resultState: "NO_LONGER_RELEVANT", actualResult: "Ya no aplica: la línea 1 se desmonta y la OC se cancela", resultConfirmedAt: d(-2), resultConfirmedByName: "Administrador" } });
      // Recovery successful: seals leaked, replaced, the customer confirmed.
      const lac4 = await deal({ title: "Sellos mecánicos bomba CIP", amount: 2600, supplierCost: 1800, freightCost: 90, accountId: lacteos.id, stage: "WON", customerPo: "4500-1850", poAcceptedAt: d(-35), desiredResult: "Bomba de CIP sin fugas", successMeasure: "0 goteo en 2 semanas" });
      const lac4Item = await tx.dealItem.create({ data: { dealId: lac4.id, qty: 4, code: "SM-CIP-40", description: "Sello mecánico 40 mm", unitPrice: 650 } });
      const lac4Del = await delivery(lac4.id, d(-25), [{ dealItemId: lac4Item.id, qty: 4 }], { receivedByName: "Jorge Pérez" });
      const lac4Inv = await invoice(lac4.id, lacteos.id, 2600, 610, d(-24), 30, lac4Del.id);
      await tx.customerPayment.create({ data: { accountId: lacteos.id, amount: 2600, receivedAt: d(-3), reference: "TRF 88104", createdById: adminId, reconciledAt: d(-2), reconciledById: diana.id, applications: { create: [{ invoiceId: lac4Inv.id, amount: 2600 }] } } });
      await ev(lac4.id, "CUSTOMER", "CONTRADICTS", "Los sellos empezaron a gotear a los 3 días: la soda cáustica del CIP los atacó", "Jorge Pérez (Mantenimiento)", d(-21), "WhatsApp");
      await tx.recovery.create({ data: { dealId: lac4.id, openedAt: d(-21), openedByName: paola.name, whatChanged: "El elastómero EPDM no resiste la soda caliente del CIP", cause: "SPEC",impact: "La bomba de CIP gotea; riesgo sanitario en la limpieza de la línea", options: [
        { key: "o1", title: "Cambiar a sellos en FKM (Viton) sin costo", detail: "Resisten soda caliente; el proveedor los tiene en Bogotá", eta: ds(-12) },
        { key: "o2", title: "Bajar la temperatura del CIP", detail: "Requiere aprobación de calidad del cliente", eta: null },
        { key: "o3", title: "Devolver y emitir nota crédito", detail: "", eta: null },
      ], selectedKey: "o1", selectedAt: d(-20), selectedByName: paola.name, expectedBy: d(-12), resolvedAt: d(-10), outcome: "RECOVERED", outcomeNote: "Sellos FKM instalados el 26 de oct, sin costo para el cliente" } });
      await ev(lac4.id, "CUSTOMER", "SUPPORTS", "Con los sellos en Viton la bomba lleva 10 días sin una gota", "Jorge Pérez (Mantenimiento)", d(-10), "WhatsApp");
      await tx.continuitySignal.create({ data: { dealId: lac4.id, kind: "TRIGGER", what: "Sellos FKM para la bomba CIP 2 en la parada de enero", basis: "Jorge dijo que la bomba CIP 2 tiene los mismos sellos EPDM y la cambian en la parada de enero", triggerOn: d(60), createdByName: paola.name, createdAt: d(-10) } });
      await tx.deal.update({ where: { id: lac4.id }, data: { resultState: "ACHIEVED", actualResult: "Bomba de CIP sin fugas con sellos FKM", reliefNote: "La limpieza CIP volvió a su ciclo normal sin goteo", resultConfirmedAt: d(-10), resultConfirmedByName: paola.name, resultAchievedAt: d(-10) } });
      // Closed: achieved, collected, with one legitimate continuity trigger.
      await ev(min0.id, "CUSTOMER", "SUPPORTS", "Las válvulas cierran bien; ya no tenemos fugas de lodo en la descarga", "Laura Ríos (Compras)", d(-70), "Llamada");
      await tx.continuitySignal.create({ data: { dealId: min0.id, kind: "TRIGGER", what: "Cambiar las válvulas del espesador 2 en la parada anual", basis: "Laura dijo que en la parada de diciembre cambian las del espesador 2, mismo modelo", triggerOn: d(30), createdByName: paola.name, createdAt: d(-60) } });
      await tx.deal.update({ where: { id: min0.id }, data: { resultState: "ACHIEVED", desiredResult: "Descarga de lodos sin fugas", actualResult: "Válvulas cerrando sin fugas en la descarga", reliefNote: "Dejaron de limpiar derrames cada turno", resultConfirmedAt: d(-70), resultConfirmedByName: paola.name, closedAt: d(-60), closedByName: paola.name, closureSummary: "Minera buscaba descarga de lodos sin fugas. Entregamos las válvulas, el cliente confirmó que cierran bien y todo quedó cobrado.", closureLearning: "Confirmar el material del asiento con el análisis del lodo antes de cotizar." } });

      // 10d. History for the 360 views: older Journeys closed with results, real purchases (RTS + price
      // history) and observed product facts. Rich: Siemens / 7MF0340 / Lácteos. Stale: RT-120 price (14 months).
      // Each history Journey also carries its promise (original / revised / actual) and the economics
      // protected when its quote was presented, so Gerencia/Insights has real months to compare.
      type Hist = {
        accountId: string; supplierId: string; title: string; code: string; desc: string; qty: number; price: number; cost: number; start: number; shipDelta: number; payDelay: number; evidence: string; who: string; desired: string;
        ownerId?: string; protCost?: number; freight?: number; protFreight?: number;
        revise?: { to: number; at: number; cause: string };
        result?: "PARTIAL" | "NOT_ACHIEVED"; rec?: { cause: string; what: string; impact: string; outcome?: "RECOVERED" | "NOT_RECOVERED" };
      };
      const hist = async (h: Hist) => {
        const s = h.start;
        const delAt = s + 15 + h.shipDelta;
        const resAt = Math.min(-1, delAt + 25);
        const closeAt = resAt + 10 <= -1 ? resAt + 10 : null;
        const sale = h.qty * h.price, cost = h.qty * h.cost, freight = h.freight ?? 0;
        const state = h.result ?? "ACHIEVED";
        const dl = await deal({
          title: h.title, amount: sale, supplierCost: cost, freightCost: freight, accountId: h.accountId, ownerId: h.ownerId ?? paola.id, stage: "WON", customerPo: `HIST-${-s}`, poAcceptedAt: d(s), createdAt: d(s), desiredResult: h.desired,
          promiseText: `Entrega de la PO HIST-${-s}`, originalPromisedDate: d(s + 15), promisedDate: d(h.revise ? h.revise.to : s + 15),
          ...(h.revise ? { promiseRevisions: 1, promiseRevisedAt: d(h.revise.at), promiseChangeCause: h.revise.cause } : {}),
          resultState: state, actualResult: h.evidence, resultAchievedAt: state === "ACHIEVED" ? d(resAt) : null, resultConfirmedAt: d(resAt), resultConfirmedByName: paola.name,
          ...(closeAt != null ? { closedAt: d(closeAt), closedByName: paola.name, closureSummary: `${h.desired}: ${state === "ACHIEVED" ? "entregado y confirmado por el cliente" : "resultado no logrado por completo"}.`, closureLearning: h.rec ? "Confirmar la aplicación con el cliente antes de cotizar." : "Compra repetible; mismo proveedor y referencia.", closureNoSignalReason: "Sin necesidad nueva declarada" } : {}),
        });
        const pc = h.qty * (h.protCost ?? h.cost) + (h.protFreight ?? freight);
        await tx.quote.create({ data: { dealId: dl.id, number: await nextDocNumber(tx), rev: 0, status: "ACCEPTED", createdById: adminId, createdAt: d(s - 6), issuedAt: d(s - 6), presentedAt: d(s - 6), decidedAt: d(s), supplierCost: h.qty * (h.protCost ?? h.cost), freightCost: h.protFreight ?? freight, protSale: sale, protCost: pc, protEsagra: sale - pc, protPolicy: 1, leadMinDays: 12, leadMaxDays: 15 } });
        const it = await tx.dealItem.create({ data: { dealId: dl.id, qty: h.qty, code: h.code, description: h.desc, unitPrice: h.price } });
        await spo(dl.id, h.supplierId, cost, "USD", { confirmedAt: d(s + 2), shipBy: d(s + 7), shippedAt: d(s + 7 + h.shipDelta), receivedAt: d(s + 12 + h.shipDelta), terms: "100 % antes de despacho", createdAt: d(s + 1) }, [{ qty: h.qty, code: h.code, description: h.desc, unitCost: h.cost }]);
        const del = await delivery(dl.id, d(delAt), [{ dealItemId: it.id, qty: h.qty }], { receptionCode: "EM-H" + -s });
        const inv = await invoice(dl.id, h.accountId, sale, Math.round(sale - cost - freight), d(delAt + 1), 30, del.id);
        await tx.invoice.update({ where: { id: inv.id }, data: { syncState: "CONFIRMED", externalSystem: "QuickBooks", externalId: `QB-H${-s}`, syncAt: d(delAt + 1) } });
        const paidAt = delAt + 31 + h.payDelay;
        if (paidAt <= -1) await tx.customerPayment.create({ data: { accountId: h.accountId, amount: sale, receivedAt: d(paidAt), reference: `TRF H${-s}`, createdById: adminId, reconciledAt: d(Math.min(-1, paidAt + 1)), reconciledById: diana.id, applications: { create: [{ invoiceId: inv.id, amount: sale }] } } });
        if (h.rec) {
          await tx.recovery.create({ data: { dealId: dl.id, openedAt: d(delAt + 3), openedByName: paola.name, whatChanged: h.rec.what, impact: h.rec.impact, cause: h.rec.cause, options: [{ key: "o1", title: "Reponer con la referencia correcta", detail: "", eta: null }, { key: "o2", title: "Nota crédito", detail: "", eta: null }], selectedKey: h.rec.outcome === "RECOVERED" ? "o1" : "o2", selectedAt: d(delAt + 4), selectedByName: paola.name, resolvedAt: d(Math.min(-1, delAt + 12)), outcome: h.rec.outcome ?? "NOT_RECOVERED", outcomeNote: h.rec.outcome === "RECOVERED" ? "Repuesto instalado; el cliente confirmó" : "Nota crédito emitida; el cliente buscó otra solución" } });
        }
        await ev(dl.id, "CUSTOMER", state === "ACHIEVED" ? "SUPPORTS" : state === "PARTIAL" ? "PARTIAL" : "CONTRADICTS", h.evidence, h.who, d(resAt), "Llamada");
      };
      const tx7 = { code: "7MF0340", desc: "Transmisor de presión Sitrans P", price: 600 };
      await hist({ ...tx7, accountId: sider.id, supplierId: siemens.id, title: "Transmisores de presión horno 1", qty: 3, cost: 395, start: -460, shipDelta: 2, payDelay: 14, desired: "Presión del horno 1 medida en continuo", evidence: "Los transmisores quedaron leyendo bien; ya no medimos a mano", who: "Ing. Ramiro Torres (Mantenimiento)" });
      await hist({ ...tx7, accountId: lacteos.id, supplierId: siemens.id, title: "Transmisores de presión pasteurizador", qty: 2, cost: 410, start: -210, shipDelta: 0, payDelay: 2, desired: "Control de presión del pasteurizador sin lecturas falsas", evidence: "El pasteurizador ya no se dispara por lecturas falsas", who: "Jorge Pérez (Mantenimiento)" });
      await hist({ ...tx7, accountId: lacteos.id, supplierId: siemens.id, title: "Transmisores de presión línea CIP", qty: 2, cost: 425, start: -125, shipDelta: 5, payDelay: 4, revise: { to: -105, at: -115, cause: "SUPPLIER" }, desired: "Presión de la línea CIP visible en el SCADA", evidence: "Ya vemos la presión del CIP en el SCADA", who: "Jorge Pérez (Mantenimiento)" });
      await hist({ accountId: sider.id, supplierId: rodamientos.id, title: "Rodillos de transporte (lote anterior)", code: "RT-120", desc: "Rodillo de transporte 120 mm", qty: 8, price: 640, cost: 480, start: -420, shipDelta: 1, payDelay: 10, desired: "Banda de transporte sin rodillos trabados", evidence: "La banda corre sin trabarse desde el cambio", who: "Ing. Ramiro Torres (Mantenimiento)" });
      // Recent months for Gerencia/Insights: kept, revised in time, missed without warning, esagra lost, not achieved.
      await hist({ accountId: cementos.id, supplierId: general.id, title: "Correas trapezoidales molino crudo", code: "CT-B88", desc: "Correa trapezoidal B88", qty: 12, price: 95, cost: 61, start: -50, shipDelta: 0, payDelay: 0, desired: "Molino crudo sin patinamiento de correas", evidence: "El molino ya no patina; cambiamos las 12 correas en la parada", who: "Andrés Mejía (Tesorería)" });
      await hist({ accountId: minera.id, supplierId: general.id, title: "Bomba dosificadora de floculante", code: "BD-FL20", desc: "Bomba dosificadora 20 L/h", qty: 2, price: 1980, cost: 1450, protCost: 1300, start: -48, shipDelta: 6, payDelay: 3, revise: { to: -27, at: -36, cause: "SUPPLIER" }, desired: "Dosificación de floculante estable en el espesador", evidence: "La dosificación quedó estable; el agua sale clara", who: "Laura Ríos (Compras)" });
      await hist({ accountId: quimica.id, supplierId: general.id, ownerId: adminId, title: "Válvula de alivio reactor 2", code: "VA-R2-150", desc: "Válvula de alivio 1½\" 150 psi", qty: 1, price: 2850, cost: 1900, freight: 420, protFreight: 150, start: -45, shipDelta: 4, payDelay: 0, desired: "Reactor 2 con alivio de presión certificado", evidence: "La válvula quedó instalada y calibrada; pasamos la inspección", who: "Carlos Mora (Mantenimiento)" });
      await hist({ accountId: papeles.id, supplierId: general.id, ownerId: adminId, title: "Sensor de nivel tanque de pulpa", code: "LR-80", desc: "Sensor de nivel radar 80 GHz", qty: 1, price: 2400, cost: 1650, start: -49, shipDelta: 0, payDelay: 2, result: "NOT_ACHIEVED", rec: { cause: "SPEC", what: "El sensor radar no lee bien con la espuma del tanque de pulpa", impact: "El tanque sigue controlándose a mano" }, desired: "Nivel del tanque de pulpa medido sin intervención", evidence: "Con la espuma el radar marca lecturas falsas; volvimos al control manual", who: "Marta León (Compras)" });
      await hist({ accountId: ingenio.id, supplierId: rodamientos.id, title: "Rodamientos molino 3", code: "RB-22320", desc: "Rodamiento de rodillos 22320", qty: 4, price: 820, cost: 590, start: -85, shipDelta: 1, payDelay: 6, desired: "Molino 3 sin calentamiento en chumaceras", evidence: "Las chumaceras del molino 3 trabajan a 55 °C, normal", who: "Técnico de montaje (Ingenio)" });
      await hist({ accountId: minera.id, supplierId: general.id, title: "Válvulas de cuchilla espesador 1", code: "VK-8", desc: "Válvula de cuchilla 8\"", qty: 4, price: 1350, cost: 980, start: -80, shipDelta: 2, payDelay: 5, result: "PARTIAL", rec: { cause: "SUPPLIER", what: "Llegaron 3 de 4 válvulas; la cuarta quedó en backorder del fabricante", impact: "Una línea del espesador sigue con la válvula vieja" }, desired: "Espesador 1 con las 4 válvulas nuevas", evidence: "Tres válvulas funcionan bien; la cuarta línea sigue con la vieja", who: "Laura Ríos (Compras)" });
      await tx.productSignal.createMany({ data: [
        { kind: "REENTRY", screen: "Journey · Facturación", note: "Volví a escribir el código de recepción de Siderúrgica que ya estaba en la remisión", reportedByName: paola.name, createdAt: d(-12) },
        { kind: "REENTRY", screen: "Operaciones · Compras", note: "Copié a mano las líneas de la cotización en la OC al proveedor", reportedByName: paola.name, createdAt: d(-30) },
        { kind: "ATTENTION_NOISE", screen: "Mi Día", note: "Marcó la ETA de Siemens como riesgo y seguía dentro de la promesa", reportedByName: diana.name, createdAt: d(-8) },
      ] });
      const pf = (code: string, kind: string, text: string, source: string, at: Date) => tx.productFact.create({ data: { code, kind, text, source, observedAt: at, recordedByName: paola.name } });
      await pf("7MF0340", "SPEC", "0–16 bar · salida 4–20 mA HART · conexión ½\" NPT", "Hoja técnica Siemens", d(-460));
      await pf("7MF0340", "ALIAS", "Sitrans P DS III", "Proforma SIE-4498", d(-18));
      await pf("7MF0340", "ALIAS", "Transmisor 7MF0340-1EC00", "OC del cliente 4500-1902", d(-20));
      await pf("7MF0340", "PACKING", "Caja individual 22×18×12 cm, 1,4 kg; 4 por caja master", "Recibo en bodega, lote 1", d(-2));
      await pf("7MF0340", "COMPAT_OK", "Montaje en manifold de 3 válvulas ½\" NPT (Lácteos, línea CIP)", "Jorge Pérez, visita", d(-90));
      await pf("M-40HP", "COMPAT_NO", "Brida IEC B5 no monta en base NEMA 286T (ventilador secador Ingenio)", "Técnico de montaje, Ingenio", d(-3));

      // 11. Pipeline owned by the admin, so Mi Día and Mi Plan show real movements.
      const carlos = await tx.contact.create({ data: { firstName: "Carlos", lastName: "Duarte", title: "Jefe de Mantenimiento", email: "carlos.duarte@quimica.example", accountId: quimica.id } });
      const marta = await tx.contact.create({ data: { firstName: "Marta", lastName: "León", title: "Compras", email: "marta.leon@papeles.example", accountId: papeles.id } });
      const ago = (days: number, hour: number) => new Date(d(-days).getTime() + (hour + 5) * 3600e3);
      const q1 = await deal({ title: "Variador para extrusora", amount: 24000, supplierCost: 18100, freightCost: 650, otherCosts: 250, accountId: quimica.id, contactId: carlos.id, ownerId: adminId, stage: "PROPOSAL", nextMove: "Enviar cotización revisada con plazo de 10 días", nextMoveDate: T, desiredResult: "Extrusora a velocidad nominal", offerValidUntil: d(8), closeDate: d(12) });
      await tx.activity.create({ data: { type: "EMAIL", subject: "Carlos pidió entrega en 10 días", body: "El variador actual falla cada semana; si la entrega pasa de 10 días evaluarán otro proveedor.", occurredAt: ago(1, 16), userId: adminId, accountId: quimica.id, contactId: carlos.id, dealId: q1.id } });
      const rep = await deal({ title: "Repotenciación línea 2", amount: 50000, accountId: quimica.id, contactId: carlos.id, ownerId: adminId, stage: "NEGOTIATION", waitingFor: "Que aprueben el presupuesto 2027", waitingUntil: d(5), closeDate: d(18) });
      await tx.activity.create({ data: { type: "MEETING", subject: "Presentación técnica a gerencia de planta", body: "Les gustó la propuesta; la decisión depende del presupuesto 2027.", occurredAt: ago(6, 10), userId: adminId, accountId: quimica.id, dealId: rep.id } });
      const sel = await deal({ title: "Sellos para agitador", amount: 6800, supplierCost: 5100, freightCost: 180, accountId: quimica.id, contactId: carlos.id, ownerId: adminId, stage: "PROPOSAL", waitingFor: "Plano dimensional del agitador (Carlos)", waitingUntil: d(-1) });
      await tx.activity.create({ data: { type: "EMAIL", subject: "Carlos quedó de enviar el plano dimensional", body: "Sin el plano no podemos confirmar la referencia del sello.", occurredAt: ago(4, 11), userId: adminId, accountId: quimica.id, contactId: carlos.id, dealId: sel.id } });
      const dos = await deal({ title: "Bombas dosificadoras", amount: 15000, accountId: papeles.id, contactId: marta.id, ownerId: adminId, stage: "LEAD" });
      await tx.activity.create({ data: { type: "CALL", subject: "Marta comentó que la bomba actual pierde dosificación", body: "Quiere una propuesta antes de su comité del mes.", occurredAt: ago(6, 9), userId: adminId, accountId: papeles.id, contactId: marta.id, dealId: dos.id } });
      await deal({ title: "Instrumentación caldera", amount: 8000, accountId: papeles.id, contactId: marta.id, ownerId: adminId, stage: "QUALIFIED", nextMove: "Confirmar fuente con Distribuidor A", nextMoveDate: d(2) });

      // 12. ABC Foods · SJ-01842: the Journey Workspace example. Carrier ETA, SOLU expected and the
      // customer promise disagree, so the promise is at risk and the three truths are visible apart.
      const abc = await account("ABC Foods", { industry: "Alimentos y bebidas", ownerId: adminId, creditLimit: 60000, address: "Planta Funza, Cundinamarca", createdAt: d(-400) });
      const ana = await tx.contact.create({ data: { firstName: "Ana", lastName: "Torres", title: "Jefe de Producción", email: "ana.torres@abcfoods.example", accountId: abc.id } });
      const sj = await tx.deal.create({
        data: {
          code: "SJ-01842", title: "Kit de cambio de formato línea 3", amount: 28600, supplierCost: 20400, freightCost: 900, otherCosts: 480,
          accountId: abc.id, contactId: ana.id, ownerId: adminId, stage: "WON", customerPo: "ABC-PO-7781", poAcceptedAt: d(-12),
          desiredResult: "Línea 3 envasando 1 kg al 100 % antes del lanzamiento del 24 de noviembre",
          needSpecs: "2 servomotores 1FK7 con drive S210 + kit de cambio de formato 500 g → 1 kg, compatible con la envasadora actual",
          neededBy: d(10), successMeasure: "Cambio de formato en menos de un turno y 0 paradas la primera semana",
          impactIfNot: "Sin la línea 3 el lanzamiento se corre; ABC estima USD 12.000 por día de retraso",
          sourcingNote: "Servos desde Distribuidor Siemens Miami (stock). Kit de formato fabricado a pedido por el mismo distribuidor (2 semanas).",
          incoterm: "DAP Funza", paymentTerms: "30 días fecha factura", quoteSentAt: d(-24), offerValidUntil: d(-10), closeDate: d(-12),
          promiseText: "Kit instalado y probado en línea 3", promisedDate: d(9),
          nextMove: "Confirmar con DHL si puede pasar el envío a aéreo expreso", nextMoveDate: T,
        },
      });
      await tx.dealItem.createMany({
        data: [
          { dealId: sj.id, qty: 2, code: "1FK7063", description: "Servomotor Siemens 1FK7 con drive S210", unitPrice: 9800 },
          { dealId: sj.id, qty: 1, code: "KF-L3-1KG", description: "Kit de cambio de formato 1 kg línea 3", unitPrice: 9000 },
        ],
      });
      const sjSpo = await spo(sj.id, siemens.id, 20400, "USD", {
        confirmedAt: d(-10), shippedAt: d(-5), eta: d(4),
        carrierName: "DHL Global Forwarding", tracking: "DHL 7781 5520", carrierEta: d(7), carrierEtaAt: new Date(d(-4).getTime() + 15 * 3600e3), carrierEtaSource: "Tracking web DHL",
        terms: "100 % contra pago antes de despacho", shipBy: d(-5), proformaRef: "Proforma SIE-4471", incoterm: "FCA Miami",
      }, [
        { qty: 2, code: "1FK7063", description: "Servomotor Siemens 1FK7 con drive S210", unitCost: 6200 },
        { qty: 1, code: "KF-L3-1KG", description: "Kit de cambio de formato 1 kg línea 3", unitCost: 8000 },
      ], [{ label: "Pago total antes de despacho", percent: 100, amount: 20400, trigger: "El distribuidor despacha contra pago", dueBy: d(-9) }]);
      const sjPay = await tx.supplierPayment.create({ data: { supplierPoId: sjSpo.id, requirementId: sjSpo.requirements[0].id, amount: 20400, currency: "USD", amountUsd: 20400, reason: "El distribuidor despacha contra pago", dueBy: d(-9), docBeneficiary: "Siemens Dist. LLC", docBankName: "Bank of America", docAccount: "000123456789", docSwift: "BOFAUS3N", docSource: "Proforma SIE-4471", requestedById: adminId, approvedById: diana.id, approvedAt: d(-9), executedById: diana.id, executedAt: d(-9), executedRef: "Wire 55120", createdAt: d(-11) } });
      await confirmed(sjPay.id, 20400, d(-9), "Wire 55120");
      await tx.activity.createMany({
        data: [
          { type: "MEETING", subject: "Visita a planta: Ana necesita pasar de 500 g a 1 kg sin parar más de un turno", occurredAt: ago(30, 10), userId: adminId, accountId: abc.id, contactId: ana.id, dealId: sj.id, phase: "need", source: "Visita a planta Funza" },
          { type: "EMAIL", subject: "Siemens Miami confirma stock de servos; el kit se fabrica en 2 semanas", occurredAt: ago(26, 9), userId: adminId, accountId: abc.id, dealId: sj.id, phase: "source", source: "Correo de Siemens Miami" },
          { type: "CALL", subject: "Ana pidió 3 % de descuento por pago anticipado; se mantuvo el precio con plazo de 30 días", occurredAt: ago(20, 15), userId: adminId, accountId: abc.id, contactId: ana.id, dealId: sj.id, phase: "quote", source: "Llamada con Ana" },
          { type: "EMAIL", subject: "DHL avisa posible inspección en aduana de Miami", body: "Podría sumar 2–3 días; lo confirman cuando el contenedor llegue a puerto.", occurredAt: ago(1, 11), userId: paola.id, accountId: abc.id, dealId: sj.id, phase: "execute", source: "Correo del agente DHL", uncertain: true },
          { type: "CALL", subject: "Ana preguntó si la fecha de instalación sigue firme", body: "Le dije que lo confirmamos hoy con DHL.", occurredAt: ago(1, 16), userId: paola.id, accountId: abc.id, contactId: ana.id, dealId: sj.id },
        ],
      });

      // 13. Communication Intelligence: Juan Pérez (ABC Foods) sends a WhatsApp with a nameplate photo.
      const juan = await tx.contact.create({ data: { firstName: "Juan", lastName: "Pérez", title: "Jefe de Mantenimiento", email: "juan.perez@abcfoods.example", phone: "+57 310 555 0142", accountId: abc.id } });
      const old = await tx.deal.create({ data: { code: "SJ-01377", title: "Variador mezcladora línea 2", amount: 4200, supplierCost: 3150, freightCost: 120, accountId: abc.id, contactId: juan.id, ownerId: adminId, stage: "WON", customerPo: "ABC-PO-6120", poAcceptedAt: d(-210), resultAchievedAt: d(-180), desiredResult: "Mezcladora de la línea 2 con control de velocidad" } });
      await tx.dealItem.create({ data: { dealId: old.id, qty: 1, code: "6SL3210-1KE21-7UF1", description: "Variador Siemens SINAMICS G120C 7,5 kW", unitPrice: 4200 } });
      const wa = await tx.commThread.create({ data: { channel: "WHATSAPP", partyName: "Juan Pérez", partyAddr: "+57 310 555 0142", accountId: abc.id, contactId: juan.id, lastAt: ago(0, 8), lastInAt: ago(0, 8) } });
      await tx.commMessage.create({ data: { threadId: wa.id, direction: "IN", authorName: "Juan Pérez", body: "", sentAt: new Date(ago(0, 8).getTime() - 2 * 60e3), attachments: { create: [{ name: "placa-variador.svg", mime: "image/svg+xml", size: NAMEPLATE.length, data: Buffer.from(NAMEPLATE) }] } } });
      await tx.commMessage.create({ data: { threadId: wa.id, direction: "IN", authorName: "Juan Pérez", body: "Buenos días, le mando foto de la placa. Necesito 2 variadores con urgencia, se nos paró la línea 2 de mezclado.", sentAt: ago(0, 8) } });
      const mail = await tx.commThread.create({ data: { channel: "EMAIL", subject: "Fecha de instalación kit línea 3", partyName: "Ana Torres", partyAddr: "ana.torres@abcfoods.example", accountId: abc.id, contactId: ana.id, dealId: sj.id, lastAt: ago(1, 17), lastInAt: ago(1, 16), lastOutAt: ago(1, 17) } });
      await tx.commMessage.create({ data: { threadId: mail.id, direction: "IN", authorName: "Ana Torres", body: "Hola, ¿sigue firme la instalación del kit? Necesito confirmarle a planta el turno.", sentAt: ago(1, 16) } });
      await tx.commMessage.create({ data: { threadId: mail.id, direction: "OUT", authorName: "IndSolUSA", body: "Hola Ana, lo estamos confirmando hoy con DHL y te escribo antes de las 5 pm con la fecha firme.", sentAt: ago(1, 17) } });

      // 14. Quote v3: ABC Foods asks for 2 drives for mixing line 2. Original and Rev. 1 were presented;
      // Rev. 2 is the internal draft (v3). Purchasing committee on Friday, supplier price valid until Monday.
      const nextDow = (dow: number) => { const k = (dow - T.getUTCDay() + 7) % 7 || 7; return d(k); };
      const friday = nextDow(5);
      const monday = nextDow(1) > friday ? nextDow(1) : addDays(nextDow(1), 7);
      const abcAddr = "ABC Foods\nPlanta Funza, Cundinamarca\nColombia";
      const vfd = await deal({
        title: "2 variadores línea 2 de mezclado", amount: 9400, supplierCost: 6300, freightCost: 220, otherCosts: 150,
        accountId: abc.id, contactId: juan.id, ownerId: adminId, stage: "PROPOSAL",
        desiredResult: "Que la línea 2 de mezclado vuelva a operar",
        needSpecs: "2 × Variador Siemens SINAMICS G120C 7,5 kW (6SL3210-1KE21-7UF1), igual al instalado",
        neededBy: d(7), impactIfNot: "La línea 2 parada detiene el 30 % de la producción de mezclas",
        incoterm: "DAP Planta Funza", paymentTerms: "Net 30", quoteSentAt: d(-3), offerValidUntil: d(12), closeDate: friday,
        promiseText: "Variadores en planta Funza 14 días después de la OC",
        nextMove: "Resolver la fecha de la PO ABC-PO-7902 antes de aceptarla", nextMoveDate: T,
      });
      await tx.dealItem.create({ data: { dealId: vfd.id, qty: 2, code: "6SL3210-1KE21-7UF1", description: "Variador Siemens SINAMICS G120C 7,5 kW, 3AC 380-480 V", unitPrice: 4650 } });
      const vfdNo = await nextDocNumber(tx);
      const vfdBase = {
        dealId: vfd.id, number: vfdNo, lang: "EN" as const, createdById: adminId, billTo: abcAddr, shipTo: abcAddr,
        solution: "La línea 2 de mezclado vuelve a operar con 2 variadores idénticos al instalado: se cambian sin reprogramar la mezcladora.",
        supplyPrimary: "Distribuidor Siemens Miami · 2 unidades en stock (6SL3210-1KE21-7UF1)",
        supplyAlt: "Distribuidor Industrial A · G120C equivalente, 4 días más y requiere ajustar parámetros",
        promiseText: "Variadores en planta Funza 14 días después de la OC",
        promiseCondition: "Si la OC llega a más tardar el lunes, mientras se sostiene el precio y el stock de Siemens Miami",
        supplierSrc: "Proforma SIE-4520 · Siemens Miami", freightSrc: "Cotización DHL", otherSrc: "Seguro y manejo en aduana (agente DHL)",
        incoterm: "DAP Planta Funza", paymentTerms: "Net 30", validityDays: 15, leadMinDays: 12, leadMaxDays: 14,
        decisionLabel: "Comité de compras", decisionAt: friday,
        decisionPath: "Juan Pérez (Mantenimiento) pide · Ana Torres (Producción) recomienda · Compras emite la OC",
        decisionEvidence: "WhatsApp de Juan Pérez: «el comité se reúne el viernes y Ana lo lleva»",
        supplierValidUntil: monday, promiseDecideBy: monday,
      };
      const vfdLine = (unitPrice: number) => ({ create: [{ position: 0, qty: 2, code: "6SL3210-1KE21-7UF1", description: "Variador Siemens SINAMICS G120C 7,5 kW, 3AC 380-480 V", unitPrice }] });
      await tx.quote.create({ data: { ...vfdBase, rev: 0, status: "SUPERSEDED", createdAt: d(-6), issuedAt: d(-6), presentedAt: d(-6), supplierCost: 6300, freightCost: 380, otherCosts: 150, protSale: 9800, protCost: 6830, protEsagra: 2970, protPolicy: 1, leadMinDays: 6, leadMaxDays: 8, lines: vfdLine(4900) } });
      await tx.quote.create({ data: { ...vfdBase, rev: 1, status: "SUPERSEDED", createdAt: d(-3), issuedAt: d(-3), presentedAt: d(-3), supplierCost: 6300, freightCost: 220, otherCosts: 150, protSale: 9400, protCost: 6670, protEsagra: 2730, protPolicy: 1, changeNote: "Juan pidió bajar el precio: flete aéreo directo → consolidado (USD 160 menos, 2 días más)", lines: vfdLine(4700) } });
      await tx.quote.create({
        data: {
          ...vfdBase, rev: 2, status: "PRESENTED", createdAt: d(-2), issuedAt: d(-2), presentedAt: d(-2), decisionAt: d(0), supplierCost: 6180, freightCost: 220, otherCosts: 150, protSale: 9300, protCost: 6550, protEsagra: 2750, protPolicy: 1,
          changeNote: "Siemens Miami bajó USD 60 por unidad (proforma SIE-4520 del 4 nov); se traslada al precio para el comité",
          lines: vfdLine(4650),
          scenarios: {
            create: [
              { position: 0, label: "Más rápido · aéreo directo", price: 9700, cost: 6710, leadMinDays: 6, leadMaxDays: 8, risk: "Bajo: Siemens Miami despacha aéreo el mismo día", promise: "En planta 8 días después de la OC" },
              { position: 1, label: "Recomendado · consolidado", price: 9300, cost: 6550, leadMinDays: 12, leadMaxDays: 14, risk: "Bajo: stock confirmado por Siemens Miami", promise: "En planta 14 días después de la OC", recommended: true, why: "Consolidado cubre la necesidad con USD 400 menos; el aéreo queda de respaldo si el cliente exige una fecha anterior." },
              { position: 2, label: "Más económico · equivalente", price: 8600, cost: 6270, leadMinDays: 18, leadMaxDays: 21, risk: "Medio: hay que ajustar parámetros en la mezcladora", promise: "En planta 21 días después de la OC" },
            ],
          },
        },
      });
      await tx.activity.createMany({
        data: [
          { type: "EMAIL", subject: `Cotización ${vfdNo} presentada a Juan Pérez`, occurredAt: ago(6, 15), userId: adminId, accountId: abc.id, contactId: juan.id, dealId: vfd.id, phase: "quote", source: "Correo a Juan Pérez" },
          { type: "NOTE", subject: "Juan pidió mejor precio; aceptaría 2 días más de entrega", occurredAt: ago(4, 10), userId: adminId, accountId: abc.id, contactId: juan.id, dealId: vfd.id, phase: "quote", source: "WhatsApp de Juan Pérez" },
          { type: "EMAIL", subject: `Cotización ${vfdNo} Rev. 1 presentada`, occurredAt: ago(3, 11), userId: adminId, accountId: abc.id, contactId: juan.id, dealId: vfd.id, phase: "quote", source: "Correo a Juan Pérez" },
        ],
      });

      // ABC's PO arrives today answering Quote v3, but it demands delivery 6 days before what the quote protects.
      const v3 = await tx.quote.findFirstOrThrow({ where: { number: vfdNo, rev: 2 } });
      await tx.customerPO.create({
        data: {
          dealId: vfd.id, quoteId: v3.id, number: "ABC-PO-7902", receivedAt: T, requiredBy: d(8),
          incoterm: "DAP Planta Funza", paymentTerms: "Net 30", shipTo: "Planta Funza, Cundinamarca", quoteRef: `Cotización ${vfdNo} Rev. 2`,
          source: "PDF adjunto · correo de Compras ABC Foods", createdById: adminId, createdByName: "IndSolUSA Sales",
          lines: { create: [{ position: 0, qty: 2, code: "6SL3210-1KE21-7UF1", description: "VARIADOR DE FRECUENCIA SIEMENS G120C 7.5KW", unitPrice: 4650 }] },
        },
      });
      await tx.activity.create({ data: { type: "EMAIL", subject: "PO ABC-PO-7902 recibida · por comparar con cotización", occurredAt: ago(0, 9), userId: adminId, accountId: abc.id, contactId: juan.id, dealId: vfd.id, phase: "quote", source: "Correo de Compras ABC Foods" } });

      // Papeles del Sur: a quote still in preparation, with one item blocking "Ready to Present".
      await tx.deal.update({ where: { id: dos.id }, data: { desiredResult: "Dosificación estable de químicos en la máquina 2", supplierCost: 10200, freightCost: 450 } });
      await tx.quote.create({
        data: {
          dealId: dos.id, number: await nextDocNumber(tx), lang: "ES", createdById: adminId, status: "DRAFT",
          billTo: "Papeles del Sur", shipTo: "Papeles del Sur", solution: "Dosificación estable en la máquina 2 con bombas de diafragma y control por señal 4–20 mA.",
          supplyPrimary: "Distribuidor Industrial A", promiseText: "Bombas instaladas antes del comité del mes", promiseCondition: "Si la OC llega en los próximos 10 días",
          supplierCost: 10200, freightCost: 450, freightSrc: "Cotización DHL", leadMinDays: 15, leadMaxDays: 20, incoterm: "DAP Cali", paymentTerms: "Net 30",
          lines: { create: [{ position: 0, qty: 3, code: "DDA-30", description: "Bomba dosificadora de diafragma 30 l/h", unitPrice: 4800 }] },
        },
      });

      // Química Andina: quote presented, the customer depends on its 2027 budget → Waiting with Control, no action today.
      const repNo = await nextDocNumber(tx);
      await tx.deal.update({ where: { id: rep.id }, data: { supplierCost: 36000, freightCost: 1500, otherCosts: 2500, quoteSentAt: d(-6), offerValidUntil: d(24), desiredResult: "Línea 2 de extrusión a 120 % de capacidad sin paradas" } });
      await tx.quote.create({
        data: {
          dealId: rep.id, number: repNo, lang: "ES", createdById: adminId, status: "PRESENTED", createdAt: d(-6), issuedAt: d(-6), presentedAt: d(-6), validityDays: 30,
          billTo: "Química Andina\nZona Industrial Mamonal, Cartagena", shipTo: "Química Andina\nZona Industrial Mamonal, Cartagena",
          solution: "Línea 2 a 120 % de capacidad con variadores nuevos, PLC actualizado y puesta en marcha en una parada programada.",
          supplyPrimary: "Distribuidor Siemens Miami (variadores y PLC) + integrador local para la puesta en marcha",
          promiseText: "Puesta en marcha en la parada de enero", promiseCondition: "Si la OC llega antes del 15 de diciembre",
          supplierCost: 36000, supplierSrc: "Proforma SIE-4490", freightCost: 1500, freightSrc: "Cotización DHL marítimo", otherCosts: 2500, otherSrc: "Integrador local (oferta INT-118)",
          protSale: 50000, protCost: 40000, protEsagra: 10000, protPolicy: 1,
          leadMinDays: 35, leadMaxDays: 45, incoterm: "DAP Cartagena", paymentTerms: "Net 30",
          decisionLabel: "Aprobación del presupuesto 2027", decisionAt: d(12), decisionPath: "Carlos Duarte recomienda · Gerencia de planta aprueba el presupuesto · Compras emite la OC",
          decisionEvidence: "Reunión con gerencia de planta: «depende del presupuesto 2027»", supplierValidUntil: d(25), promiseDecideBy: d(20), supplyConfirmed: true,
          lines: { create: [{ position: 0, qty: 1, code: "REP-L2", description: "Repotenciación línea 2: variadores, PLC y puesta en marcha", unitPrice: 50000 }] },
        },
      });

      // SJ-01842: the accepted quote behind the customer's PO.
      await tx.quote.create({
        data: {
          dealId: sj.id, number: await nextDocNumber(tx), lang: "EN", createdById: adminId, status: "ACCEPTED", createdAt: d(-25), issuedAt: d(-24), presentedAt: d(-24), decidedAt: d(-12), validityDays: 14,
          billTo: abcAddr, shipTo: abcAddr, solution: "Línea 3 envasando 1 kg al 100 % antes del lanzamiento, con cambio de formato en menos de un turno.",
          supplyPrimary: "Distribuidor Siemens Miami (servos en stock, kit a pedido)", promiseText: "Kit instalado y probado en línea 3",
          supplierCost: 20400, supplierSrc: "Proforma SIE-4471", freightCost: 900, freightSrc: "DHL Global Forwarding", otherCosts: 480, otherSrc: "Aduana y seguro",
          protSale: 28600, protCost: 21780, protEsagra: 6820, protPolicy: 1, leadMinDays: 28, leadMaxDays: 35, incoterm: "DAP Funza", paymentTerms: "Net 30",
          lines: { create: [
            { position: 0, qty: 2, code: "1FK7063", description: "Servomotor Siemens 1FK7 con drive S210", unitPrice: 9800 },
            { position: 1, qty: 1, code: "KF-L3-1KG", description: "Kit de cambio de formato 1 kg línea 3", unitPrice: 9000 },
          ] },
        },
      });

      // Lácteos: the invoiced pumps come from an accepted quote, so the invoice PDF cites its Quote Nº.
      const lacQ = await tx.quote.create({
        data: {
          dealId: lac1.id, number: await nextDocNumber(tx), lang: "EN", createdById: paola.id, status: "ACCEPTED", createdAt: d(-46), issuedAt: d(-45), presentedAt: d(-45), decidedAt: d(-40),
          billTo: "Lácteos del Valle\nPlanta Tuluá, Valle", shipTo: "Lácteos del Valle\nPlanta Tuluá, Valle", promiseText: "Bombas instaladas antes del cierre de mes",
          supplierCost: 4600, supplierSrc: "Cotización Distribuidor Industrial A", freightCost: 230, otherCosts: 100,
          protSale: 6240, protCost: 4930, protEsagra: 1310, protPolicy: 1, leadMinDays: 10, leadMaxDays: 14, incoterm: "DAP Tuluá", paymentTerms: "Net 30",
          lines: { create: [{ position: 0, qty: 2, code: "CPX-50", description: "Bomba centrífuga sanitaria 5 HP", unitPrice: 3120 }] },
        },
      });
      await tx.invoice.update({ where: { id: lacInv.id }, data: { quoteId: lacQ.id } });

      // Minera · kit de bomba de lodos: PO accepted, quote accepted, no Supplier PO yet → one click prepares it.
      await tx.quote.create({
        data: {
          dealId: min2.id, number: await nextDocNumber(tx), lang: "ES", createdById: paola.id, status: "ACCEPTED", createdAt: d(-6), issuedAt: d(-6), presentedAt: d(-6), decidedAt: d(-1),
          billTo: "Minera El Roble", shipTo: "Minera El Roble", solution: "Bomba de lodos de vuelta a operación con un kit completo de desgaste.",
          supplyPrimary: "Distribuidor Industrial A · kit en stock Miami", promiseText: "Entrega lunes 16",
          supplierCost: 8900, supplierSrc: "Cotización IA-7712", freightCost: 300, freightSrc: "DHL aéreo",
          protSale: 11200, protCost: 9200, protEsagra: 2000, protPolicy: 1, leadMinDays: 8, leadMaxDays: 10, incoterm: "DAP planta", paymentTerms: "Net 30",
          lines: { create: [{ position: 0, qty: 1, code: "KBL-6", description: "Kit de bomba de lodos 6\"", unitPrice: 11200 }] },
        },
      });

      // ---------- Logistics Forward View: five shipment states ----------
      const hrs = (h: number) => new Date(Date.now() - h * 3600e3);
      type Sup = typeof siemens;
      // A purchase already paid (confirmed) so the shipment has a coherent chain behind it.
      const paidSpo = async (dealId: string, sup: Sup, lines: Ln[], shippedAt: Date) => {
        const amount = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
        const p = await spo(dealId, sup.id, amount, sup.currency, { confirmedAt: addDays(shippedAt, -3), shippedAt, terms: sup.paymentTerms, shipBy: shippedAt }, lines,
          [{ label: "Pago total antes de despacho", percent: 100, amount, trigger: "El proveedor despacha contra pago", dueBy: addDays(shippedAt, -1) }]);
        const pay = await tx.supplierPayment.create({ data: { supplierPoId: p.id, requirementId: p.requirements[0].id, amount, currency: sup.currency, amountUsd: amount, reason: "El proveedor despacha contra pago", dueBy: addDays(shippedAt, -1), docBeneficiary: sup.bankBeneficiary, docBankName: sup.bankName, docAccount: sup.bankAccount, docSwift: sup.bankSwift, docSource: "Proforma (ejemplo)", requestedById: paola.id, approvedById: adminId, approvedAt: addDays(shippedAt, -2), executedById: diana.id, executedAt: addDays(shippedAt, -1), executedRef: "Wire (ejemplo)", createdAt: addDays(shippedAt, -3) } });
        await confirmed(pay.id, amount, addDays(shippedAt, -1), "Wire (ejemplo)");
        return p;
      };
      type Ev = { h: number; loc?: string; lat?: number; lng?: number; text: string; kind?: "SCAN" | "ETA_CHANGE" | "EXCEPTION" | "CUSTOMS" | "DELIVERED" | "NOTE"; material?: boolean; etaBefore?: Date; etaAfter?: Date; source?: string };
      const fd = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format;
      const shipment = async (data: Omit<Prisma.ShipmentUncheckedCreateInput, "code" | "createdByName">, lines: { dealItemId: string; qty: number; description: string }[], events: Ev[]) => {
        const code = await nextCode("SHP", "shipment", tx);
        return tx.shipment.create({
          data: {
            ...data, code, createdByName: paola.name,
            lines: { create: lines },
            events: { create: events.map((e) => ({ at: hrs(e.h), kind: e.kind ?? "SCAN", location: e.loc, lat: e.lat, lng: e.lng, text: e.text, material: e.material ?? false, etaBefore: e.etaBefore, etaAfter: e.etaAfter, source: e.source ?? "Tracking del transportista", recordedByName: e.kind === "SCAN" || !e.kind ? null : paola.name })) },
          },
        });
      };
      const docsIntl = (co: boolean, awb = "Guía aérea (AWB)") => [
        { key: "ci", label: "Factura comercial", ready: true }, { key: "pl", label: "Lista de empaque", ready: true },
        { key: "awb", label: awb, ready: true }, { key: "co", label: "Certificado de origen", ready: co },
      ];
      const HOU = { lat: 29.76, lng: -95.37 }, MEM = { lat: 35.15, lng: -90.05 }, MIA = { lat: 25.79, lng: -80.29 }, BOG = { lat: 4.7, lng: -74.15 };

      // (a) Normal transit, 0 interruptions: 10 normal scans → no actions.
      const pap = await deal({ title: "Válvulas de control caldera 2", amount: 9200, supplierCost: 6900, freightCost: 320, accountId: papeles.id, contactId: marta.id, ownerId: adminId, stage: "WON", customerPo: "PDS-OC-3310", poAcceptedAt: d(-8), desiredResult: "Caldera 2 regulando presión sin intervención manual", promiseText: "Válvulas en planta Cali antes del 17", promisedDate: d(12) });
      const papItem = await tx.dealItem.create({ data: { dealId: pap.id, qty: 2, code: "CV-2-150", description: "Válvula de control 2\" ANSI 150", unitPrice: 4600 } });
      const papSpo = await paidSpo(pap.id, general, [{ qty: 2, code: "CV-2-150", description: "Válvula de control 2\" ANSI 150", unitCost: 3450 }], d(-3));
      await shipment({ dealId: pap.id, supplierPoId: papSpo.id, carrierName: "FedEx", tracking: "7729 4410 3381", mode: "AIR", origin: "Houston, TX", destination: "Papeles del Sur · Cali", destLat: 3.45, destLng: -76.53, international: true, customs: "PENDING", plannedRts: d(-3), rtsAt: d(-3), plannedPickup: d(-3), pickedUpAt: d(-3), plannedDelivery: d(4), carrierEta: d(4), carrierEtaAt: hrs(5), carrierEtaSource: "Tracking web FedEx", docs: docsIntl(true) },
        [{ dealItemId: papItem.id, qty: 2, description: "CV-2-150 · Válvula de control 2\" ANSI 150" }],
        [
          { h: 70, loc: "Houston, TX", ...HOU, text: "Recogido" }, { h: 66, loc: "Houston, TX", ...HOU, text: "En instalación FedEx" }, { h: 60, loc: "Houston, TX", ...HOU, text: "Salió de la instalación" },
          { h: 52, loc: "Memphis, TN", ...MEM, text: "Llegó al hub" }, { h: 48, loc: "Memphis, TN", ...MEM, text: "En proceso en el hub" }, { h: 41, loc: "Memphis, TN", ...MEM, text: "Salió del hub" },
          { h: 30, loc: "Miami, FL", ...MIA, text: "Llegó a la puerta internacional" }, { h: 22, loc: "Miami, FL", ...MIA, text: "Documentación de exportación verificada" }, { h: 12, loc: "Miami, FL", ...MIA, text: "En vuelo programado" },
          { h: 5, loc: "Miami, FL", ...MIA, text: "Salió hacia Bogotá" },
        ]);

      // (b) ETA churn within the buffer: three ETA changes, still protected → "Protected · no action".
      const sid3 = await deal({ title: "Acoples para laminador", amount: 4200, supplierCost: 3100, freightCost: 180, accountId: sider.id, stage: "WON", customerPo: "SN-77402", poAcceptedAt: d(-9), promiseText: "Acoples instalados en la parada del 17", promisedDate: d(12) });
      const sidItem3 = await tx.dealItem.create({ data: { dealId: sid3.id, qty: 4, code: "AC-90", description: "Acople flexible 90 mm", unitPrice: 1050 } });
      const sidSpo3 = await paidSpo(sid3.id, siemens, [{ qty: 4, code: "AC-90", description: "Acople flexible 90 mm", unitCost: 775 }], d(-4));
      await shipment({ dealId: sid3.id, supplierPoId: sidSpo3.id, carrierName: "UPS", tracking: "1Z 88E 412 03 5521 7704", mode: "AIR", origin: "Miami, FL", destination: "Siderúrgica del Norte · Barranquilla", destLat: 10.96, destLng: -74.8, international: true, customs: "PENDING", plannedRts: d(-4), rtsAt: d(-4), plannedPickup: d(-4), pickedUpAt: d(-4), plannedDelivery: d(3), carrierEta: d(5), carrierEtaAt: hrs(8), carrierEtaSource: "Tracking web UPS", docs: docsIntl(true) },
        [{ dealItemId: sidItem3.id, qty: 4, description: "AC-90 · Acople flexible 90 mm" }],
        [
          { h: 92, loc: "Miami, FL", ...MIA, text: "Recogido" }, { h: 80, loc: "Miami, FL", ...MIA, text: "En instalación UPS" },
          { h: 70, kind: "ETA_CHANGE", text: `ETA del transportista: ${fd(d(3))} → ${fd(d(4))}`, etaBefore: d(3), etaAfter: d(4) },
          { h: 44, loc: "Miami, FL", ...MIA, text: "Esperando espacio en vuelo" },
          { h: 40, kind: "ETA_CHANGE", text: `ETA del transportista: ${fd(d(4))} → ${fd(d(5))}`, etaBefore: d(4), etaAfter: d(5) },
          { h: 20, loc: "Miami, FL", ...MIA, text: "Salió hacia Barranquilla" }, { h: 8, loc: "Barranquilla", lat: 10.89, lng: -74.78, text: "Llegó al país de destino" },
        ]);

      // (c) Result at Risk: SJ-01842. A missed connection pushes the carrier ETA past what the promise allows.
      const sjItems = await tx.dealItem.findMany({ where: { dealId: sj.id }, orderBy: { id: "asc" } });
      await shipment({ dealId: sj.id, supplierPoId: sjSpo.id, carrierName: "DHL Global Forwarding", tracking: "DHL 7781 5520", mode: "AIR", origin: "Miami, FL", destination: "ABC Foods · Funza", destLat: 4.72, destLng: -74.21, international: true, customs: "PENDING", plannedRts: d(-6), rtsAt: d(-5), plannedPickup: d(-5), pickedUpAt: d(-5), plannedDelivery: d(4), carrierEta: d(7), carrierEtaAt: new Date(d(-4).getTime() + 15 * 3600e3), carrierEtaSource: "Tracking web DHL", docs: docsIntl(true) },
        sjItems.map((it) => ({ dealItemId: it.id, qty: it.qty, description: `${it.code} · ${it.description}` })),
        [
          { h: 118, loc: "Miami, FL", ...MIA, text: "Recogido en Distribuidor Siemens Miami" }, { h: 110, loc: "Miami, FL", ...MIA, text: "Recibido en bodega DHL" },
          { h: 104, kind: "ETA_CHANGE", text: `ETA del transportista: ${fd(d(4))} → ${fd(d(5))}`, etaBefore: d(4), etaAfter: d(5) },
          { h: 98, loc: "Miami, FL", ...MIA, text: "Consolidado para vuelo" },
          { h: 92, kind: "EXCEPTION", loc: "Miami, FL", ...MIA, text: "Conexión perdida: la carga no subió al vuelo y se reprogramó", material: true, etaBefore: d(5), etaAfter: d(7), source: "Tracking web DHL" },
          { h: 60, loc: "Miami, FL", ...MIA, text: "En espera de vuelo reprogramado" }, { h: 30, loc: "Miami, FL", ...MIA, text: "Manifestado para vuelo" },
        ]);

      // (d) Customs hold: arrived in Bogotá, held for a missing certificate of origin; still protectable.
      const qcs = await deal({ title: "Sellos mecánicos para reactor", amount: 5400, supplierCost: 3900, freightCost: 260, accountId: quimica.id, contactId: carlos.id, ownerId: adminId, stage: "WON", customerPo: "QA-OC-1188", poAcceptedAt: d(-10), desiredResult: "Reactor 3 sin fugas en el arranque", promiseText: "Sellos en planta Cartagena el 10", promisedDate: d(5) });
      const qcsItem = await tx.dealItem.create({ data: { dealId: qcs.id, qty: 3, code: "SM-RX-60", description: "Sello mecánico doble 60 mm", unitPrice: 1800 } });
      const qcsSpo = await paidSpo(qcs.id, general, [{ qty: 3, code: "SM-RX-60", description: "Sello mecánico doble 60 mm", unitCost: 1300 }], d(-5));
      await shipment({ dealId: qcs.id, supplierPoId: qcsSpo.id, carrierName: "DHL Express", tracking: "JD0146 0000 7712 3390", mode: "COURIER", origin: "Houston, TX", destination: "Química Andina · Cartagena", destLat: 10.39, destLng: -75.48, international: true, customs: "HOLD", customsNote: "La DIAN pide el certificado de origen para aplicar el arancel preferencial.", plannedRts: d(-5), rtsAt: d(-5), plannedPickup: d(-5), pickedUpAt: d(-5), plannedDelivery: d(-1), carrierEta: d(-1), carrierEtaAt: hrs(30), carrierEtaSource: "Tracking web DHL", docs: docsIntl(false) },
        [{ dealItemId: qcsItem.id, qty: 3, description: "SM-RX-60 · Sello mecánico doble 60 mm" }],
        [
          { h: 116, loc: "Houston, TX", ...HOU, text: "Recogido" }, { h: 100, loc: "Cincinnati, OH", lat: 39.05, lng: -84.66, text: "En hub DHL" },
          { h: 80, loc: "Miami, FL", ...MIA, text: "En puerta internacional" }, { h: 50, loc: "Bogotá", ...BOG, text: "Llegó al país de destino" },
          { h: 30, kind: "CUSTOMS", loc: "Bogotá", ...BOG, text: "Retenido en aduana: falta certificado de origen", material: true },
        ]);

      // (e) Carrier delivered, customer disputes receipt.
      const lac3 = await deal({ title: "Empaques para válvulas mariposa", amount: 1400, supplierCost: 980, freightCost: 60, accountId: lacteos.id, stage: "WON", customerPo: "4500-1931", poAcceptedAt: d(-6), promiseText: "Empaques en planta Tuluá el 6", promisedDate: d(1) });
      const lacItem3 = await tx.dealItem.create({ data: { dealId: lac3.id, qty: 20, code: "EMP-MV-4", description: "Empaque EPDM válvula mariposa 4\"", unitPrice: 70 } });
      const lacSpo3 = await paidSpo(lac3.id, rodamientos, [{ qty: 20, code: "EMP-MV-4", description: "Empaque EPDM válvula mariposa 4\"", unitCost: 49 }], d(-3));
      await shipment({ dealId: lac3.id, supplierPoId: lacSpo3.id, carrierName: "Servientrega", tracking: "SV 2044 1187 55", mode: "GROUND", origin: "Bogotá", destination: "Lácteos del Valle · Tuluá", destLat: 4.08, destLng: -76.2, international: false, toCustomer: true, customs: "NOT_REQUIRED", plannedRts: d(-3), rtsAt: d(-3), plannedPickup: d(-3), pickedUpAt: d(-3), plannedDelivery: d(-1), carrierEta: d(-1), carrierEtaAt: hrs(60), carrierEtaSource: "Tracking web Servientrega", deliveredAt: d(-1), deliveredNote: "Firmó: Portería (J. Ruiz)", receipt: "DISPUTED", disputedAt: hrs(20), disputeNote: "Almacén dice que no tiene registro de la caja; portería no la entregó a almacén.", docs: [{ key: "rem", label: "Remisión / guía nacional", ready: true }] },
        [{ dealItemId: lacItem3.id, qty: 20, description: "EMP-MV-4 · Empaque EPDM válvula mariposa 4\"" }],
        [
          { h: 70, loc: "Bogotá", ...BOG, text: "Recogido" }, { h: 60, loc: "Bogotá", ...BOG, text: "Salió del centro de distribución" }, { h: 40, loc: "Cali", lat: 3.45, lng: -76.53, text: "En centro de distribución" },
          { h: 30, kind: "DELIVERED", loc: "Tuluá", lat: 4.08, lng: -76.2, text: "Entregado · firmó Portería (J. Ruiz)" },
          { h: 20, kind: "NOTE", text: "El cliente disputa el recibo: almacén no tiene registro de la caja", material: true, source: "Llamada de Almacén Lácteos" },
        ]);

      await seedMarketDemo(tx, d, paola, lacteos, pacifico);
      await seedMarketM4(tx, d, { siderId: sider.id, ownerId: paola.id, ownerName: paola.name, treasurerId: diana.id });
      await seedMarketM5(tx, d, paola.name, lacteos.id);
      await seedMarketM6(tx, d, paola.name, lacteos.id);
      await seedComercialC1(tx, d, paola.name);
      await seedComercialC4(tx, d, paola.name);
      await seedComercialC5(tx, d, paola.name);
      await seedComercialC6(tx);
      await seedComercialC3(tx, d, { paolaId: paola.id, paolaName: paola.name });

      await tx.task.createMany({
        data: [
          { title: "Preparar visita técnica a Química Andina", assigneeId: adminId, accountId: quimica.id, dealId: q1.id, dueDate: d(3), estimateMinutes: 90 },
          { title: "Revisar condiciones de pago con Minera", assigneeId: adminId, accountId: minera.id, dueDate: d(1), estimateMinutes: 30 },
          { title: "Actualizar lista de precios 2027", assigneeId: adminId, dueDate: d(20), estimateMinutes: 120 },
        ],
      });
      // Older Journeys whose result was already confirmed.
      await tx.deal.updateMany({ where: { resultAchievedAt: { not: null }, resultState: "PENDING", account: { isDemo: true } }, data: { resultState: "ACHIEVED" } });
    },
    { timeout: 60000 },
  );
  // SOLU reads the sample conversations once they exist.
  for (const th of await db.commThread.findMany({ where: { account: { isDemo: true } }, select: { id: true } })) await refreshUnderstanding(th.id);
  // Payment behavior of the sample customers, as if Treasury had just reconciled (creates the M4 trend signal).
  for (const a of await db.account.findMany({ where: { isDemo: true }, select: { id: true } })) await refreshPaymentBehaviorSafe(a.id, "Datos de ejemplo cargados");
  const pao = await db.user.findUnique({ where: { email: `paola${DEMO_DOMAIN}` }, select: { id: true } });
  if (pao) await seedCreditRequestC3(pao.id);
}


// Mercado (Módulo 09): golden exploration "Mercado lácteo colombiano — Alfa Laval, Siemens, SKF".
async function seedMarketDemo(tx: Prisma.TransactionClient, d: (n: number) => Date, paola: { id: string; name: string }, lacteos: { id: string; name: string }, pacifico: { id: string; name: string }) {
  const by = paola.name;
  const tulua = await tx.plant.create({ data: { accountId: lacteos.id, name: "Planta Tuluá", city: "Tuluá", country: "Colombia", operationType: "Pasteurización, UHT y limpieza CIP", sourceType: "VISIT", sourceRef: "Visita técnica con Jorge Pérez", observedAt: d(-90), confidence: "VERIFIED", capturedByName: by, createdAt: d(-90) } });
  const ex = await tx.exploration.create({
    data: {
      name: "Mercado lácteo colombiano — Alfa Laval, Siemens, SKF", ownerId: paola.id, scope: "INDUSTRY", scopeText: "Lácteos · Colombia · Alfa Laval, Siemens, SKF",
      purpose: "Entender dónde las plantas lácteas de Colombia dependen de Alfa Laval, Siemens y SKF, y dónde podemos ser útiles antes de que lo necesiten con urgencia.",
      hypothesis: "Las plantas que amplían UHT van a necesitar bombas sanitarias, instrumentación y rodamientos en los próximos 6 meses.",
      startedAt: d(-12), createdAt: d(-12), movement: "MOVE", lifecycle: "ACTIVE",
      nextMove: "Llamar a Jorge Pérez para entender el alcance de la segunda línea UHT", nextMoveAt: d(2), nextReviewAt: d(2),
      links: { create: [
        { kind: "ACCOUNT", refId: lacteos.id, label: lacteos.name, why: "Cliente actual con planta láctea en Tuluá" },
        { kind: "ACCOUNT", refId: pacifico.id, label: pacifico.name, why: "Cliente nuevo de alimentos; no sabemos si procesa lácteos" },
        { kind: "BRAND", refId: "alfa-laval", label: "Alfa Laval", why: "Tecnología nombrada en el propósito" },
        { kind: "BRAND", refId: "siemens", label: "Siemens", why: "Tecnología nombrada en el propósito" },
        { kind: "BRAND", refId: "skf", label: "SKF", why: "Tecnología nombrada en el propósito" },
      ] },
    },
  });
  await tx.task.create({ data: { title: "Mercado: Llamar a Jorge Pérez para entender el alcance de la segunda línea UHT", assigneeId: paola.id, explorationId: ex.id, dueDate: d(2) } });
  await tx.marketSignal.create({ data: { kind: "EXPANSION", what: "Lácteos del Valle anunció una segunda línea UHT en Tuluá", whyMatters: "Una línea nueva suele traer bombas sanitarias, intercambiadores e instrumentación; quizás también repuestos para la línea actual.", accountId: lacteos.id, plantId: tulua.id, explorationId: ex.id, status: "EXPLORING", sourceType: "CONVERSATION", sourceRef: "Jorge Pérez (Mantenimiento), llamada", observedAt: d(-12), confidence: "REPORTED", capturedById: paola.id, capturedByName: by, createdAt: d(-12) } });
  // A new signal waiting on the Home (not explored yet).
  await tx.marketSignal.create({ data: { kind: "NEW_PLANT", what: "Alimentos del Pacífico abrirá una planta de bebidas lácteas en Buenaventura", whyMatters: "Si procesan leche, podrían necesitar homogeneizadores y bombas sanitarias desde el arranque.", accountId: pacifico.id, sourceType: "NEWS", sourceRef: "Nota en prensa regional (Valle)", observedAt: d(-3), confidence: "REPORTED", capturedById: paola.id, capturedByName: by, createdAt: d(-3) } });
  await tx.knowledgeGap.createMany({ data: [
    { explorationId: ex.id, accountId: lacteos.id, question: "¿Quién decide las compras de la segunda línea UHT: mantenimiento o proyectos?", why: "Sin saberlo podemos hablar con la persona equivocada.", createdByName: by, createdAt: d(-12) },
    { explorationId: ex.id, accountId: lacteos.id, question: "¿Qué marca de intercambiador de placas usa la línea actual?", why: "Define si los empaques y placas que podemos ofrecer aplican.", createdByName: by, createdAt: d(-10) },
    { explorationId: ex.id, accountId: pacifico.id, question: "¿Alimentos del Pacífico procesa leche o solo bebidas vegetales?", createdByName: by, createdAt: d(-3) },
    { explorationId: ex.id, accountId: lacteos.id, question: "¿Cuándo arranca el montaje de la segunda línea?", status: "RESOLVED", answer: "El montaje empieza en marzo de 2027; las compras de equipos se cierran en enero.", answerSource: "Jorge Pérez, llamada", resolvedAt: d(-6), resolvedByName: by, createdByName: by, createdAt: d(-12) },
  ] });
  await tx.whiteSpace.createMany({ data: [
    { explorationId: ex.id, accountId: lacteos.id, kind: "PLANT", what: "Planta de quesos de Lácteos del Valle en Cartago", why: "Jorge la mencionó; nunca les hemos vendido allá.", createdByName: by, createdAt: d(-9) },
    { explorationId: ex.id, accountId: lacteos.id, kind: "TECHNOLOGY", what: "Rodamientos SKF de los homogeneizadores", why: "Solo les vendemos bombas e instrumentación; los rodamientos los compran a otro distribuidor.", createdByName: by, createdAt: d(-8) },
  ] });
  await tx.futureOpportunity.create({ data: { kind: "SHUTDOWN", description: "Parada anual de la línea UHT 1 en enero", accountId: lacteos.id, plantId: tulua.id, process: "UHT 1", explorationId: ex.id, expectedAt: d(70), impact: "Cambian sellos, rodamientos y empaques de la línea en 5 días", valueBasis: "Sin precio aún: depende de la lista de repuestos", nextMove: "Pedir la lista de repuestos de la parada en diciembre", ownerId: paola.id, sourceType: "CONVERSATION", sourceRef: "Jorge Pérez", observedAt: d(-10), confidence: "REPORTED", capturedByName: by, createdAt: d(-10) } });
  await seedMarketM2(tx, d, by, lacteos, tulua.id);
  await tx.futureOpportunity.create({ data: { kind: "CAPEX", description: "Compra de equipos para la segunda línea UHT", accountId: lacteos.id, plantId: tulua.id, process: "UHT 2", explorationId: ex.id, expectedAt: d(60), impact: "Equipos nuevos: bombas sanitarias, instrumentación Siemens", valueBasis: "Desconocido", ownerId: paola.id, sourceType: "CONVERSATION", sourceRef: "Jorge Pérez, llamada", observedAt: d(-6), confidence: "REPORTED", capturedByName: by, createdAt: d(-6) } });
}

/** Mercado M2: how Lácteos del Valle works, what is installed in Tuluá, what a stop costs, who is who. */
async function seedMarketM2(tx: Prisma.TransactionClient, d: (n: number) => Date, by: string, lacteos: { id: string }, tuluaId: string) {
  const jorge = await tx.contact.findFirst({ where: { accountId: lacteos.id, firstName: "Jorge" }, select: { id: true } });
  const prov = { sourceType: "CONVERSATION", sourceRef: "Jorge Pérez (Mantenimiento)", confidence: "REPORTED", capturedByName: by };
  await tx.accountAlias.create({ data: { accountId: lacteos.id, name: "Lácteos del Valle S.A.S.", kind: "LEGAL", createdByName: by } });
  await tx.accountInsight.createMany({ data: [
    { accountId: lacteos.id, block: "DECIDE", area: "Mantenimiento", step: "DETECT", statement: "Mantenimiento detecta la falla y especifica el repuesto", observedAt: d(-40), ...prov },
    { accountId: lacteos.id, block: "DECIDE", area: "Mantenimiento", step: "SPECIFY", statement: "Jorge define la referencia exacta; no aceptan equivalentes sin ficha técnica", observedAt: d(-40), ...prov },
    { accountId: lacteos.id, block: "DECIDE", area: "Compras", step: "NEGOTIATE", statement: "Compras pide cotizaciones y negocia plazo", observedAt: d(-40), ...prov },
    { accountId: lacteos.id, block: "DECIDE", area: "Gerencia de planta", step: "APPROVE", condition: "más de COP 50 millones", statement: "La gerente de planta aprueba las compras grandes", observedAt: d(-30), ...prov },
    { accountId: lacteos.id, block: "BUY", topic: "QUOTES", statement: "Piden 2 cotizaciones, salvo urgencias de parada", observedAt: d(-30), ...prov },
    { accountId: lacteos.id, block: "BUY", topic: "PAYMENT", statement: "Pagan a 30 días por transferencia", observedAt: d(-200), sourceType: "INTERNAL", sourceRef: "Historia de pagos con nosotros", confidence: "VERIFIED", capturedByName: by },
    { accountId: lacteos.id, block: "VALUE", topic: "CONTINUITY", area: "Mantenimiento", statement: "Prefieren pagar más si el repuesto llega antes de la parada", evidence: "Jorge: «prefiero pagar el flete aéreo a parar la UHT un día»", observedAt: d(-28), ...prov },
    { accountId: lacteos.id, block: "VALUE", topic: "COMPATIBILITY", statement: "Les importa que el repuesto resista la limpieza CIP", evidence: "Recovery de sellos EPDM → FKM en octubre", observedAt: d(-20), sourceType: "INTERNAL", sourceRef: "Journey sellos bomba CIP", confidence: "VERIFIED", capturedByName: by },
    { accountId: lacteos.id, plantId: tuluaId, block: "OPERATE", statement: "Tres turnos, seis días por semana; la parada mayor es en enero", observedAt: d(-40), ...prov },
    { accountId: lacteos.id, plantId: tuluaId, block: "HURT", statement: "Una parada de la UHT 1 obliga a desviar leche a otra planta", observedAt: d(-28), ...prov },
  ] });
  const pump = await tx.installedAsset.create({ data: { plantId: tuluaId, process: "Limpieza CIP", line: "CIP 1", name: "Bomba centrífuga sanitaria de CIP", manufacturer: "Alfa Laval", model: "LKH-20", operationalRole: "Impulsa la soda caliente en la limpieza de la UHT", redundancy: "NONE", critical: true, criticalWhy: "Sin CIP no se puede limpiar ni arrancar la UHT", knownComponents: "Sellos mecánicos FKM", observedAt: d(-25), sourceType: "VISIT", sourceRef: "Visita técnica", confidence: "VERIFIED", capturedByName: by } });
  await tx.installedAsset.createMany({ data: [
    { plantId: tuluaId, process: "Pasteurización y UHT", line: "UHT 1", name: "Transmisores de presión del pasteurizador", manufacturer: "Siemens", model: "SITRANS P 7MF0340", redundancy: "PARTIAL", observedAt: d(-90), sourceType: "INTERNAL", sourceRef: "Journey transmisores pasteurizador", confidence: "VERIFIED", capturedByName: by },
    { plantId: tuluaId, process: "Pasteurización y UHT", line: "UHT 1", name: "Homogeneizador", manufacturer: "SKF", model: "Rodamientos 6310 (por confirmar)", operationalRole: "Homogeniza la leche antes del tratamiento UHT", redundancy: "UNKNOWN", observedAt: d(-8), sourceType: "CONVERSATION", sourceRef: "Jorge Pérez", confidence: "INFERRED", capturedByName: by },
  ] });
  await tx.impactProfile.create({ data: { plantId: tuluaId, assetId: pump.id, scope: "Línea UHT 1", stopsLine: "YES", timeToImpact: "Unas 4 horas con el tanque pulmón", level: "REPORTED", currency: "COP", costPerHourMin: 35000000, costPerHourMax: 50000000, basis: "«Una hora con la UHT parada nos cuesta entre 35 y 50 millones»", observedAt: d(-28), ...prov } });
  if (jorge) await tx.employment.create({ data: { contactId: jorge.id, accountId: lacteos.id, plantId: tuluaId, area: "Mantenimiento", role: "Jefe de mantenimiento", sourceType: "CONVERSATION", sourceRef: "Llamada", confidence: "VERIFIED", capturedByName: by } });
}

const M4_TITLE = "Repuestos de mantenimiento (pedidos recurrentes)";

/** Mercado M4 sample (§27 case 7): Siderúrgica agreed 45 days and lately pays in ~60, after paying near terms the year before. */
async function seedMarketM4(tx: Prisma.TransactionClient, d: (n: number) => Date, ids: { siderId: string; ownerId: string; ownerName: string; treasurerId: string }) {
  await tx.account.update({ where: { id: ids.siderId }, data: { paymentTermsDays: 45 } });
  const dl = await tx.deal.create({ data: { title: M4_TITLE, accountId: ids.siderId, ownerId: ids.ownerId, stage: "WON", createdAt: d(-490), desiredResult: "Repuestos de mantenimiento a tiempo para cada parada", resultState: "ACHIEVED", actualResult: "Cada pedido llegó antes de su parada", resultConfirmedAt: d(-30), resultConfirmedByName: ids.ownerName, closedAt: d(-20), closedByName: ids.ownerName, closureSummary: "Pedidos recurrentes entregados y cobrados.", closureNoSignalReason: "Sin necesidad nueva declarada" } });
  const rows: [issued: number, paidAfter: number, amount: number, promise?: number][] = [[-480, 47, 2400], [-420, 50, 3100], [-360, 46, 1800], [-170, 62, 2900], [-130, 64, 3400], [-95, 60, 2200, 60]];
  for (const [issued, paidAfter, amount, promise] of rows) {
    const inv = await tx.invoice.create({ data: { number: await nextDocNumber(tx), dealId: dl.id, accountId: ids.siderId, amount, esagraAtIssue: Math.round(amount * 0.25), issuedAt: d(issued), dueAt: d(issued + 45), issuedById: ids.ownerId, syncState: "CONFIRMED", externalSystem: "QuickBooks", externalId: `QB-M4${-issued}`, syncAt: d(issued) } });
    if (promise) await tx.paymentPromise.create({ data: { invoiceId: inv.id, promisedFor: d(issued + promise), promisedBy: "Sandra Gómez (Tesorería)", source: "Llamada", recordedById: ids.ownerId, createdAt: d(issued + 50) } });
    await tx.customerPayment.create({ data: { accountId: ids.siderId, amount, receivedAt: d(issued + paidAfter), reference: `TRF M4${-issued}`, createdById: ids.ownerId, reconciledAt: d(issued + paidAfter + 1), reconciledById: ids.treasurerId, applications: { create: [{ invoiceId: inv.id, amount }] } } });
  }
}

/** Mercado M5 sample: what we remember about Jorge Pérez and the commitments still open with him. */
async function seedMarketM5(tx: Prisma.TransactionClient, d: (n: number) => Date, by: string, lacteosId: string) {
  const jorge = await tx.contact.findFirst({ where: { accountId: lacteosId, firstName: "Jorge" }, select: { id: true } });
  if (!jorge) return;
  const prov = { contactId: jorge.id, sourceType: "CONVERSATION", sourceRef: "Llamada con Jorge Pérez", confidence: "REPORTED", capturedByName: by };
  await tx.personNote.createMany({ data: [
    { kind: "DECISION_ROLE", statement: "Define la referencia técnica exacta; Compras no cambia lo que él especifica", observedAt: d(-40), ...prov },
    { kind: "VALUES", statement: "Que el repuesto llegue antes de la parada, aunque cueste más", evidence: "«Prefiero pagar el flete aéreo a parar la UHT un día»", observedAt: d(-28), ...prov },
    { kind: "OBJECTIVE", statement: "Llegar a la parada de enero con todos los repuestos en planta", observedAt: d(-10), ...prov },
    { kind: "PROBLEM", statement: "La soda cáustica del CIP daña los sellos EPDM", evidence: "Recovery de sellos de octubre", observedAt: d(-21), ...prov, sourceType: "INTERNAL", sourceRef: "Journey sellos bomba CIP", confidence: "VERIFIED" },
    { kind: "PREFERENCE", statement: "Prefiere WhatsApp para temas urgentes y correo para fichas técnicas", observedAt: d(-25), ...prov },
  ] });
  // Jorge was the person on the Lácteos Journeys, and the commitments below came from a call with him.
  await tx.deal.updateMany({ where: { accountId: lacteosId, contactId: null }, data: { contactId: jorge.id } });
  const paola = await tx.user.findFirst({ where: { name: by }, select: { id: true } });
  if (paola) await tx.activity.create({ data: { type: "CALL", subject: "Llamada sobre la parada de enero", body: "Quedamos en enviarle la ficha de los sellos FKM; él nos pasa la lista de repuestos de la parada.", userId: paola.id, contactId: jorge.id, accountId: lacteosId, occurredAt: d(-9) } });
  await tx.openLoop.createMany({ data: [
    { side: "OURS", what: "Enviar la ficha técnica de los sellos FKM para la bomba CIP 2", dueAt: d(-2), accountId: lacteosId, contactId: jorge.id, sourceType: "CONVERSATION", sourceRef: "Llamada con Jorge Pérez", observedAt: d(-9), capturedByName: by },
    { side: "THEIRS", what: "Lista de repuestos de la parada de enero", dueAt: d(30), accountId: lacteosId, contactId: jorge.id, sourceType: "CONVERSATION", sourceRef: "Llamada con Jorge Pérez", observedAt: d(-9), capturedByName: by },
  ] });
}

/** Mercado M6 sample (§25 step 13): a conversation reveals a concrete difficulty with a Siemens drive before the shutdown. */
async function seedMarketM6(tx: Prisma.TransactionClient, d: (n: number) => Date, by: string, lacteosId: string) {
  const jorge = await tx.contact.findFirst({ where: { accountId: lacteosId, firstName: "Jorge" }, select: { id: true } });
  if (!jorge) return;
  await tx.personNote.create({ data: { contactId: jorge.id, kind: "PROBLEM", statement: "El variador Siemens SINAMICS G120C de la bomba de alimentación de la UHT 1 se dispara por sobretemperatura y quieren resolverlo antes de la parada de enero", evidence: "«Si ese variador se cae en plena producción, paramos la UHT»", sourceType: "CONVERSATION", sourceRef: "Llamada con Jorge Pérez", confidence: "REPORTED", observedAt: d(-2), capturedByName: by } });
  const tulua = await tx.plant.findFirst({ where: { accountId: lacteosId, name: "Planta Tuluá" }, select: { id: true } });
  if (tulua) await tx.installedAsset.create({ data: { plantId: tulua.id, process: "Pasteurización y UHT", line: "UHT 1", name: "Variador de la bomba de alimentación", manufacturer: "Siemens", model: "SINAMICS G120C 6SL3210-1KE21-7UF1", operationalRole: "Controla la bomba que alimenta la UHT", redundancy: "NONE", critical: true, criticalWhy: "Si se detiene, la UHT se queda sin alimentación", observedAt: d(-2), sourceType: "CONVERSATION", sourceRef: "Llamada con Jorge Pérez", confidence: "REPORTED", capturedByName: by } });
}

/** Comercial C1 sample: the Papeles del Sur dosing-pump draft gets a scope matrix with an open question. */
const C1_TITLE = "Bombas dosificadoras";
async function seedComercialC1(tx: Prisma.TransactionClient, d: (n: number) => Date, by: string) {
  const deal = await tx.deal.findFirst({ where: { title: C1_TITLE, account: { isDemo: true } }, select: { id: true, quotes: { select: { number: true }, take: 1 } } });
  if (!deal || (await tx.scopeLine.count({ where: { dealId: deal.id } }))) return;
  const pump = await tx.scopeLine.create({ data: { dealId: deal.id, position: 0, component: "Bomba dosificadora de diafragma 30 l/h", code: "DDA-30", qty: 3, family: "BOMBA", requested: true, requiredForFunction: true, status: "INCLUDED", identity: "PROBABLE", condition: "NEW", source: `Cotización ${deal.quotes[0]?.number ?? ""}`.trim(), createdByName: by } });
  await tx.scopeLine.create({ data: { dealId: deal.id, position: 1, component: "Controlador con entrada 4–20 mA", qty: 3, requested: false, requiredForFunction: true, status: "TO_CONFIRM", identity: "UNKNOWN", note: "La solución promete control por señal 4–20 mA; no sabemos si la planta ya tiene el controlador", source: "Solución de la cotización", createdByName: by } });
  await tx.technicalFact.createMany({ data: [
    { dealId: deal.id, scopeLineId: pump.id, key: "flow", value: "30 l/h", state: "CONFIRMED", source: "Ficha técnica del proveedor (ejemplo)", recordedByName: by, createdAt: d(-3) },
    { dealId: deal.id, scopeLineId: pump.id, key: "head", value: "10 bar", state: "REPORTED", source: "Marta León por teléfono", recordedByName: by, createdAt: d(-2) },
  ] });
  const rel = { fromKey: "DDA30", kind: "REQUIRES", toKey: "kit de inyeccion y valvula de pie" };
  if (!(await tx.productRelationship.count({ where: { ...rel, supersededAt: null } }))) await tx.productRelationship.create({ data: { ...rel, fromLabel: "DDA-30", toLabel: "Kit de inyección y válvula de pie", evidence: "Manual del fabricante, sección de instalación (ejemplo)", recordedByName: by } });
}

/** Comercial C3 sample: ready goods (one with a customer-side blocker), invoice steps (one rejected, one not accepted),
 *  a partly kept promise replaced by a new one, and Lácteos' payment map. The credit request is added after (it needs live figures). */
async function seedComercialC3(tx: Prisma.TransactionClient, d: (n: number) => Date, ids: { paolaId: string; paolaName: string }) {
  if (await tx.cashBlocker.count({ where: { deal: { account: { isDemo: true } } } })) return;
  const T = d(0);
  const cap = (x: Date) => (x > T ? T : x);
  const dealBy = (title: string) => tx.deal.findFirst({ where: { title, account: { isDemo: true } }, include: { shipments: true, invoices: true, account: { select: { id: true } } } });
  // Entregar: arrived at our warehouse and cleared.
  const sid = await dealBy("Acoples para laminador");
  const pap = await dealBy("Válvulas de control caldera 2");
  for (const [dl, days] of [[sid, 6], [pap, 4]] as const) {
    const sh = dl?.shipments.find((x) => !x.toCustomer && !x.deliveryId);
    if (sh) await tx.shipment.update({ where: { id: sh.id }, data: { deliveredAt: d(-days), customs: "CLEARED", deliveredNote: "Llegó a nuestra bodega (ejemplo)" } });
  }
  if (sid) await tx.cashBlocker.create({ data: {
    dealId: sid.id, stage: "DELIVER", shipmentId: sid.shipments.find((x) => !x.toCustomer)?.id ?? null, readyAt: d(-6), blockedSince: d(-4), blockedValue: sid.amount,
    reasonCode: "receiving_appointment", rootCause: "CUSTOMER", narrative: "Almacén de Siderúrgica no da cita de recepción hasta que cierre su inventario semanal.", evidence: "Correo de Almacén del 6-nov (ejemplo)",
    responsibleId: ids.paolaId, nextMovement: "Confirmar la cita de recepción con Almacén", expectedResolution: d(1), createdByName: ids.paolaName,
  } });
  // Invoice steps: one rejected, one submitted and not accepted, one accepted.
  const step = (invoiceId: string, kind: string, at: Date, extra: { reference?: string; reason?: string } = {}) => tx.invoiceStep.create({ data: { invoiceId, kind, at: cap(at), byName: ids.paolaName, ...extra } });
  const rej = (await dealBy("Repuestos bomba de lodos"))?.invoices[0];
  if (rej) { await step(rej.id, "SUBMITTED", addDays(rej.issuedAt, 1), { reference: "RAD-55102" }); await step(rej.id, "REJECTED", addDays(rej.issuedAt, 6), { reason: "El número de OC en la factura no coincide con la entrada de mercancía (ejemplo)" }); }
  const sub = (await dealBy("Bombas de agua de enfriamiento horno (principal + respaldo)"))?.invoices[0];
  if (sub) { await step(sub.id, "SUBMITTED", addDays(sub.issuedAt, 1), { reference: "Portal SN-4471" }); await step(sub.id, "RECEIVED", addDays(sub.issuedAt, 2)); }
  const ok = (await dealBy("Sellos mecánicos bomba CIP"))?.invoices[0];
  if (ok) { await step(ok.id, "SUBMITTED", addDays(ok.issuedAt, 1)); await step(ok.id, "ACCEPTED", addDays(ok.issuedAt, 3)); }
  // Promise with an amount, partly kept, then replaced by a new one (history is kept).
  const flo = await dealBy("Bomba dosificadora de floculante");
  const fi = flo?.invoices[0];
  if (flo && fi) {
    const p1 = await tx.paymentPromise.create({ data: { invoiceId: fi.id, promisedFor: d(-1), promisedBy: "Luz Marina Ríos (ejemplo)", promisedByRole: "Tesorería", amount: fi.amount, source: "Llamada: «sale en la corrida del lunes» (ejemplo)", recordedById: ids.paolaId, createdAt: d(-6) } });
    await tx.customerPayment.create({ data: { accountId: flo.account.id, amount: 2000, receivedAt: d(-1), reference: "TRF-C3-ejemplo", reconciledAt: new Date(), createdById: ids.paolaId, applications: { create: [{ invoiceId: fi.id, amount: 2000 }] } } });
    const p2 = await tx.paymentPromise.create({ data: { invoiceId: fi.id, promisedFor: d(5), promisedBy: "Luz Marina Ríos (ejemplo)", promisedByRole: "Tesorería", amount: subMoney(fi.amount, 2000), source: "Correo: el saldo sale en la próxima corrida (ejemplo)", recordedById: ids.paolaId } });
    await tx.paymentPromise.update({ where: { id: p1.id }, data: { replacedById: p2.id, replacedAt: new Date() } });
  }
  // Lácteos: who receives and pays, and how.
  const lac = await tx.account.findFirst({ where: { isDemo: true, name: "Lácteos del Valle" + TAG }, select: { id: true, contacts: { select: { id: true }, take: 1 } } });
  if (lac && !(await tx.paymentMap.count({ where: { accountId: lac.id } }))) await tx.paymentMap.create({ data: {
    accountId: lac.id, process: "La factura se carga al portal de proveedores; Mantenimiento confirma la entrada de mercancía y Contabilidad la aprueba (ejemplo).",
    portal: "Portal de proveedores Lácteos (ejemplo)", payDays: "Viernes; corte de facturas el día 25", documents: "Factura + remisión firmada + número de entrada", updatedByName: ids.paolaName,
    people: lac.contacts[0] ? { create: [{ role: "RECEIVES", contactId: lac.contacts[0].id }, { role: "VALIDATES", contactId: lac.contacts[0].id }] } : undefined,
  } });
}

/** Comercial C5 sample: the Papeles del Sur dosing-pump Journey gets a Solution Case decided by a committee, two routes,
 *  two claims with evidence for this case and one hypothesis without evidence (it stays out of the proposal, AC12). */
async function seedComercialC5(tx: Prisma.TransactionClient, d: (n: number) => Date, by: string) {
  const deal = await tx.deal.findFirst({ where: { title: C1_TITLE, account: { isDemo: true } }, select: { id: true } });
  if (!deal || (await tx.solutionCase.count({ where: { dealId: deal.id } }))) return;
  if (!(await tx.valueAttribute.count())) await tx.valueAttribute.createMany({ data: VALUE_SEED.map((v) => ({ ...v, status: "DRAFT", updatedByName: "SOLU (borrador inicial del spec)" })), skipDuplicates: true });
  const attr = async (key: string) => (await tx.valueAttribute.findUnique({ where: { key }, select: { id: true } }))!.id;
  await tx.solutionCase.create({ data: {
    dealId: deal.id,
    understood: "La máquina 2 dosifica químicos a mano y la concentración varía entre turnos; quieren dosificación estable controlada por la señal 4–20 mA del DCS (ejemplo).",
    operationalImpact: "Reprocesos de papel fuera de especificación cuando la dosificación se desvía (ejemplo).",
    routes: [
      { kind: "OEM", label: "3 bombas DDA-30 + controlador 4–20 mA, conjunto completo", note: "Funciona con la señal del DCS desde el primer día" },
      { kind: "PARTIAL", label: "Solo las 3 bombas; el controlador lo pone la planta", note: "Más rápido y menor inversión, si la planta ya tiene el controlador" },
    ],
    risks: "No está confirmado si la planta ya tiene el controlador 4–20 mA (ejemplo).",
    recommendation: "Conjunto completo: evita que la dosificación dependa de un componente que no sabemos si existe (ejemplo).",
    decisionNeeded: "Que el comité elija conjunto completo o solo bombas antes del próximo comité de compras (ejemplo).",
    helpToBuy: "Sí: Marta pidió ayuda para presentarlo al comité (ejemplo).",
    committee: true, updatedByName: by,
    claims: { create: [
      { attributeId: await attr("SPEED"), need: "Dosificación estable en la máquina 2", impact: "Reprocesos mientras sigan dosificando a mano", advantage: "Bombas en stock con el distribuidor: 5–7 días después del pago, frente a 6 semanas del fabricante", benefit: "La máquina 2 deja de depender de la dosificación manual este mes", evidence: "Correo del distribuidor con stock de 3 unidades y cotización del fabricante a 6 semanas (ejemplo)", evidenceAt: d(-2), audience: "MAINTENANCE", createdByName: by },
      { attributeId: await attr("WARRANTY_SUPPORT"), need: "Respaldo si una bomba falla", advantage: "24 meses de garantía confirmados en la proforma del conjunto completo", benefit: "Compras no asume el riesgo de una falla temprana", evidence: "Proforma PF-2611 del proveedor del conjunto: 24 meses de garantía (ejemplo)", evidenceAt: d(-1), audience: "PURCHASING", createdByName: by },
      { attributeId: await attr("EXPERIENCE"), need: "Confianza en la instalación", advantage: "Siempre resolvemos este tipo de dosificación", benefit: "Menos riesgo de arranque", audience: "MANAGEMENT", createdByName: by },
    ] },
  } });
}
/** Comercial C6 sample: ABC's open PO also brings a new condition (documents) and states the legal entity and VAT,
 *  so the comparison shows a NEW_CONDITION to review and accept with a note. */
async function seedComercialC6(tx: Prisma.TransactionClient) {
  const po = await tx.customerPO.findFirst({ where: { number: "ABC-PO-7902", deal: { account: { isDemo: true } }, acceptance: null }, select: { id: true, documents: true } });
  if (!po || po.documents) return;
  await tx.customerPO.update({ where: { id: po.id }, data: { legalEntity: "ABC Foods S.A.S. (ejemplo)", ivaMode: "ADDED", documents: "Certificado de origen y remisión firmada con el número de entrada de mercancía (ejemplo)" } });
}
/** Comercial C4 sample: on the Papeles del Sur dosing-pump draft, two supplier options that are NOT equivalent in scope
 *  (pumps only vs pumps + 4–20 mA controller), card vs wire, a saved search, and the DDA-30 logistics passport with a
 *  measured-vs-reported learning and a dated import precedent. No supply basis: choosing is left to the person. */
async function seedComercialC4(tx: Prisma.TransactionClient, d: (n: number) => Date, by: string) {
  const deal = await tx.deal.findFirst({ where: { title: C1_TITLE, account: { isDemo: true } }, select: { id: true, scopeLines: { select: { id: true, code: true } } } });
  if (!deal || (await tx.supplyOption.count({ where: { dealId: deal.id } }))) return;
  const [us, es] = await Promise.all([
    tx.supplier.findFirst({ where: { isDemo: true, name: "Distribuidor Industrial A" + TAG }, select: { id: true } }),
    tx.supplier.findFirst({ where: { isDemo: true, name: "Bombas Ibérica" + TAG }, select: { id: true } }),
  ]);
  if (!us || !es) return;
  const pump = deal.scopeLines.find((l) => l.code === "DDA-30");
  const ctrl = deal.scopeLines.find((l) => l.code !== "DDA-30");
  const ev = (src: string, at: Date, keys: string[]) => Object.fromEntries(keys.map((k) => [k, { src, at: at.toISOString() }]));
  const a = await tx.supplyOption.create({ data: {
    dealId: deal.id, supplierId: us.id, label: "3 × bomba DDA-30 (solo bombas, sin controlador)", covers: pump ? [pump.id] : [], currency: "USD", price: 10200, qty: 3, stockQty: 3,
    leadDaysMin: 5, leadDaysMax: 7, leadTrigger: "al confirmar el pago", validUntil: d(20), condition: "Nuevo y original", warranty: "12 meses", incoterm: "FCA Miami", pickup: "Miami, FL 33166, USA",
    origin: "Alemania", grossKg: 8.1, dims: "60x40x30", packages: 1, excludedNote: "Controlador 4–20 mA y kit de inyección", availability: "QUOTE", importFeasibility: "CONDITIONAL", importNote: "Supone nacionalización normal; sin vistos buenos especiales conocidos (ejemplo)",
    evidence: ev("Correo de ventas Distribuidor Industrial A (ejemplo)", d(-2), ["price", "qty", "stockQty", "leadDaysMin", "leadDaysMax", "leadTrigger", "validUntil", "condition", "warranty", "incoterm", "pickup", "origin", "grossKg", "dims", "packages", "excludedNote", "covers"]),
    recordedByName: by, createdAt: d(-2),
    paymentOptions: { create: [
      { method: "WIRE", surchargePct: 0, fixedFee: 35, fxSpreadPct: 0, daysToRelease: 3, releaseTrigger: "cuando el dinero se acredita", confirmed: true, source: "Mismo correo (ejemplo)" },
      { method: "CARD", surchargePct: 4, fixedFee: 0, fxSpreadPct: 0, daysToRelease: 0, releaseTrigger: "al aprobar el cargo", confirmed: true, source: "Mismo correo (ejemplo)" },
    ] },
  } });
  await tx.supplyOption.create({ data: {
    dealId: deal.id, supplierId: es.id, label: "3 × bomba DDA-30 + controlador con entrada 4–20 mA", covers: [pump?.id, ctrl?.id].filter(Boolean) as string[], currency: "EUR", price: 11900, qty: 3,
    leadDaysMin: 15, leadDaysMax: 20, leadTrigger: "después del anticipo", validUntil: d(30), condition: "Nuevo y original", warranty: "24 meses", incoterm: "EXW Valencia", origin: "España",
    includedNote: "Bombas, controlador y cableado de señal", availability: "QUOTE", importFeasibility: "NEEDS_REVIEW",
    evidence: ev("Proforma PF-2611 de Bombas Ibérica (ejemplo)", d(-1), ["price", "qty", "leadDaysMin", "leadDaysMax", "leadTrigger", "validUntil", "condition", "warranty", "incoterm", "origin", "includedNote", "covers"]),
    recordedByName: by, createdAt: d(-1),
    paymentOptions: { create: [{ method: "WIRE", surchargePct: null, fixedFee: 25, fxSpreadPct: null, daysToRelease: null, releaseTrigger: "anticipo del 50 %", confirmed: false, source: "Proforma (no dice cargos bancarios) (ejemplo)" }] },
  } });
  await tx.sourcingSearch.create({ data: { dealId: deal.id, query: "bomba dosificadora 30 l/h", sources: ["CATALOG", "HISTORY", "OFFERS"], candidates: [{ mpn: "DDA-30", brand: "Grundfos", score: 92 }], discarded: [{ mpn: "DDA-15", reason: "15 l/h: no alcanza el caudal de 30 l/h (ejemplo)" }], recordedByName: by, createdAt: d(-3) } });
  const part = await tx.part.findUnique({ where: { mpnKey: "DDA30" }, select: { id: true } });
  if (part && !(await tx.logisticsObservation.count({ where: { partId: part.id } }))) {
    await tx.logisticsObservation.createMany({ data: [
      { partId: part.id, supplierId: us.id, qtyContext: 1, grossKg: 2.4, lengthCm: 35, widthCm: 25, heightCm: 25, packages: 1, origin: "Alemania", hsSupplier: "8413.50", status: "SUPPLIER_REPORTED", source: "Cotización anterior del proveedor (ejemplo)", observedAt: d(-200), recordedByName: by },
      { partId: part.id, qtyContext: 1, grossKg: 3.1, packages: 1, status: "RECEIPT_MEASURED", source: "Báscula de la bodega Miami al recibir (ejemplo)", observedAt: d(-185), recordedByName: by },
    ] });
    await tx.importExperience.create({ data: { partId: part.id, productLabel: "DDA-30 · Bomba dosificadora de diafragma", hsCode: "8413.50 (ejemplo)", hsCriterion: "Agente aduanero (ejemplo); revisar vigencia", documents: "Factura comercial, lista de empaque, guía aérea", approvals: "Sin vistos buenos especiales en esa ocasión", realCostUsd: 410, days: 6, delays: "1 día por inspección documental", resolution: "Se aclaró la descripción en la factura comercial", importedAt: d(-180), recordedByName: by } });
  }
  void a;
}

/** Open credit request for Minera El Roble, with the exposure frozen as of today. */
async function seedCreditRequestC3(paolaId: string) {
  const min = await db.account.findFirst({ where: { isDemo: true, name: "Minera El Roble" + TAG }, select: { id: true, paymentTermsDays: true } });
  if (!min || (await db.creditReviewRequest.count({ where: { accountId: min.id } }))) return;
  const [c] = await loadCredit({ id: min.id });
  const deal = await db.deal.findFirst({ where: { accountId: min.id, title: "Kit de bomba de lodos" }, select: { id: true } });
  await db.creditReviewRequest.create({ data: {
    accountId: min.id, dealId: deal?.id ?? null, kind: "INCREASE", requestedLimit: 25000, reason: "El kit de bomba de lodos queda bloqueado por cupo; la Minera tiene un paro programado y lo necesita antes (ejemplo).",
    info: "Paga con retraso pero ha cumplido sus promesas recientes.", alternatives: ["PRIOR_PAYMENT", "SPLIT_ORDER"], requestedById: paolaId,
    snapshot: { limit: c?.limit ?? null, used: c?.used ?? 0, openInvoices: c?.openInvoices ?? 0, committed: c?.uninvoiced ?? 0, available: c?.available ?? null, overdue: 0, overdueCount: c?.overdueCount ?? 0, termsDays: min.paymentTermsDays, expectedDays: null, avgDelay: null, payN: 0, trend: "UNKNOWN", promisesKept: 0, promisesBroken: 0, blocking: [] },
  } });
}

/** Environments loaded before Mercado existed get only the Mercado sample, nothing else is touched. */
async function topUpMarketDemo() {
  const paola = await db.user.findUnique({ where: { email: `paola${DEMO_DOMAIN}` }, select: { id: true, name: true } });
  if (!paola) return;
  const [lacteos, pacifico] = await Promise.all(["Lácteos del Valle", "Alimentos del Pacífico"].map((n) => db.account.findFirst({ where: { isDemo: true, name: n + TAG }, select: { id: true, name: true } })));
  if (!lacteos || !pacifico) return;
  const T = today();
  const d = (n: number) => addDays(T, n);
  if (!(await db.exploration.count({ where: { ownerId: paola.id } }))) {
    await db.$transaction((tx) => seedMarketDemo(tx, d, paola, lacteos, pacifico), { timeout: 30000 });
    return;
  }
  // Mercado M1 sample already there: add only the M2 part if missing.
  const tulua = await db.plant.findFirst({ where: { accountId: lacteos.id, name: "Planta Tuluá" }, select: { id: true } });
  if (tulua && !(await db.accountInsight.count({ where: { accountId: lacteos.id } }))) await db.$transaction((tx) => seedMarketM2(tx, d, paola.name, lacteos, tulua.id), { timeout: 30000 });
  // M4 sample if missing.
  const sider = await db.account.findFirst({ where: { isDemo: true, name: "Siderúrgica del Norte" + TAG }, select: { id: true } });
  const diana = await db.user.findUnique({ where: { email: `diana${DEMO_DOMAIN}` }, select: { id: true } });
  if (sider && diana && !(await db.deal.count({ where: { accountId: sider.id, title: M4_TITLE } }))) {
    await db.$transaction((tx) => seedMarketM4(tx, d, { siderId: sider.id, ownerId: paola.id, ownerName: paola.name, treasurerId: diana.id }), { timeout: 30000 });
    for (const a of await db.account.findMany({ where: { isDemo: true }, select: { id: true } })) await refreshPaymentBehaviorSafe(a.id, "Datos de ejemplo cargados");
  }
  // M5 sample if missing.
  if (!(await db.personNote.count({ where: { contact: { accountId: lacteos.id } } }))) await db.$transaction((tx) => seedMarketM5(tx, d, paola.name, lacteos.id), { timeout: 30000 });
  // M6 sample if missing.
  if (!(await db.personNote.count({ where: { kind: "PROBLEM", sourceType: "CONVERSATION", contact: { accountId: lacteos.id } } }))) await db.$transaction((tx) => seedMarketM6(tx, d, paola.name, lacteos.id), { timeout: 30000 });
  // Comercial C1 sample if missing.
  if (!(await db.scopeLine.count({ where: { deal: { title: C1_TITLE, account: { isDemo: true } } } }))) await db.$transaction((tx) => seedComercialC1(tx, d, paola.name), { timeout: 30000 });
  // Comercial C3 sample if missing.
  if (!(await db.cashBlocker.count({ where: { deal: { account: { isDemo: true } } } }))) await db.$transaction((tx) => seedComercialC3(tx, d, { paolaId: paola.id, paolaName: paola.name }), { timeout: 30000 });
  await seedCreditRequestC3(paola.id);
  // Comercial C4 sample if missing.
  if (!(await db.supplyOption.count({ where: { deal: { account: { isDemo: true } } } }))) await db.$transaction((tx) => seedComercialC4(tx, d, paola.name), { timeout: 30000 });
  // Comercial C5 sample if missing.
  if (!(await db.solutionCase.count({ where: { deal: { account: { isDemo: true } } } }))) await db.$transaction((tx) => seedComercialC5(tx, d, paola.name), { timeout: 30000 });
  // Comercial C6 sample if missing.
  await db.$transaction((tx) => seedComercialC6(tx), { timeout: 30000 });
}

const NAMEPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="320" viewBox="0 0 520 320"><rect width="520" height="320" fill="#8a9097"/><rect x="20" y="20" width="480" height="280" rx="10" fill="#d9dde1" stroke="#5c636a" stroke-width="3"/><circle cx="42" cy="42" r="7" fill="#9aa1a8"/><circle cx="478" cy="42" r="7" fill="#9aa1a8"/><circle cx="42" cy="278" r="7" fill="#9aa1a8"/><circle cx="478" cy="278" r="7" fill="#9aa1a8"/><text x="60" y="78" font-family="Arial" font-weight="700" font-size="30" fill="#0f9d9a">SIEMENS</text><text x="60" y="112" font-family="Arial" font-size="20" fill="#222">SINAMICS G120C</text><text x="60" y="150" font-family="Courier New" font-size="18" fill="#222">6SL3210-1KE21-7UF1</text><text x="60" y="184" font-family="Arial" font-size="16" fill="#222">IN: 3AC 380-480V 50/60Hz 18,5A</text><text x="60" y="210" font-family="Arial" font-size="16" fill="#222">OUT: 3AC 0-480V 16,5A 7,5kW</text><text x="60" y="236" font-family="Arial" font-size="14" fill="#444">S/N: XAJ2-7781-0042  IP20</text><text x="60" y="262" font-family="Arial" font-size="12" fill="#666">Made in Germany</text></svg>`;

export async function removeDemo() {
  const demoUsers = await db.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true } });
  const ids = demoUsers.map((u) => u.id);
  await db.$transaction(
    async (tx) => {
      await tx.needDismissal.deleteMany({ where: { accountId: { in: (await tx.account.findMany({ where: { isDemo: true }, select: { id: true } })).map((a) => a.id) } } });
      await tx.contact.deleteMany({ where: { account: { isDemo: true } } });
      await tx.account.deleteMany({ where: { isDemo: true } });
      await tx.supplier.deleteMany({ where: { isDemo: true } });
      await tx.productFact.deleteMany({ where: { recordedByName: { endsWith: TAG } } });
      await tx.productSignal.deleteMany({ where: { reportedByName: { endsWith: TAG } } });
      await tx.productRelationship.deleteMany({ where: { recordedByName: { endsWith: TAG } } });
      await tx.logisticsObservation.deleteMany({ where: { recordedByName: { endsWith: TAG } } });
      await tx.importExperience.deleteMany({ where: { recordedByName: { endsWith: TAG } } });
      // Mercado sample data (explorations cascade to links, gaps and tasks).
      await tx.marketSignal.deleteMany({ where: { capturedByName: { endsWith: TAG } } });
      await tx.knowledgeGap.deleteMany({ where: { createdByName: { endsWith: TAG } } });
      await tx.whiteSpace.deleteMany({ where: { createdByName: { endsWith: TAG } } });
      await tx.futureOpportunity.deleteMany({ where: { capturedByName: { endsWith: TAG } } });
      await tx.plant.deleteMany({ where: { capturedByName: { endsWith: TAG } } });
      if (ids.length) await tx.exploration.deleteMany({ where: { ownerId: { in: ids } } });
      if (ids.length) {
        await tx.task.deleteMany({ where: { assigneeId: { in: ids } } });
        await tx.cashBlocker.deleteMany({ where: { responsibleId: { in: ids } } });
        await tx.creditReviewRequest.deleteMany({ where: { requestedById: { in: ids } } });
        await tx.creditReviewRequest.updateMany({ where: { decidedById: { in: ids } }, data: { decidedById: null } });
        await tx.commissionEntry.deleteMany({ where: { OR: [{ userId: { in: ids } }, { approvedById: { in: ids } }] } });
        await tx.supplier.updateMany({ where: { bankVerifiedById: { in: ids } }, data: { bankVerifiedById: null } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      }
    },
    { timeout: 60000 },
  );
}
