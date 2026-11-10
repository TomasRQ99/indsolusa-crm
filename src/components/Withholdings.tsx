import { db } from "@/lib/db";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { sumMoney } from "@/lib/money";
import { WITHHOLDING_TYPES } from "@/lib/withholding";
import { recordWithholding, setWithholdingCertificate, voidWithholding } from "@/app/(app)/administracion/retenciones-actions";

// Operaciones O9b · withholdings of one customer (or of everyone): the history, what is missing a certificate, and
// the form to record a new one against an open invoice.

export async function Withholdings({ accountId, lang, canRecord, canVoid, open, heading = true }: { accountId: string | null; lang: "ES" | "EN"; canRecord: boolean; canVoid: boolean; open?: { id: string; number: string; balance: number }[]; heading?: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const rows = await db.customerPayment.findMany({ where: { kind: "WITHHOLDING", ...(accountId ? { accountId } : {}) }, orderBy: { receivedAt: "desc" }, take: 60, include: { account: { select: { name: true } }, applications: { select: { invoice: { select: { number: true } } } }, createdBy: { select: { name: true } } } });
  const byType = Object.keys(WITHHOLDING_TYPES).map((k) => ({ k, total: sumMoney(rows.filter((r) => r.withholdingType === k).map((r) => r.amount)) })).filter((x) => x.total > 0);
  const tn = (k: string | null) => (k && WITHHOLDING_TYPES[k] ? t(WITHHOLDING_TYPES[k].es, WITHHOLDING_TYPES[k].en) : "—");
  if (!rows.length && !(canRecord && open?.length)) return heading ? null : <p className="small muted">{t("Sin retenciones registradas.", "No withholdings recorded.")}</p>;

  return (
    <section className={heading ? "card" : undefined} id="retenciones">
      {heading && <b>{t("RETENCIONES", "WITHHOLDINGS")}</b>}
      <p className="small">{t("Lo que el cliente retiene al pagar. Baja lo que debe la factura, pero no es dinero recibido en el banco.", "What the customer withholds when paying. It lowers what the invoice owes, but it is not money received in the bank.")}</p>
      {byType.length > 0 && <p className="small mono">{byType.map((x) => `${tn(x.k)}: USD ${i.n2(x.total)}`).join(" · ")}</p>}
      {rows.length > 0 && (
        <div className="tscroll"><table>
          <thead><tr>{!accountId && <th>{t("Cliente", "Customer")}</th>}<th>{t("Fecha", "Date")}</th><th>{t("Tipo", "Type")}</th><th>{t("Factura", "Invoice")}</th><th className="n">USD</th><th>{t("Certificado", "Certificate")}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              {!accountId && <td className="small">{r.account.name}</td>}
              <td className="mono small">{i.day(r.receivedAt)}<span className="src block">{r.createdBy.name}</span></td>
              <td className="small">{tn(r.withholdingType)}{r.withholdingNote && <span className="src block">{r.withholdingNote}</span>}</td>
              <td className="mono small">{r.applications.map((a) => a.invoice.number).join(", ") || "—"}</td>
              <td className="n mono">{i.n2(Number(r.amount))}</td>
              <td className="small">{r.certificate ? <span className="mono">{r.certificate}</span> : canRecord ? (
                <form action={setWithholdingCertificate.bind(null, r.id)} className="qa-row"><input name="certificate" required maxLength={80} placeholder={t("N.º del certificado", "Certificate no.")} aria-label={t("Certificado", "Certificate")} style={{ minWidth: 120 }} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Guardar", "Save")}</button></form>
              ) : <span className="sig wait">{t("Pendiente", "Pending")}</span>}</td>
              <td>{canVoid && <form action={voidWithholding.bind(null, r.id)}><button type="submit" className="linkb">{t("anular", "void")}</button></form>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {canRecord && open && open.length > 0 && (
        <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Registrar retención", "+ Record withholding")}</summary>
          <form action={recordWithholding} className="qa-form" style={{ marginTop: 8, maxWidth: 640 }}>
            <div className="qa-row">
              <label>{t("Factura", "Invoice")}<select name="invoiceId">{open.map((o) => <option key={o.id} value={o.id}>{o.number} · {t("saldo", "balance")} {i.n2(o.balance)}</option>)}</select></label>
              <label>{t("Tipo", "Type")}<select name="type">{Object.entries(WITHHOLDING_TYPES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
            </div>
            <div className="qa-row">
              <label style={{ flex: "0 0 150px" }}>{t("Valor USD", "Amount USD")}<input name="amount" inputMode="decimal" required /></label>
              <label style={{ flex: "0 0 160px" }}>{t("Fecha", "Date")}<input name="date" type="date" defaultValue={dayInput(today())} /></label>
              <label>{t("Certificado (si ya lo tienes)", "Certificate (if you have it)")}<input name="certificate" maxLength={80} /></label>
            </div>
            <label>{t("Nota (obligatoria si es «otra deducción»)", "Note (required for \"other deduction\")")}<input name="note" maxLength={300} /></label>
            <button type="submit">{t("Registrar retención", "Record withholding")}</button>
          </form>
        </details>
      )}
    </section>
  );
}
