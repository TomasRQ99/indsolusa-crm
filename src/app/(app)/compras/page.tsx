import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { makeI18n } from "@/lib/i18n";
import { paymentStateLabel } from "@/lib/labels";
import { buildSpo, spoInclude } from "@/lib/purchasing";

// Supplier POs grouped by what they need from us now. "Paid" only counts confirmed executions.
type Group = "DRAFT" | "STOPPED" | "OPEN" | "PAID";

export default async function ComprasPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const spos = await db.supplierPO.findMany({ include: spoInclude, orderBy: { createdAt: "desc" } });
  const rows = spos.map((spo) => {
    const B = buildSpo(spo, i);
    const stopped = B.plan.some((p) => p.st === "VERIFY" || p.st === "UNCERTAIN");
    const fullyPaid = B.plan.length > 0 && B.plan.every((p) => p.st === "DONE");
    const g: Group = !B.released ? "DRAFT" : stopped ? "STOPPED" : fullyPaid ? "PAID" : "OPEN";
    return { spo, B, g };
  });
  const groups: { g: Group; es: string; en: string }[] = [
    { g: "DRAFT", es: "Por liberar", en: "To release" },
    { g: "STOPPED", es: "Pagos detenidos", en: "Payments stopped" },
    { g: "OPEN", es: "En curso", en: "In progress" },
    { g: "PAID", es: "Pagadas (confirmado)", en: "Paid (confirmed)" },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Operaciones", "Operations")}</div>
          <h1>{t("Compras a proveedores", "Supplier purchasing")}</h1>
          <p>{t("Cada Supplier PO nace del Journey y protege una promesa al cliente. Aprobado o enviado al banco no es pagado: solo cuenta lo confirmado.", "Every supplier PO is born from a Journey and protects a customer promise. Approved or sent to the bank isn't paid: only confirmed counts.")}</p>
        </div>
      </div>
      <section className="sum">
        {groups.map((x) => <div key={x.g}><span className="k">{t(x.es, x.en)}</span><span className="v">{rows.filter((r) => r.g === x.g).length}</span></div>)}
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>Supplier PO</th><th>{t("Promesa que protege", "Promise it protects")}</th><th className="n">{t("Valor", "Value")}</th><th className="n">{t("Pagado (confirmado)", "Paid (confirmed)")}</th><th>{t("Hitos de pago", "Payment milestones")}</th><th /></tr></thead>
          <tbody>
            {groups.map((x) => {
              const g = rows.filter((r) => r.g === x.g);
              if (!g.length) return null;
              return [
                <tr className="grpr" key={x.g}><td colSpan={6}>{t(x.es, x.en)} <span>· {g.length}</span></td></tr>,
                ...g.map(({ spo, B }) => (
                  <tr key={spo.id}>
                    <td><b>{spo.supplier.name}</b><span className="src">{spo.code} v{spo.version} · <Link href={`/deals/${spo.deal.id}`}>{spo.deal.code}</Link> · {spo.deal.account.name}</span></td>
                    <td className="small">{spo.deal.promiseText ?? "—"}{spo.deal.promisedDate && <span className="src">{i.dateShort(spo.deal.promisedDate)}</span>}</td>
                    <td className="n val">{spo.currency} {i.n2(B.total)}</td>
                    <td className="n">{spo.currency} {i.n2(B.paidTotal)}</td>
                    <td className="small">
                      {!B.released ? <span className="sig dash">{t("Borrador · sin liberar", "Draft · not released")}</span>
                        : B.plan.length === 0 ? "—"
                        : B.plan.map(({ r, st }) => {
                          const l = st === "REQUIRED" ? { cls: "wait", text: t("Requerido", "Required") } : paymentStateLabel(i, st);
                          return <span key={r.id} className="block">{r.percent} % · <span className={`sig ${l.cls}`}>{l.text}</span></span>;
                        })}
                    </td>
                    <td className="n"><Link className="btn secondary sm" href={`/compras/${spo.id}`}>{t("Abrir", "Open")}</Link></td>
                  </tr>
                )),
              ];
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("No hay compras a proveedores", "No supplier purchases")}</b>{t("Se preparan con un clic desde la pestaña Ejecutar de un Journey con OC aceptada.", "They're prepared in one click from the Execute tab of a Journey with an accepted PO.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
