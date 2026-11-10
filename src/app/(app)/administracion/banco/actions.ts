"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { money2, sumMoney } from "@/lib/money";
import { CLASSES, matchState, parseBankCsv } from "@/lib/bank-csv";

// Operaciones O9a · bank statements (module 11 §42). Finanzas, Administración and management upload the bank's file
// and say what each movement is. SOLU suggests; a person confirms. A movement is never edited or invented.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const go = (qs: string): never => { refreshApp(); redirect(`/administracion/banco?${qs}`); };
async function finance() { const u = await requireUser(); if (!canFinance(u)) go("err=permiso"); return u; }

export async function saveBankAccount(fd: FormData) {
  const user = await finance();
  const label = txt(fd, "label", 80);
  if (!label) go("err=cuenta");
  // Only the last four digits are ever kept.
  const last4 = (String(fd.get("last4") ?? "").replace(/\D/g, "").slice(-4)) || null;
  await db.bankAccount.create({ data: { label: label!, bank: txt(fd, "bank", 60) ?? "Bank of America", last4, currency: (txt(fd, "currency", 3) ?? "USD").toUpperCase(), sellerKey: txt(fd, "sellerKey", 12) ?? "USA", createdByName: user.name } });
  go("ok=cuenta");
}

export async function uploadStatement(fd: FormData) {
  const user = await finance();
  const acc = await db.bankAccount.findFirst({ where: { id: String(fd.get("bankAccountId") ?? ""), active: true }, select: { id: true } });
  const f = fd.get("file");
  if (!acc) go("err=cuenta");
  if (!(f instanceof File) || f.size === 0 || f.size > 2 * 1024 * 1024 || !/\.(csv|txt)$/i.test(f.name)) go("err=archivo");
  const file = f as File;
  const p = parseBankCsv(await file.text());
  if (!p.ok) go(p.reason === "EMPTY" ? "err=vacio" : `err=columnas&vi=${encodeURIComponent(p.found.join(" · ").slice(0, 200))}`);
  if (!p.ok) return;
  if (!p.rows.length) go("err=sin-movimientos");
  const st = await db.$transaction(async (tx) => {
    const s = await tx.bankStatement.create({ data: { bankAccountId: acc!.id, fileName: file.name.slice(0, 160), periodFrom: p.from, periodTo: p.to, rowsRead: p.rows.length, added: 0, duplicates: 0, skipped: p.skipped.filter((x) => x.why !== "NO_AMOUNT").length, uploadedByName: user.name } });
    // A movement already loaded from an earlier, overlapping statement is recognised by its identity and not repeated.
    const r = await tx.bankTransaction.createMany({ data: p.rows.map((x) => ({ bankAccountId: acc!.id, statementId: s.id, date: x.date, amount: x.amount, description: x.description, reference: x.reference, balance: x.balance, fingerprint: x.fingerprint })), skipDuplicates: true });
    return tx.bankStatement.update({ where: { id: s.id }, data: { added: r.count, duplicates: p.rows.length - r.count } });
  });
  go(`ok=cargado&st=${st.id}`);
}

/** Take back an upload made by mistake. Only while nobody has worked on its movements. */
export async function undoStatement(id: string) {
  await finance();
  const used = await db.bankTransaction.count({ where: { statementId: id, OR: [{ matches: { some: {} } }, { classifiedAs: { not: null } }] } });
  if (used) go("err=deshacer");
  await db.$transaction([db.bankTransaction.deleteMany({ where: { statementId: id } }), db.bankStatement.delete({ where: { id } })]);
  go("ok=deshecho");
}

async function loadTx(id: string) {
  const t = await db.bankTransaction.findUnique({ where: { id }, include: { matches: { select: { amount: true } } } });
  if (!t) go("err=movimiento");
  const s = matchState(Number(t!.amount), sumMoney(t!.matches.map((m) => m.amount)), t!.classifiedAs);
  return { t: t!, open: s.open, state: s.state };
}

/** Money in ↔ a customer payment already recorded in SOLU. */
export async function matchCustomerPayment(txId: string, fd: FormData) {
  const user = await finance();
  const { t, open, state } = await loadTx(txId);
  const p = await db.customerPayment.findUnique({ where: { id: String(fd.get("paymentId") ?? "") }, include: { bankMatches: { select: { amount: true } } } });
  if (!p || p.kind !== "CASH" || Number(t.amount) <= 0 || state === "CLASSIFIED" || open <= 0.005) go("err=cruce");
  const free = money2(Number(p!.amount) - sumMoney(p!.bankMatches.map((m) => m.amount)));
  const amount = Math.min(open, free);
  if (amount <= 0.005) go("err=cruce");
  await db.bankMatch.create({ data: { transactionId: txId, customerPaymentId: p!.id, amount: money2(amount), createdByName: user.name } });
  go("ok=cruzado");
}

/** Money in that SOLU did not know about yet: record the customer payment straight from the bank movement. */
export async function createPaymentFromTx(txId: string, fd: FormData) {
  const user = await finance();
  const { t, open, state } = await loadTx(txId);
  const acc = await db.account.findFirst({ where: { id: String(fd.get("accountId") ?? ""), internal: false }, select: { id: true } });
  if (!acc || Number(t.amount) <= 0 || state === "CLASSIFIED" || open <= 0.005) go("err=cruce");
  await db.$transaction(async (tx) => {
    const p = await tx.customerPayment.create({ data: { accountId: acc!.id, amount: money2(open), receivedAt: t.date, reference: `${t.description}${t.reference ? ` · ${t.reference}` : ""}`.slice(0, 190), createdById: user.id } });
    await tx.bankMatch.create({ data: { transactionId: txId, customerPaymentId: p.id, amount: money2(open), createdByName: user.name } });
  });
  go("ok=pago-creado");
}

/** Money out ↔ a supplier payment sent from SOLU. The link is evidence; confirming the payment stays its own step. */
export async function matchExecution(txId: string, fd: FormData) {
  const user = await finance();
  const { t, open, state } = await loadTx(txId);
  const e = await db.paymentExecution.findUnique({ where: { id: String(fd.get("executionId") ?? "") }, include: { bankMatches: { select: { amount: true } } } });
  if (!e || Number(t.amount) >= 0 || state === "CLASSIFIED" || open <= 0.005 || e.state === "FAILED") go("err=cruce");
  const free = money2(Number(e!.amount) - sumMoney(e!.bankMatches.map((m) => m.amount)));
  const amount = Math.min(open, free);
  if (amount <= 0.005) go("err=cruce");
  await db.bankMatch.create({ data: { transactionId: txId, paymentExecutionId: e!.id, amount: money2(amount), createdByName: user.name } });
  go("ok=cruzado");
}

/** Not a customer or supplier payment: a transfer between own accounts, a bank fee or something else. Always with a note. */
export async function classifyTx(txId: string, fd: FormData) {
  const user = await finance();
  const { t } = await loadTx(txId);
  if (fd.get("clear") === "1") { await db.bankTransaction.update({ where: { id: txId }, data: { classifiedAs: null, classNote: null, classByName: null } }); go("ok=clasificado"); }
  const as = String(fd.get("as") ?? "");
  const note = txt(fd, "note");
  if (!CLASSES[as] || !note || t.matches.length) go("err=clasificar");
  await db.bankTransaction.update({ where: { id: txId }, data: { classifiedAs: as, classNote: note, classByName: user.name } });
  go("ok=clasificado");
}

export async function removeMatch(matchId: string) {
  await finance();
  await db.bankMatch.deleteMany({ where: { id: matchId } });
  go("ok=descruzado");
}
