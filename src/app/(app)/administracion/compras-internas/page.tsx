import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { IP_STATUS, PURPOSES } from "@/lib/admin-rules";
import { loadBudgets } from "@/lib/admin-store";
import { ipAuthority } from "@/lib/internal-purchase";
import { requestInternalPurchase } from "./actions";

// Módulo 14 §2G · Compras internas: what the company buys for itself. Everyone sees what they asked for and what
// waits for their decision; Administración, Finanzas and management see all of them.

export default async function InternalPurchasesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const all = canFinance(user);
  const [open, mine, done, budgets, suppliers] = await Promise.all([
    db.internalPurchase.findMany({ where: { status: "REQUESTED" }, orderBy: { createdAt: "asc" }, include: { requester: { select: { name: true } }, budget: { select: { name: true } } } }),
    db.internalPurchase.findMany({ where: { requesterId: user.id, status: { in: ["REQUESTED", "RETURNED", "APPROVED"] }, boughtAt: null }, orderBy: { createdAt: "desc" }, include: { budget: { select: { name: true } } } }),
    all ? db.internalPurchase.findMany({ where: { OR: [{ status: { in: ["APPROVED", "REJECTED", "CANCELLED", "RETURNED"] } }] }, orderBy: { createdAt: "desc" }, take: 60, include: { requester: { select: { name: true } }, budget: { select: { name: true } } } }) : [],
    loadBudgets({ closedAt: null }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
  ]);
  // Only what this person can really decide (own role or a lent one, never their own request).
  const auth = await Promise.all(open.map((p) => ipAuthority(user, p)));
  const toDecide = open.map((p, k) => ({ p, a: auth[k] })).filter((x) => x.a.ok);
  const okMsg: Record<string, string> = {};
  const errMsg: Record<string, string> = { datos: t("Faltan datos: para qué es, qué se compra y el valor (y su valor en USD si es otra moneda). No se guardó nada.", "Missing data: what it is for, what is bought and the amount (and its USD value if another currency). Nothing was saved."), "no-existe": t("Esa compra no existe.", "That purchase doesn't exist.") };
  const row = (p: { id: string; code: string; description: string; amount: unknown; currency: string; status: string; purpose: string; boughtAt: Date | null; budget: { name: string } | null }, who?: string) => (
    <li key={p.id}><Link href={`/administracion/compras-internas/${p.id}`}><b>{p.code}</b> · {p.description}</Link> · <span className="mono">{p.currency} {i.n2(p.amount)}</span> · <span className="muted">{PURPOSES[p.purpose] ? t(PURPOSES[p.purpose].es, PURPOSES[p.purpose].en) : p.purpose}{who ? ` · ${who}` : ""} · {p.budget ? p.budget.name : t("sin presupuesto", "no budget")}</span> <span className={`sig ${p.boughtAt ? "ok" : IP_STATUS[p.status]?.tone ?? "wait"}`}>{p.boughtAt ? t("Comprada", "Bought") : IP_STATUS[p.status] ? t(IP_STATUS[p.status].es, IP_STATUS[p.status].en) : p.status}</span></li>
  );

  return (
    <>
      <div className="ph"><div><h1>{t("Compras internas", "Internal purchases")}</h1><p>{t("Lo que la empresa compra para sí misma: uso interno, activos e inversiones de proyecto. Primero la necesidad; después el presupuesto y quién autoriza; comprar es un paso aparte.", "What the company buys for itself: internal use, assets and project investments. The need first; then the budget and who authorises; buying is a separate step.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="decidir"><b>{t("ESPERAN TU DECISIÓN", "AWAITING YOUR DECISION")} · {toDecide.length}</b>
        {toDecide.length === 0 ? <p className="small muted">{t("Nada por ahora.", "Nothing for now.")}</p> : <ul className="plain small">{toDecide.map(({ p, a }) => <li key={p.id}><Link href={`/administracion/compras-internas/${p.id}`}><b>{p.code}</b> · {p.description}</Link> · <span className="mono">{p.currency} {i.n2(p.amount)}</span> · {p.requester.name}{a.check.exception ? <span className="sig risk"> {t(a.check.why!.es, a.check.why!.en)}</span> : null}{a.fromName ? <span className="sig wait"> {t(`con autoridad prestada por ${a.fromName}`, `with authority lent by ${a.fromName}`)}</span> : null}</li>)}</ul>}
      </section>

      <section className="card" id="mias"><b>{t("LAS QUE PEDÍ, EN CURSO", "MY REQUESTS IN PROGRESS")} · {mine.length}</b>
        {mine.length === 0 ? <p className="small muted">{t("Ninguna.", "None.")}</p> : <ul className="plain small">{mine.map((p) => row(p))}</ul>}
      </section>

      {all && <section className="card" id="todas"><b>{t("TODAS", "ALL")}</b>
        {open.length + done.length === 0 ? <p className="small muted">{t("Aún no hay compras internas.", "No internal purchases yet.")}</p> : <ul className="plain small">{[...open, ...done].map((p) => row(p, p.requester.name))}</ul>}
      </section>}

      <section className="card" id="pedir">
        <b>{t("PEDIR UNA COMPRA INTERNA", "REQUEST AN INTERNAL PURCHASE")}</b>
        <form action={requestInternalPurchase} className="qa-form">
          <div className="qa-row">
            <label>{t("Tipo", "Kind")}<select name="purpose">{Object.entries(PURPOSES).map(([k, x]) => <option key={k} value={k}>{t(x.es, x.en)}</option>)}</select></label>
            <label style={{ flex: 2 }}>{t("Qué se compra", "What is bought")}<input name="description" required maxLength={200} /></label>
          </div>
          <label>{t("Para qué se necesita (la necesidad, antes que el producto)", "What it is needed for (the need, before the product)")}<textarea name="need" required maxLength={500} rows={2} /></label>
          <div className="qa-row">
            <label>{t("Valor", "Amount")}<input name="amount" inputMode="decimal" required /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" maxLength={3} style={{ width: 70 }} /></label>
            <label>{t("Valor en USD (si es otra moneda)", "USD value (if another currency)")}<input name="amountUsd" inputMode="decimal" /></label>
            <label>{t("Se necesita para", "Needed by")}<input type="date" name="neededBy" /></label>
          </div>
          <div className="qa-row">
            <label>{t("Presupuesto", "Budget")}<select name="budgetId" defaultValue=""><option value="">{t("Sin presupuesto (será una excepción)", "No budget (it will be an exception)")}</option>{budgets.map((b) => <option key={b.id} value={b.id}>{b.name} · {t("queda", "left")} {i.n2(b.view.available)}</option>)}</select></label>
            <label>{t("Proveedor conocido", "Known supplier")}<select name="supplierId" defaultValue=""><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>{t("u otro proveedor", "or another supplier")}<input name="supplierName" maxLength={160} /></label>
          </div>
          <details><summary className="small">{t("Si es un activo: lo que costará tenerlo (opcional)", "If it is an asset: what owning it will cost (optional)")}</summary>
            <div className="qa-row">
              <label>{t("Años de uso", "Years of use")}<input name="tcoYears" inputMode="numeric" /></label>
              <label>{t("Costo por año (mantenimiento, seguro, licencias)", "Cost per year (maintenance, insurance, licences)")}<input name="tcoYearly" inputMode="decimal" /></label>
              <label>{t("Valor al final", "Value at the end")}<input name="tcoEnd" inputMode="decimal" /></label>
            </div>
            <label>{t("Nota", "Note")}<input name="tcoNote" maxLength={300} /></label>
          </details>
          <div><button type="submit">{t("Pedir", "Request")}</button></div>
        </form>
        <p className="src">{t("Las compras de inventario se piden en Operaciones → Requerimientos; las de un cliente, en su Journey.", "Stock purchases are requested in Operations → Requirements; a customer's purchases, in its Journey.")} <Link href="/compras/requerimientos">{t("Requerimientos", "Requirements")}</Link></p>
      </section>
    </>
  );
}
