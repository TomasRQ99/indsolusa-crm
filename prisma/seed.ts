import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// `prisma db seed` loads .env, so these come from there.
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "sales@indsolusa.com").toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const DEMO = process.env.SEED_DEMO === "true";

async function main() {
  const admin = await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: "IndSolUSA Sales",
      role: "GERENCIA",
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    },
  });
  console.log(`Admin login: ${ADMIN_EMAIL} (change the password after first sign-in).`);

  // Commission policy v1 (example values until the real policy is decided, D-06):
  // 50 % earned at the sale (invoice issued) and 50 % at collection (payment reconciled).
  if ((await db.commissionPolicy.count()) === 0) {
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
    console.log("Commission policy v1 created.");
  }

  if (!DEMO) return;
  if ((await db.account.count()) > 0) {
    console.log("Accounts already exist; skipping demo data.");
    return;
  }

  const demoHash = await bcrypt.hash("ChangeMe123!", 12);
  const manager = await db.user.upsert({
    where: { email: "demo.manager@example.com" },
    update: {},
    create: { email: "demo.manager@example.com", name: "Demo Manager", role: "DIRECTOR_COMERCIAL", passwordHash: demoHash },
  });
  const rep = await db.user.upsert({
    where: { email: "demo.rep@example.com" },
    update: {},
    create: { email: "demo.rep@example.com", name: "Demo Rep", role: "NEGOCIADOR_COMERCIAL", passwordHash: demoHash },
  });

  const acme = await db.account.create({
    data: {
      name: "Acme Industrial (demo)",
      industry: "Manufacturing",
      website: "https://acme.example",
      ownerId: rep.id,
      contacts: {
        create: [
          { firstName: "Jordan", lastName: "Lee", title: "VP Operations", email: "jordan.lee@acme.example" },
          { firstName: "Sam", lastName: "Patel", title: "Procurement Lead", email: "sam.patel@acme.example" },
        ],
      },
    },
    include: { contacts: true },
  });
  const globex = await db.account.create({
    data: {
      name: "Globex Logistics (demo)",
      industry: "Transportation",
      ownerId: manager.id,
      contacts: { create: [{ firstName: "Casey", lastName: "Nguyen", title: "CTO", email: "casey@globex.example" }] },
    },
    include: { contacts: true },
  });

  const deal = await db.deal.create({
    data: {
      title: "Acme plant-wide order",
      amount: 120000,
      stage: "PROPOSAL",
      closeDate: new Date(Date.now() + 30 * 864e5),
      accountId: acme.id,
      contactId: acme.contacts[0].id,
      ownerId: rep.id,
    },
  });
  await db.deal.createMany({
    data: [
      { title: "Acme service renewal", amount: 18000, stage: "NEGOTIATION", accountId: acme.id, ownerId: rep.id },
      { title: "Globex pilot", amount: 45000, stage: "QUALIFIED", accountId: globex.id, ownerId: manager.id },
    ],
  });
  await db.task.createMany({
    data: [
      { title: "Send revised quote", dueDate: new Date(Date.now() + 2 * 864e5), assigneeId: rep.id, accountId: acme.id, dealId: deal.id },
      { title: "Review pipeline", dueDate: new Date(Date.now() - 864e5), assigneeId: admin.id },
    ],
  });
  await db.activity.create({
    data: { type: "MEETING", subject: "Discovery meeting", userId: rep.id, accountId: acme.id, dealId: deal.id },
  });
  console.log("Demo data loaded (demo.manager@ / demo.rep@example.com, password ChangeMe123!).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
