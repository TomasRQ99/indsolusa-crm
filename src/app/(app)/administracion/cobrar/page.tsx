import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { addDays, dayInput, today } from "@/lib/domain";
import { loadReceivables, type ReceivableRow, type ReceivableState } from "@/lib/queries";
import { receivableLabel } from "@/lib/labels";
import { recordPromise } from "../actions";

const ORDER: ReceivableState[] = ["BROKEN", "NEEDS_ACTION", "RECEIVED_PENDING", "WAITING", "UPCOMING"];

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { f } = await searchParams;
  const now = today();
  const rows = await loadReceivables();
  const sel = rows.find((r) => r.id === f) ?? rows.find((r) => r.state === "BROKEN") ?? rows[0];
  const contacts = sel
    ? await db.contact.findMany({ where: { accountId: sel.account.id, email: { not: null } }, select: { firstName: true, lastName: true, email: true, title: true } })
    : [];

  const expected = (r: ReceivableRow) => (r.promise && r.promise.promisedFor >= now ? r.promise.promisedFor : r.dueAt >= now ? r.dueAt : null);
  const total = rows.reduce((s, r) => s + r.cash.balance, 0);
  const sumOf = (s: ReceivableState) => rows.filter((r) => r.state === s).reduce((x, r) => x + r.cash.balance, 0);
  const next14 = rows.filter((r) => { const e = expected(r); return e && e <= addDays(now, 14) && r.state !== "RECEIVED_PENDING"; }).reduce((s, r) => s + r.cash.balance, 0);

  const draft = sel
    ? encodeURIComponent(
        `Hola,\n\nEspero que estén muy bien. Les escribo sobre la factura ${sel.number} por ${i.money2(sel.cash.balance)}${sel.deal.customerPo ? ` (OC ${sel.deal.customerPo})` : ""}.` +
          (sel.promise ? ` Teníamos registrado que el pago llegaría el ${i.date(sel.promise.promisedFor)} y aún no lo vemos en el banco; puede que esté en camino.` : ` Venció el ${i.date(sel.dueAt)}.`) +
          `\n\n¿Nos ayudan a confirmar la fecha en que se programará el pago, o si hace falta algún documento de nuestra parte?\n\nMuchas gracias,\n${user.name}`,
      )
    : "";

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Administración", "Administration")}</div>
          <h1>{t("Cuentas por cobrar", "Receivables")}</h1>
          <p>{t("Orientado a lo que viene. Un pago recibido no cuenta como pagado hasta que Tesorería lo concilia.", "Forward-looking. A payment received doesn't count as paid until Treasury reconciles it.")}</p>
        </div>
        <div className="grow" />
        <Link className="btn secondary" href="/administracion/pagos-recibidos">{t("Registrar pago recibido", "Record payment received")}</Link>
      </div>

      <section className="sum">
        <div><span className="k">{t("Por cobrar", "Outstanding")}</span><span className="v">{i.n(total)}</span><span className="s">USD · {rows.length} {t("facturas", "invoices")}</span></div>
        <div><span className="k">{t("Compromiso incumplido", "Commitment missed")}</span><span className="v">{i.n(sumOf("BROKEN"))}</span><span className="s">{rows.filter((r) => r.state === "BROKEN").length} {t("facturas", "invoices")}</span></div>
        <div><span className="k">{t("Vencido sin promesa", "Overdue, no promise")}</span><span className="v">{i.n(sumOf("NEEDS_ACTION"))}</span></div>
        <div><span className="k">{t("Esperado en 14 días", "Expected in 14 days")}</span><span className="v">{i.n(next14)}</span><span className="s">{t("promesas y vencimientos", "promises and due dates")}</span></div>
        <div><span className="k">{t("Recibido, por conciliar", "Received, to reconcile")}</span><span className="v">{i.n(rows.reduce((s, r) => s + r.cash.pendingReconcile, 0))}</span><span className="s">{t("aún no es pagado", "not paid yet")}</span></div>
      </section>

      <div className="two">
        <div className="card flush">
          <table>
            <thead><tr><th>{t("Cliente · factura", "Customer · invoice")}</th><th className="n">{t("Saldo", "Balance")}</th><th>{t("Vence", "Due")}</th><th>{t("Prometió", "Promised")}</th><th>{t("Esperamos", "We expect")}</th><th>{t("Recibido", "Received")}</th></tr></thead>
            <tbody>
              {ORDER.map((s) => {
                const group = rows.filter((r) => r.state === s);
                if (!group.length) return null;
                const l = receivableLabel(i, s);
                return [
                  <tr className="grpr" key={s}><td colSpan={6}>{l.text} <span>· {group.length} · {i.money(group.reduce((x, r) => x + r.cash.balance, 0))}</span></td></tr>,
                  ...group.map((r) => {
                    const e = expected(r);
                    return (
                      <tr key={r.id} className={sel?.id === r.id ? "sel" : undefined}>
                        <td><Link href={`/administracion/cobrar?f=${r.id}`}><b>{r.account.name}</b></Link><span className="src mono">{r.number} · {r.deal.code}</span></td>
                        <td className="n val">{i.n2(r.cash.balance)}</td>
                        <td>{i.day(r.dueAt)}<span className="src">{t("factura", "invoice")}</span></td>
                        <td>{r.promise ? <>{i.day(r.promise.promisedFor)}<span className="src">{r.promise.promisedBy}</span></> : "—"}</td>
                        <td>{e ? <>{i.day(e)}<span className="src">{r.promise && e === r.promise.promisedFor ? t("según promesa", "per promise") : t("inferencia: vencimiento", "inferred: due date")}</span></> : <span className="src">{t("desconocido", "unknown")}</span>}</td>
                        <td>{r.lastReceived ? <>{i.day(r.lastReceived)}<span className="src">{r.cash.pendingReconcile > 0 ? t("por conciliar", "to reconcile") : t("conciliado", "reconciled")}</span></> : "—"}</td>
                      </tr>
                    );
                  }),
                ];
              })}
              {rows.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("No hay saldos por cobrar", "Nothing outstanding")}</b></td></tr>}
            </tbody>
          </table>
        </div>

        {sel && (
          <aside className="rail">
            <div className="card">
              <span className="k">{sel.account.name} · {sel.number}</span>
              <h2 style={{ marginTop: 6 }}>
                {sel.state === "BROKEN" && sel.promise
                  ? t(`No llegó el pago que ${sel.promise.promisedBy} prometió para el ${i.dateShort(sel.promise.promisedFor)}.`, `The payment ${sel.promise.promisedBy} promised for ${i.dateShort(sel.promise.promisedFor)} did not arrive.`)
                  : sel.state === "NEEDS_ACTION"
                    ? t(`Venció el ${i.dateShort(sel.dueAt)} y no hay una fecha de pago acordada.`, `Due ${i.dateShort(sel.dueAt)} with no agreed payment date.`)
                    : sel.state === "RECEIVED_PENDING"
                      ? t("Llegó un pago; falta que Tesorería lo concilie.", "A payment arrived; Treasury still needs to reconcile it.")
                      : receivableLabel(i, sel.state).text}
              </h2>
              <dl className="facts" style={{ margin: "10px 0" }}>
                <dt>{t("Saldo", "Balance")}</dt><dd className="mono">{i.money2(sel.cash.balance)}</dd>
                <dt>{t("Factura", "Invoice")}</dt><dd>{i.money2(sel.cash.amount)} · {i.date(sel.issuedAt)}</dd>
                <dt>Journey</dt><dd><Link href={`/deals/${sel.deal.id}`}>{sel.deal.code}</Link> · {t("OC", "PO")} {sel.deal.customerPo ?? "—"}</dd>
                <dt>{t("Responsable", "Owner")}</dt><dd>{sel.account.owner.name}</dd>
              </dl>
              {(sel.state === "BROKEN" || sel.state === "NEEDS_ACTION") && (
                <a className="btn wide" href={`mailto:${contacts.map((c) => c.email).join(",")}?subject=${encodeURIComponent(`Factura ${sel.number}`)}&body=${draft}`}>
                  {t("Preparar contacto con su Tesorería", "Prepare contact with their Treasury")}
                </a>
              )}
              {(sel.state === "BROKEN" || sel.state === "NEEDS_ACTION") && contacts.length === 0 && (
                <p className="src" style={{ marginTop: 6 }}>{t("Este cliente no tiene contactos con correo. Agrégalos en su ficha.", "This customer has no contacts with email. Add them on the customer record.")}</p>
              )}
              <details style={{ marginTop: 12 }}>
                <summary>{t("Registrar promesa de pago", "Record payment promise")}</summary>
                <form action={recordPromise.bind(null, sel.id)} className="stack">
                  <label>{t("Pagará el", "Will pay on")}<input name="promisedFor" type="date" required defaultValue={dayInput(addDays(now, 3))} /></label>
                  <label>{t("Quién lo dijo", "Who said it")}<input name="promisedBy" required placeholder={t("Nombre y cargo", "Name and role")} /></label>
                  <label>{t("Cómo y qué dijo (literal)", "How and what was said (verbatim)")}<input name="source" required placeholder={t("Llamada: \"lo programamos el viernes\"", "Call: \"scheduled for Friday\"")} /></label>
                  <button type="submit" className="secondary">{t("Registrar promesa", "Record promise")}</button>
                </form>
              </details>
              <Link className="btn secondary wide" style={{ marginTop: 10 }} href={`/administracion/pagos-recibidos?account=${sel.account.id}`}>{t("Registrar o conciliar pago", "Record or reconcile payment")}</Link>
            </div>
            {sel.promises.length > 0 && (
              <div className="card">
                <div className="bhead"><h2>{t("Historial de promesas", "Promise history")}</h2></div>
                <ul className="timeline">
                  {sel.promises.map((p) => (
                    <li key={p.id}>
                      <b>{i.dateShort(p.promisedFor)}</b> · {p.promisedBy}
                      <span className="src block">{p.source}</span>
                      <span className="src block">{t("Registró", "Recorded by")} {p.recordedBy.name} · {i.date(p.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
