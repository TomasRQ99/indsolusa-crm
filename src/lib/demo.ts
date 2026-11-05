import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
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
          { firstName: "Juan", lastName: "Pérez", title: "Mantenimiento", email: "juan.perez@lacteos.example", accountId: lacteos.id },
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
}

export async function removeDemo() {
  const demoUsers = await db.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true } });
  const ids = demoUsers.map((u) => u.id);
  await db.$transaction(
    async (tx) => {
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
