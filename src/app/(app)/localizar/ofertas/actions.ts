"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
import { describeMailError, mailConfig, sendMail } from "@/lib/mail";
import { brandIn, categoryIn } from "@/lib/part-lexicon";
import { partKey } from "@/lib/parts";
import { MAX_SUPPLIER_DOC_BYTES, bankCheck, parseLead, parseMoney, readSupplierDoc } from "@/lib/supplier-doc";
import { isUsCountry, rfqEmail, type RfqItem } from "@/lib/rfq";
import { spanishCountry } from "@/lib/company";

const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const num = (v: FormDataEntryValue | null) => {
  const n = parseMoney(String(v ?? "").trim());
  return n != null && n >= 0 && n < 1e12 ? n : null;
};
const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const CUR = (s: string | null) => (s && /^[A-Z]{3}$/.test(s.toUpperCase()) ? s.toUpperCase() : null);
function inWorkingDays(n: number) {
  const d = today();
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n--; }
  return d;
}

// ---------- Supplier quote / proforma ----------

/** Stores the supplier's document and reads it. The next screen shows what was read, to confirm before saving offers. */
export async function uploadSupplierDoc(fd: FormData) {
  const user = await requireUser();
  const recipientId = txt(fd, "rfqRecipientId", 40);
  const recipient = recipientId ? await db.rfqRecipient.findUnique({ where: { id: recipientId }, select: { id: true, supplierId: true, rfqId: true } }) : null;
  const supplierId = recipient?.supplierId ?? txt(fd, "supplierId", 40);
  const file = fd.get("file");
  const back = `/localizar/ofertas/nueva?${new URLSearchParams({ ...(supplierId ? { supplier: supplierId } : {}), ...(recipient ? { rfqr: recipient.id } : {}) })}`;
  if (!supplierId) redirect(`${back}&err=proveedor`);
  if (!(file instanceof File) || file.size === 0) redirect(`${back}&err=archivo`);
  const f = file as File;
  if (f.size > MAX_SUPPLIER_DOC_BYTES) redirect(`${back}&err=grande`);
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  if (!isPdf && !/^image\/(jpeg|png|webp)$/.test(f.type)) redirect(`${back}&err=tipo`);
  const supplier = await db.supplier.findUniqueOrThrow({ where: { id: supplierId! }, select: { id: true, country: true, currency: true, bankAccount: true, bankVerifiedAt: true } });
  const bytes = new Uint8Array(await f.arrayBuffer());
  const reading = isPdf
    ? await readSupplierDoc(bytes, { monthFirst: isUsCountry(supplier.country) }).catch(() => null)
    : null;
  const h = reading?.header;
  const doc = await db.supplierDoc.create({
    data: {
      supplierId: supplier.id, kind: h?.kind ?? (/proforma/i.test(f.name) ? "PROFORMA" : "QUOTE"),
      reference: h?.reference ?? null, issuedAt: dayOf(h?.issuedAt ?? null), validUntil: dayOf(h?.validUntil ?? null),
      currency: h?.currency ?? supplier.currency, incoterm: h?.incoterm ?? null, leadText: h?.leadText ?? null, paymentTerms: h?.paymentTerms ?? null,
      fileName: f.name.slice(0, 200), mime: isPdf ? "application/pdf" : f.type, size: f.size, data: Buffer.from(bytes),
      text: reading?.text ?? null,
      extracted: reading ? { readable: reading.readable, lines: reading.lines } : { readable: false, lines: [] },
      bankWarning: reading ? bankCheck(reading.bankNumbers, supplier.bankAccount, supplier.bankVerifiedAt) : null,
      rfqRecipientId: recipient?.id ?? null, createdByName: user.name,
    },
  });
  redirect(`/localizar/ofertas/${doc.id}`);
}

/** Confirms the reviewed lines: each becomes an offer for its part (new parts are added to the catalog). */
export async function saveSupplierDoc(docId: string, fd: FormData) {
  const user = await requireUser();
  const doc = await db.supplierDoc.findUniqueOrThrow({ where: { id: docId }, include: { offers: { select: { id: true } } } });
  const currency = CUR(txt(fd, "currency", 3)) ?? doc.currency ?? "USD";
  const validUntil = dayOf(fd.get("validUntil"));
  const incoterm = txt(fd, "incoterm", 60);
  const leadText = txt(fd, "leadText", 80);
  const n = Math.min(80, Number(fd.get("rows") ?? 0) || 0);
  const rows: { partId: string | null; code: string; description: string | null; qty: number | null; price: number; lead: string | null }[] = [];
  for (let i = 0; i < n; i++) {
    if (fd.get(`inc_${i}`) !== "1") continue;
    const code = txt(fd, `code_${i}`, 60);
    const price = num(fd.get(`price_${i}`));
    if (!code || price == null) continue;
    rows.push({ partId: txt(fd, `part_${i}`, 40), code, description: txt(fd, `desc_${i}`, 300), qty: num(fd.get(`qty_${i}`)), price, lead: txt(fd, `lead_${i}`, 80) });
  }
  if (!rows.length) redirect(`/localizar/ofertas/${docId}?err=lineas`);
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.supplierDoc.update({
      where: { id: docId },
      data: { kind: fd.get("kind") === "PROFORMA" ? "PROFORMA" : "QUOTE", reference: txt(fd, "reference", 60), issuedAt: dayOf(fd.get("issuedAt")), validUntil, currency, incoterm, leadText, paymentTerms: txt(fd, "paymentTerms", 120), reviewedAt: new Date() },
    });
    // Saving again replaces this document's previous offers.
    await tx.supplierOffer.deleteMany({ where: { docId } });
    for (const r of rows) {
      let partId = r.partId;
      if (partId && !(await tx.part.findUnique({ where: { id: partId }, select: { id: true } }))) partId = null;
      if (!partId) {
        const key = partKey(r.code);
        const existing = (await tx.part.findUnique({ where: { mpnKey: key }, select: { id: true, mergedIntoId: true } })) ?? (await tx.partAlias.findFirst({ where: { codeKey: key, kind: { not: "NAME" } }, select: { partId: true } }).then((a) => (a ? { id: a.partId, mergedIntoId: null } : null)));
        if (existing) partId = existing.mergedIntoId ?? existing.id;
        else {
          const name = r.description ?? r.code;
          const p = await tx.part.create({ data: { mpn: r.code, mpnKey: key, name, brand: brandIn(name) ?? null, category: categoryIn(name) ?? null, createdByName: `${user.name} (desde ${doc.kind === "PROFORMA" ? "proforma" : "cotización"} de proveedor)` } });
          partId = p.id;
        }
      }
      const lead = parseLead(r.lead ?? leadText);
      await tx.supplierOffer.create({
        data: {
          partId, supplierId: doc.supplierId, docId, codeAsQuoted: r.code, description: r.description, qty: r.qty != null ? Math.round(r.qty) : null,
          unitPrice: r.price, currency, leadDaysMin: lead.min, leadDaysMax: lead.max, leadText: r.lead ?? leadText, validUntil, incoterm,
          source: `${doc.kind === "PROFORMA" ? "Proforma" : "Cotización"} ${txt(fd, "reference", 60) ?? doc.fileName}`, recordedByName: user.name,
        },
      });
      created.push(partId);
    }
    if (doc.rfqRecipientId) await tx.rfqRecipient.update({ where: { id: doc.rfqRecipientId }, data: { status: "ANSWERED", answeredAt: new Date() } });
  });
  refreshApp();
  redirect(`/localizar/ofertas/${docId}?ok=guardado&n=${created.length}`);
}

export async function deleteSupplierDoc(docId: string) {
  const user = await requireUser();
  const doc = await db.supplierDoc.findUniqueOrThrow({ where: { id: docId }, select: { createdByName: true, rfqRecipientId: true } });
  if (!canManageAll(user) && doc.createdByName !== user.name) redirect(`/localizar/ofertas/${docId}?err=permiso`);
  await db.$transaction([
    db.supplierOffer.deleteMany({ where: { docId } }),
    ...(doc.rfqRecipientId ? [db.rfqRecipient.update({ where: { id: doc.rfqRecipientId }, data: { status: "SENT", answeredAt: null } })] : []),
    db.supplierDoc.delete({ where: { id: docId } }),
  ]);
  refreshApp();
  redirect("/localizar?ok=docborrado");
}

// ---------- Offers typed by hand (phone call, email text) ----------

export async function addOffer(partId: string, fd: FormData) {
  const user = await requireUser();
  const supplierId = txt(fd, "supplierId", 40);
  const price = num(fd.get("unitPrice"));
  if (!supplierId || price == null) redirect(`/localizar/${partId}?err=oferta`);
  const p = await db.part.findUniqueOrThrow({ where: { id: partId }, select: { mpn: true } });
  const leadText = txt(fd, "leadText", 80);
  const lead = parseLead(leadText);
  await db.supplierOffer.create({
    data: {
      partId, supplierId: supplierId!, codeAsQuoted: txt(fd, "codeAsQuoted", 60) ?? p.mpn, qty: num(fd.get("qty")) != null ? Math.round(num(fd.get("qty"))!) : null,
      unitPrice: price!, currency: CUR(txt(fd, "currency", 3)) ?? "USD", leadDaysMin: lead.min, leadDaysMax: lead.max, leadText,
      validUntil: dayOf(fd.get("validUntil")), incoterm: txt(fd, "incoterm", 60), source: txt(fd, "source", 200) ?? "Registrada a mano", recordedByName: user.name,
    },
  });
  refreshApp();
  redirect(`/localizar/${partId}?ok=oferta`);
}

export async function removeOffer(partId: string, offerId: string) {
  const user = await requireUser();
  const o = await db.supplierOffer.findUniqueOrThrow({ where: { id: offerId }, select: { partId: true, recordedByName: true } });
  if (o.partId !== partId || (!canManageAll(user) && o.recordedByName !== user.name)) redirect(`/localizar/${partId}?err=permiso`);
  await db.supplierOffer.delete({ where: { id: offerId } });
  refreshApp();
  redirect(`/localizar/${partId}?ok=ofertaquitada`);
}

// ---------- RFQ: one email per supplier, from sales@ ----------

export async function createRfq(fd: FormData) {
  const user = await requireUser();
  const partIds = fd.getAll("partId").map(String).filter(Boolean).slice(0, 30);
  const supplierIds = [...new Set(fd.getAll("supplierId").map(String).filter(Boolean))].slice(0, 25);
  const dealId = txt(fd, "dealId", 40);
  const back = `/localizar/rfq/nueva?${new URLSearchParams([...partIds.map((p) => ["part", p]), ...(dealId ? [["deal", dealId]] : [])])}`;
  if (!partIds.length) redirect(`${back}&err=partes`);
  if (!supplierIds.length) redirect(`${back}&err=proveedores`);
  const cfg = mailConfig();
  if (!cfg.configured && process.env.MAIL_DRY_RUN !== "1") redirect(`${back}&err=correo`);
  const [parts, suppliers, deal] = await Promise.all([
    db.part.findMany({ where: { id: { in: partIds } }, select: { id: true, mpn: true, name: true, nameEn: true, brand: true } }),
    db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, email: true, country: true } }),
    dealId ? db.deal.findUnique({ where: { id: dealId }, select: { id: true, accountId: true } }) : null,
  ]);
  const items: RfqItem[] = partIds.map((id) => parts.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ partId: p.id, mpn: p.mpn, name: p.name, nameEn: p.nameEn, brand: p.brand, qty: Math.max(1, Math.round(num(fd.get(`qty_${p.id}`)) ?? 1)) }));
  const withEmail = suppliers.filter((s) => s.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email));
  if (!withEmail.length) redirect(`${back}&err=sincorreo`);
  const langPref = fd.get("lang");
  const neededBy = dayOf(fd.get("neededBy"));
  const notes = txt(fd, "notes", 800);
  const from = cfg.from ?? "sales@indsolusa.com";
  const preview = rfqEmail({ code: "RFQ", lang: langPref === "ES" ? "ES" : "EN", supplierName: "—", items, neededBy, notes, senderName: user.name, from });
  const rfq = await db.$transaction(async (tx) => {
    const code = await nextCode("RFQ", "rfq", tx);
    return tx.rfq.create({ data: { code, dealId: deal?.id ?? null, items, lang: langPref === "ES" ? "ES" : langPref === "EN" ? "EN" : "AUTO", neededBy, notes, subject: preview.subject, body: preview.text, createdById: user.id, createdByName: user.name } });
  });
  // One separate email per supplier (they never see each other). Language: chosen, or by country (Colombia → Spanish).
  for (const s of withEmail) {
    const lang = langPref === "ES" || langPref === "EN" ? langPref : spanishCountry(s.country) ? "ES" : "EN";
    const mail = rfqEmail({ code: rfq.code, lang, supplierName: s.name, items, neededBy, notes, senderName: user.name, from });
    let status = "SENT", error: string | null = null;
    try { await sendMail({ to: { address: s.email!, name: s.name }, subject: mail.subject, text: mail.text, html: mail.html, senderName: user.name }); }
    catch (e) { status = "FAILED"; error = describeMailError(e).slice(0, 300); }
    await db.rfqRecipient.create({ data: { rfqId: rfq.id, supplierId: s.id, email: s.email!, status, sentAt: status === "SENT" ? new Date() : null, error } });
  }
  const sent = await db.rfqRecipient.count({ where: { rfqId: rfq.id, status: "SENT" } });
  if (sent) {
    await db.task.create({ data: { title: `Revisar respuestas de ${rfq.code} (${items.map((i) => i.mpn).join(", ")})`.slice(0, 200), dueDate: inWorkingDays(2), assigneeId: user.id, dealId: deal?.id ?? null, accountId: deal?.accountId ?? null } });
    if (deal) await db.activity.create({ data: { type: "EMAIL", subject: `${rfq.code} enviada a ${sent} proveedor(es): ${items.map((i) => `${i.qty} × ${i.mpn}`).join(", ")}`.slice(0, 200), userId: user.id, accountId: deal.accountId, dealId: deal.id, phase: "source", source: "Localizar repuestos" } });
  }
  refreshApp();
  redirect(`/localizar/rfq/${rfq.id}?ok=enviada`);
}

export async function setRecipientStatus(recipientId: string, fd: FormData) {
  await requireUser();
  const status = fd.get("status") === "DECLINED" ? "DECLINED" : "SENT";
  const r = await db.rfqRecipient.update({ where: { id: recipientId }, data: { status, answeredAt: status === "DECLINED" ? new Date() : null } });
  refreshApp();
  redirect(`/localizar/rfq/${r.rfqId}`);
}

export async function resendRecipient(recipientId: string) {
  const user = await requireUser();
  const r = await db.rfqRecipient.findUniqueOrThrow({ where: { id: recipientId }, include: { rfq: true, supplier: { select: { name: true, email: true, country: true } } } });
  const email = r.supplier.email ?? r.email;
  const lang = r.rfq.lang === "ES" || r.rfq.lang === "EN" ? r.rfq.lang : spanishCountry(r.supplier.country) ? "ES" : "EN";
  const mail = rfqEmail({ code: r.rfq.code, lang, supplierName: r.supplier.name, items: r.rfq.items as RfqItem[], neededBy: r.rfq.neededBy, notes: r.rfq.notes, senderName: user.name, from: mailConfig().from ?? "sales@indsolusa.com" });
  try {
    await sendMail({ to: { address: email, name: r.supplier.name }, subject: mail.subject, text: mail.text, html: mail.html, senderName: user.name });
    await db.rfqRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), error: null, email } });
  } catch (e) {
    await db.rfqRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: describeMailError(e).slice(0, 300) } });
  }
  refreshApp();
  redirect(`/localizar/rfq/${r.rfqId}`);
}
