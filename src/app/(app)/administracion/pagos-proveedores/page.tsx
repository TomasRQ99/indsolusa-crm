import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { loadSupplierPayments } from "@/lib/queries";
import { paymentStateLabel } from "@/lib/labels";
import type { PaymentState } from "@/lib/domain";

const ORDER: PaymentState[] = ["VERIFY", "APPROVE", "EXECUTE", "DONE"];

export default async function SupplierPaymentsPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const rows = await loadSupplierPayments();

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Administración", "Administration")}</div>
          <h1>{t("Pagos a proveedores", "Supplier payments")}</h1>
          <p>{t("Cada pago muestra por qué debe moverse el dinero. Si los datos bancarios difieren del perfil verificado, se detiene hasta una verificación independiente.", "Every payment shows why the money must move. If bank data differs from the verified profile, it stops until independently verified.")}</p>
        </div>
      </div>
      <section className="sum">
        {ORDER.map((s) => {
          const g = rows.filter((r) => r.state === s);
          return <div key={s}><span className="k">{paymentStateLabel(i, s).text}</span><span className="v">{g.length}</span></div>;
        })}
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Proveedor", "Supplier")}</th><th>{t("Por qué", "Why")}</th><th className="n">{t("Monto", "Amount")}</th><th>{t("Pagar antes de", "Pay by")}</th><th>{t("Estado", "State")}</th><th /></tr></thead>
          <tbody>
            {ORDER.map((s) => {
              const g = rows.filter((r) => r.state === s);
              if (!g.length) return null;
              return [
                <tr className="grpr" key={s}><td colSpan={6}>{paymentStateLabel(i, s).text} <span>· {g.length}</span></td></tr>,
                ...g.map((p) => {
                  const l = paymentStateLabel(i, p.state);
                  return (
                    <tr key={p.id}>
                      <td><b>{p.supplierPo.supplier.name}</b><span className="src">{p.supplierPo.code} · <Link href={`/deals/${p.supplierPo.deal.id}`}>{p.supplierPo.deal.code}</Link> · {p.supplierPo.deal.account.name}</span></td>
                      <td className="small">{p.reason}</td>
                      <td className="n val">{p.currency} {i.n2(p.amount)}</td>
                      <td>{i.dateShort(p.dueBy)}</td>
                      <td><span className={`sig ${l.cls}`}>{l.text}</span></td>
                      <td className="n"><Link className="btn secondary sm" href={`/administracion/pagos-proveedores/${p.id}`}>{t("Abrir", "Open")}</Link></td>
                    </tr>
                  );
                }),
              ];
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("No hay pagos a proveedores", "No supplier payments")}</b>{t("Se preparan desde la Supplier PO de un Journey.", "They are prepared from a Journey's supplier PO.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
