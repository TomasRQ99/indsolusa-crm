import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { refreshUnderstanding } from "./comm-store";
import { addDays, nextCode, nextDocNumber, today } from "./domain";

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
  if (await demoLoaded()) return;
  await ensureDefaultPolicy();
  const T = today();
  const d = (n: number) => addDays(T, n);
  const unusable = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  await db.$transaction(
    async (tx) => {
      const paola = await tx.user.upsert({
        where: { email: `paola${DEMO_DOMAIN}` },
        update: {},
        create: { email: `paola${DEMO_DOMAIN}`, name: `Paola Gómez${TAG}`, role: "REP", passwordHash: unusable },
      });
      const diana = await tx.user.upsert({
        where: { email: `diana${DEMO_DOMAIN}` },
        update: {},
        create: { email: `diana${DEMO_DOMAIN}`, name: `Diana Ruiz${TAG}`, role: "MANAGER", passwordHash: unusable },
      });

      const account = (name: string, extra: Partial<Prisma.AccountUncheckedCreateInput> = {}) =>
        tx.account.create({
          // Long-standing customers by default; only those with a recent createdAt count as new.
          data: { name: name + TAG, ownerId: paola.id, isDemo: true, taxDataComplete: true, industry: "Industria", createdAt: d(-700), ...extra },
        });

      const lacteos = await account("Lácteos del Valle", { creditLimit: 30000, address: "Planta Tuluá, Valle" });
      const sider = await account("Siderúrgica del Norte", { creditLimit: 40000, requiresReceptionCode: true });
      const cementos = await account("Cementos Andinos", { creditLimit: 50000, requiresPortal: true, portalValidUntil: d(-4) });
      const minera = await account("Minera El Roble", { creditLimit: 17000 });
      const ingenio = await account("Ingenio San Rafael", { creditLimit: 40000 });
      const pacifico = await account("Alimentos del Pacífico", { taxDataComplete: false, createdAt: d(-20) });
      const quimica = await account("Química Andina", { ownerId: adminId });
      const papeles = await account("Papeles del Sur", { ownerId: adminId });

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
      const siemens = await supplier("Distribuidor Siemens Miami", { country: "Estados Unidos", currency: "USD", phone: "+1 305 000 0000", bankBeneficiary: "Siemens Dist. LLC", bankName: "Bank of America", bankAccount: "000123456789", bankSwift: "BOFAUS3N", bankVerifiedAt: d(-200), bankVerifiedById: diana.id });
      const rodamientos = await supplier("Rodamientos Bogotá", { country: "Colombia", currency: "USD", phone: "+57 601 000 0000", bankBeneficiary: "Rodamientos Bogotá SAS", bankName: "Bancolombia", bankAccount: "1234-5678-90", bankSwift: "COLOCOBM", bankVerifiedAt: d(-120), bankVerifiedById: diana.id });
      const iberica = await supplier("Bombas Ibérica", { country: "España", currency: "EUR", phone: "+34 900 000 000" });
      const general = await supplier("Distribuidor Industrial A", { country: "Estados Unidos", currency: "USD", phone: "+1 786 000 0000", bankBeneficiary: "Industrial A Inc", bankName: "Chase", bankAccount: "987654321", bankSwift: "CHASUS33", bankVerifiedAt: d(-300), bankVerifiedById: diana.id });

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
      const spo = async (dealId: string, supplierId: string, amount: number, currency: string, extra: Partial<Prisma.SupplierPOUncheckedCreateInput> = {}) => {
        const code = await nextCode("SPO", "supplierPO", tx);
        return tx.supplierPO.create({ data: { code, dealId, supplierId, amount, currency, ...extra } });
      };

      // 1. Lácteos del Valle: pumps invoiced, payment received but not reconciled.
      const lac1 = await deal({ title: "Bombas centrífugas línea de pasteurización", amount: 6240, supplierCost: 4600, freightCost: 230, otherCosts: 100, accountId: lacteos.id, stage: "WON", customerPo: "4500-1877", poAcceptedAt: d(-40), desiredResult: "Pasteurizadora operando sin paradas", promiseText: "Bombas instaladas antes del cierre de mes", promisedDate: d(-28), waitingFor: "Que Tesorería concilie el pago", waitingUntil: d(2) });
      const lacItem = await tx.dealItem.create({ data: { dealId: lac1.id, qty: 2, code: "CPX-50", description: "Bomba centrífuga sanitaria 5 HP", unitPrice: 3120 } });
      await spo(lac1.id, general.id, 4600, "USD", { confirmedAt: d(-38), shippedAt: d(-35), receivedAt: d(-31) });
      const lacDel = await delivery(lac1.id, d(-28), [{ dealItemId: lacItem.id, qty: 2, serials: "CPX50-8812, CPX50-8813" }]);
      const lacInv = await invoice(lac1.id, lacteos.id, 6240, 1310, d(-27), 30, lacDel.id);
      await tx.customerPayment.create({ data: { accountId: lacteos.id, amount: 6240, receivedAt: d(-1), reference: "TRF 88231", createdById: adminId, applications: { create: [{ invoiceId: lacInv.id, amount: 6240 }] } } });

      // 2. Lácteos: transmitters, 4 of 6 delivered and ready to invoice; 2 in transit.
      const lac2 = await deal({ title: "Transmisores de presión Siemens", amount: 3600, supplierCost: 2600, freightCost: 200, otherCosts: 98, accountId: lacteos.id, stage: "WON", customerPo: "4500-1902", poAcceptedAt: d(-20), promiseText: "6 transmisores antes del 15", promisedDate: d(9) });
      const txItem = await tx.dealItem.create({ data: { dealId: lac2.id, qty: 6, code: "7MF0340", description: "Transmisor de presión Sitrans P", unitPrice: 600 } });
      await spo(lac2.id, siemens.id, 2600, "USD", { confirmedAt: d(-18), shippedAt: d(-2), eta: d(6) });
      await delivery(lac2.id, d(-1), [{ dealItemId: txItem.id, qty: 4, serials: "SP-1101…1104" }]);

      // 3. Siderúrgica: freight arrived after invoicing (esagra 19 % → 16 %); promise for Friday.
      const sid1 = await deal({ title: "Reductor para laminador", amount: 9800, supplierCost: 7640, freightCost: 290, otherCosts: 300, accountId: sider.id, stage: "WON", customerPo: "SN-77120", poAcceptedAt: d(-70), resultAchievedAt: d(-30) });
      const sidItem = await tx.dealItem.create({ data: { dealId: sid1.id, qty: 1, code: "RD-450", description: "Reductor helicoidal 450 kW", unitPrice: 9800 } });
      const sidDel = await delivery(sid1.id, d(-52), [{ dealItemId: sidItem.id, qty: 1 }], { receptionCode: "EM-55102" });
      const sidInv = await invoice(sid1.id, sider.id, 9800, 1860, d(-50), 30, sidDel.id);
      await tx.paymentPromise.create({ data: { invoiceId: sidInv.id, promisedFor: d(2), promisedBy: "Sandra Gómez (Tesorería)", source: "Llamada: \"queda programado para el viernes\"", recordedById: paola.id } });

      // 4. Siderúrgica: rollers delivered, invoice blocked by the goods-receipt code.
      const sid2 = await deal({ title: "Rodillos de transporte", amount: 5600, supplierCost: 4300, freightCost: 150, accountId: sider.id, stage: "WON", customerPo: "SN-77311", poAcceptedAt: d(-25), waitingFor: "Código de recepción de mercancía (Sandra)", waitingUntil: d(1) });
      const rodItem = await tx.dealItem.create({ data: { dealId: sid2.id, qty: 8, code: "RT-120", description: "Rodillo de transporte 120 mm", unitPrice: 700 } });
      await delivery(sid2.id, d(-6), [{ dealItemId: rodItem.id, qty: 8 }]);

      // 5. Cementos: broken payment promise; portal registration expired.
      const cem1 = await deal({ title: "Motorreductor molino de crudo", amount: 12380, supplierCost: 9500, freightCost: 400, otherCosts: 252, accountId: cementos.id, stage: "WON", customerPo: "CA-OC-2609-031", poAcceptedAt: d(-60) });
      const cemInv = await invoice(cem1.id, cementos.id, 12380, 2228, d(-45));
      await tx.paymentPromise.create({ data: { invoiceId: cemInv.id, promisedFor: d(-2), promisedBy: "A. Mejía (Tesorería)", source: "Correo: \"el pago sale el lunes\"", recordedById: paola.id } });

      // 6. Cementos: urgent bearing; supplier payment blocked by a bank change by email.
      const cem2 = await deal({ title: "Rodamiento 23148 molino", amount: 17900, supplierCost: 14200, freightCost: 600, accountId: cementos.id, stage: "WON", customerPo: "CA-OC-2611-058", poAcceptedAt: d(-3), desiredResult: "Molino andando antes del sábado", promiseText: "Molino andando antes del sábado", promisedDate: d(3) });
      await tx.dealItem.create({ data: { dealId: cem2.id, qty: 1, code: "23148 CC/W33", description: "Rodamiento de rodillos a rótula", unitPrice: 17900 } });
      const cemSpo = await spo(cem2.id, rodamientos.id, 17600, "USD", { confirmedAt: d(-2) });
      await tx.supplierPayment.create({ data: { supplierPoId: cemSpo.id, amount: 17600, currency: "USD", amountUsd: 17600, reason: "El proveedor despacha al confirmar el pago; el molino debe arrancar el sábado", dueBy: d(1), docBeneficiary: "Rodamientos Bogotá SAS", docBankName: "Banco de Bogotá", docAccount: "9988-7766-55", docSwift: "BBOGCOBB", docSource: "Correo del 4 nov: \"cambiamos de cuenta\"", requestedById: paola.id } });

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
      const ingSpo = await spo(ing.id, iberica.id, 8420, "EUR", { confirmedAt: d(-4) });
      await tx.supplierPayment.create({ data: { supplierPoId: ingSpo.id, amount: 8420, currency: "EUR", amountUsd: 9100, reason: "Fabricación arranca con el pago; la zafra empieza el 23", dueBy: d(2), docBeneficiary: "Bombas Ibérica S.L.", docBankName: "CaixaBank", docAccount: "ES12 2100 0000 0000 0000", docSwift: "CAIXESBB", docSource: "Proforma PF-2611-118", requestedById: paola.id, verifiedById: diana.id, verifiedAt: d(-1), verificationNote: "Llamada al teléfono registrado: confirmó beneficiario, banco e IBAN." } });
      await tx.supplier.update({ where: { id: iberica.id }, data: { bankBeneficiary: "Bombas Ibérica S.L.", bankName: "CaixaBank", bankAccount: "ES12 2100 0000 0000 0000", bankSwift: "CAIXESBB", bankVerifiedAt: d(-1), bankVerifiedById: diana.id } });

      // 10. Alimentos del Pacífico (new customer): delivered, invoice blocked by tax data.
      const pac = await deal({ title: "Sellos mecánicos envasadora", amount: 1870, supplierCost: 1300, freightCost: 140, accountId: pacifico.id, stage: "WON", customerPo: "ADP-0012", poAcceptedAt: d(-12) });
      const pacItem = await tx.dealItem.create({ data: { dealId: pac.id, qty: 4, code: "SM-35", description: "Sello mecánico 35 mm", unitPrice: 467.5 } });
      await delivery(pac.id, d(-3), [{ dealItemId: pacItem.id, qty: 4 }]);

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
      const abc = await account("ABC Foods", { ownerId: adminId, creditLimit: 60000, address: "Planta Funza, Cundinamarca", createdAt: d(-400) });
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
      });
      await tx.supplierPayment.create({ data: { supplierPoId: sjSpo.id, amount: 20400, currency: "USD", amountUsd: 20400, reason: "El distribuidor despacha contra pago", dueBy: d(-9), docBeneficiary: "Siemens Dist. LLC", docBankName: "Bank of America", docAccount: "000123456789", docSwift: "BOFAUS3N", docSource: "Proforma SIE-4471", requestedById: adminId, approvedById: diana.id, approvedAt: d(-9), executedById: diana.id, executedAt: d(-9), executedRef: "Wire 55120" } });
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

      await tx.task.createMany({
        data: [
          { title: "Preparar visita técnica a Química Andina", assigneeId: adminId, accountId: quimica.id, dealId: q1.id, dueDate: d(3), estimateMinutes: 90 },
          { title: "Revisar condiciones de pago con Minera", assigneeId: adminId, accountId: minera.id, dueDate: d(1), estimateMinutes: 30 },
          { title: "Actualizar lista de precios 2027", assigneeId: adminId, dueDate: d(20), estimateMinutes: 120 },
        ],
      });
    },
    { timeout: 60000 },
  );
  // SOLU reads the sample conversations once they exist.
  for (const th of await db.commThread.findMany({ where: { account: { isDemo: true } }, select: { id: true } })) await refreshUnderstanding(th.id);
}

const NAMEPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="320" viewBox="0 0 520 320"><rect width="520" height="320" fill="#8a9097"/><rect x="20" y="20" width="480" height="280" rx="10" fill="#d9dde1" stroke="#5c636a" stroke-width="3"/><circle cx="42" cy="42" r="7" fill="#9aa1a8"/><circle cx="478" cy="42" r="7" fill="#9aa1a8"/><circle cx="42" cy="278" r="7" fill="#9aa1a8"/><circle cx="478" cy="278" r="7" fill="#9aa1a8"/><text x="60" y="78" font-family="Arial" font-weight="700" font-size="30" fill="#0f9d9a">SIEMENS</text><text x="60" y="112" font-family="Arial" font-size="20" fill="#222">SINAMICS G120C</text><text x="60" y="150" font-family="Courier New" font-size="18" fill="#222">6SL3210-1KE21-7UF1</text><text x="60" y="184" font-family="Arial" font-size="16" fill="#222">IN: 3AC 380-480V 50/60Hz 18,5A</text><text x="60" y="210" font-family="Arial" font-size="16" fill="#222">OUT: 3AC 0-480V 16,5A 7,5kW</text><text x="60" y="236" font-family="Arial" font-size="14" fill="#444">S/N: XAJ2-7781-0042  IP20</text><text x="60" y="262" font-family="Arial" font-size="12" fill="#666">Made in Germany</text></svg>`;

export async function removeDemo() {
  const demoUsers = await db.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true } });
  const ids = demoUsers.map((u) => u.id);
  await db.$transaction(
    async (tx) => {
      await tx.contact.deleteMany({ where: { account: { isDemo: true } } });
      await tx.account.deleteMany({ where: { isDemo: true } });
      await tx.supplier.deleteMany({ where: { isDemo: true } });
      if (ids.length) {
        await tx.task.deleteMany({ where: { assigneeId: { in: ids } } });
        await tx.commissionEntry.deleteMany({ where: { OR: [{ userId: { in: ids } }, { approvedById: { in: ids } }] } });
        await tx.supplier.updateMany({ where: { bankVerifiedById: { in: ids } }, data: { bankVerifiedById: null } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      }
    },
    { timeout: 60000 },
  );
}
