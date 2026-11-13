import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import type { RfqItem } from "@/lib/rfq";
import { resendRecipient, setRecipientStatus } from "../../ofertas/actions";
import { partKey } from "@/lib/parts";
import { supplierEvidence } from "@/lib/supplier-evidence";
import { SupplierEvidenceLine } from "@/components/SupplierEvidenceLine";
import { syncRepliesQuietly } from "@/lib/mail-replies";

export default async function RfqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  await syncRepliesQuietly(); // E2: notice email replies (throttled, read-only)
  const rfq = await db.rfq.findUnique({
    where: { id },
    include: { deal: { select: { id: true, code: true, title: true } }, recipients: { orderBy: { supplier: { name: "asc" } }, include: { supplier: { select: { id: true, name: true } }, doc: { select: { id: true, reference: true, fileName: true } } } } },
  });
  if (!rfq) notFound();
  const items = rfq.items as RfqItem[];
  const offers = await db.supplierOffer.findMany({
    where: { partId: { in: items.map((x) => x.partId) }, supplierId: { in: rfq.recipients.map((r) => r.supplierId) }, createdAt: { gte: rfq.createdAt } },
    orderBy: { unitPrice: "asc" },
    select: { id: true, partId: true, supplierId: true, unitPrice: true, currency: true, qty: true, leadText: true, leadDaysMin: true, leadDaysMax: true, validUntil: true, incoterm: true, docId: true, supplier: { select: { name: true } } },
  });
  const now = new Date();
  const sev = await supplierEvidence(rfq.recipients.map((r) => r.supplierId), { partKeys: items.map((x) => partKey(x.mpn)) });
  const label: Record<string, string> = { SENT: t("enviada · esperando", "sent · waiting"), FAILED: t("no se pudo enviar", "couldn't send"), ANSWERED: t("respondió", "answered"), DECLINED: t("no cotiza", "won't quote"), UNCERTAIN: t("sin confirmar · SOLU revisa Enviados", "unconfirmed · SOLU checks Sent Items"), SENDING: t("enviando…", "sending…") };
  const answered = rfq.recipients.filter((r) => r.status === "ANSWERED" || (r.repliedAt && r.status !== "DECLINED")).length;

  return (
    <div className="jw x3">
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/localizar">{t("Localizar repuestos", "Find parts")}</Link></p>
          <span className="jid mono">{rfq.code}</span>
          <span className="grow" />
          {rfq.deal && <Link className="link small" href={`/deals/${rfq.deal.id}?tab=source`}>{t("Ir a la Necesidad", "Open Necessity")} {rfq.deal.code}</Link>}
        </div>
        <div className="jh-title"><h1>{items.map((x) => `${x.qty} × ${x.mpn}`).join(" · ")}</h1></div>
        <p className="jh-sub">{t(`enviada por ${rfq.createdByName} el ${i.day(rfq.createdAt)}`, `sent by ${rfq.createdByName} on ${i.day(rfq.createdAt)}`)}{rfq.neededBy ? t(` · respuesta antes del ${i.day(rfq.neededBy)}`, ` · answer by ${i.day(rfq.neededBy)}`) : ""} · {t(`${answered} de ${rfq.recipients.length} respondieron`, `${answered} of ${rfq.recipients.length} answered`)}</p>
      </header>
      {sp.ok === "correo" && <p className="note okn">{t("Correo enviado desde la cuenta de la empresa.", "Email sent from the company account.")}</p>}
      {sp.ok === "enviada" && <p className="note">{t(`Solicitud enviada. Te dejé un pendiente para revisar respuestas en 2 días hábiles. Cuando llegue la cotización o proforma, súbela con “Registrar respuesta”.`, `Request sent. I left you a to-do to check answers in 2 working days. When the quote or proforma arrives, upload it with “Record answer”.`)}</p>}

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("PROVEEDORES", "SUPPLIERS")}</b><span className="grow" /><Link className="src" href="/correo/respuestas">{t("respuestas por correo", "email replies")}</Link></div>
        <table>
          <thead><tr><th>{t("Proveedor", "Supplier")}</th><th>{t("Estado", "Status")}</th><th>{t("Respuesta", "Answer")}</th><th /></tr></thead>
          <tbody>{rfq.recipients.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/suppliers/${r.supplier.id}`}>{r.supplier.name}</Link><span className="src block">{r.email}</span></td>
              <td><span className={`loc-chip${r.status === "FAILED" || r.status === "UNCERTAIN" ? " warn" : ""}`}>{label[r.status] ?? r.status}</span>{r.sentAt && <span className="src block">{i.day(r.sentAt)}</span>}{r.error && <span className="src block">{r.error}</span>}{r.repliedAt && r.status === "SENT" && <span className="rp-chip">{t(`respondió por correo · ${i.day(r.repliedAt)}`, `replied by email · ${i.day(r.repliedAt)}`)}</span>}</td>
              <td>{r.doc ? <Link href={`/localizar/ofertas/${r.doc.id}`}>{r.doc.reference ?? r.doc.fileName}</Link> : "—"}</td>
              <td className="loc-rowacts">
                {r.status !== "ANSWERED" && <Link className="link small" href={`/localizar/ofertas/nueva?rfqr=${r.id}`}>{t("Registrar respuesta", "Record answer")}</Link>}
                {r.status === "SENT" && <Link className="link small" href={`/correo/nuevo?tpl=FOLLOWUP&id=${r.id}`}>{t("Recordar", "Follow up")}</Link>}
                {r.status === "SENT" && <form action={setRecipientStatus.bind(null, r.id)}><input type="hidden" name="status" value="DECLINED" /><button className="link small" type="submit">{t("No cotiza", "Won't quote")}</button></form>}
                {r.status === "DECLINED" && <form action={setRecipientStatus.bind(null, r.id)}><input type="hidden" name="status" value="SENT" /><button className="link small" type="submit">{t("Deshacer", "Undo")}</button></form>}
                {r.status === "FAILED" && <form action={resendRecipient.bind(null, r.id)}><button className="link small" type="submit">{t("Reintentar envío", "Retry sending")}</button></form>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("OFERTAS RECIBIDAS", "OFFERS RECEIVED")}</b><span className="grow" /><span className="src">{t("por parte · de menor a mayor precio dentro de cada moneda · sin puntaje", "per part · lowest to highest price within each currency · no score")}</span></div>
        {items.map((it) => {
          const os = offers.filter((o) => o.partId === it.partId).sort((a, b) => a.currency.localeCompare(b.currency) || Number(a.unitPrice) - Number(b.unitPrice));
          return (
            <div key={it.partId} className="loc-cmp">
              <p><Link className="val mono" href={`/localizar/${it.partId}`}>{it.mpn}</Link> · {it.name} · <span className="src">{t(`pedimos ${it.qty}`, `we asked for ${it.qty}`)}</span></p>
              {os.length === 0 ? <p className="quiet-p">{t("Aún sin ofertas.", "No offers yet.")}</p> : (
                <table>
                  <thead><tr><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th>{t("Plazo", "Lead time")}</th><th>{t("Válida hasta", "Valid until")}</th><th>Incoterm</th></tr></thead>
                  <tbody>{os.map((o) => (
                    <tr key={o.id}>
                      <td>{o.supplier.name}{o.docId && <> · <Link className="small" href={`/localizar/ofertas/${o.docId}`}>{t("documento", "document")}</Link></>} · <Link className="small" href={`/correo/nuevo?tpl=NEGOTIATE&id=${o.id}`}>{t("Negociar", "Negotiate")}</Link><SupplierEvidenceLine ev={sev.get(o.supplierId)} t={t} /></td>
                      <td className="n mono">{o.currency} {i.n2(o.unitPrice)}{o.qty && o.qty !== it.qty ? <span className="src block">{t(`cotizó ${o.qty}`, `quoted ${o.qty}`)}</span> : null}</td>
                      <td>{o.leadText ?? (o.leadDaysMin != null ? `${o.leadDaysMin}–${o.leadDaysMax} d` : "—")}</td>
                      <td className={o.validUntil && o.validUntil < now ? "loc-expired" : undefined}>{o.validUntil ? i.day(o.validUntil) : "—"}{o.validUntil && o.validUntil < now ? ` · ${t("vencida", "expired")}` : ""}</td>
                      <td>{o.incoterm ?? "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          );
        })}
        <p className="src">{t("Ojo: comparar precios con distinto Incoterm no es comparar lo mismo (FCA Miami ≠ DAP Bogotá).", "Note: prices with different Incoterms aren't comparable as-is (FCA Miami ≠ DAP Bogotá).")}</p>
      </section>

      <details className="loc-preview"><summary>{t("Texto del correo (cada proveedor lo recibió con su nombre y en su idioma)", "Email text (each supplier got it with their name, in their language)")}</summary><p className="mono small"><b>{rfq.subject}</b></p><pre>{rfq.body}</pre></details>
    </div>
  );
}
