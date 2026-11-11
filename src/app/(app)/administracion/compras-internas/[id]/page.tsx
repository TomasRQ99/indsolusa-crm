import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canFinance, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import type { Role } from "@prisma/client";
import { IP_STATUS, PURPOSES, tcoOf } from "@/lib/admin-rules";
import { ipAuthority } from "@/lib/internal-purchase";
import { cancelInternalPurchase, decideInternalPurchase, markBought, resubmitInternalPurchase } from "../actions";

// Módulo 14 §2G · one internal purchase: the need, the budget it uses, who must decide and why, and what happened.

export default async function InternalPurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.internalPurchase.findUnique({ where: { id }, include: { requester: { select: { name: true } }, budget: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } }, invoices: { select: { id: true, number: true, amount: true, currency: true, paidAt: true } }, asset: { select: { id: true, code: true, name: true } } } });
  if (!p) notFound();
  const mine = p.requesterId === user.id;
  if (!mine && !canFinance(user) && !(await ipAuthority(user, p)).ok) return <div className="note risk">{t("Esta compra la ven quien la pidió, quien la decide, Administración, Finanzas y Gerencia.", "This purchase is seen by the requester, whoever decides it, Administration, Finance and Management.")}</div>;
  const a = await ipAuthority(user, p);
  const st = IP_STATUS[p.status];
  const tcoRaw = p.tco as { years?: number; yearlyCost?: number; endValue?: number; note?: string } | null;
  const tco = tcoRaw?.years ? tcoOf(Number(p.amount), { years: tcoRaw.years, yearlyCost: tcoRaw.yearlyCost ?? 0, endValue: tcoRaw.endValue ?? 0 }) : null;
  const names = a.roles.map((r) => ROLE_LABEL[r as Role]?.[i.es ? "es" : "en"] ?? r).join(", ");
  const T = today();
  const okMsg: Record<string, string> = { pedida: t("Compra pedida. La decide alguien distinto de ti.", "Purchase requested. Someone other than you decides it."), aprobada: t("Aprobada: desde ahora ocupa su presupuesto.", "Approved: from now on it uses its budget."), devuelta: t("Devuelta con una pregunta.", "Returned with a question."), rechazada: t("No aprobada.", "Not approved."), reenviada: t("Enviada de nuevo a decisión.", "Sent again for decision."), comprada: t("Marcada como comprada: el presupuesto la cuenta como gasto.", "Marked as bought: the budget counts it as spend."), cancelada: t("Cancelada.", "Cancelled.") };
  const errMsg: Record<string, string> = { estado: t("Esta compra ya no está en ese estado.", "This purchase is no longer in that state."), autoridad: t("No puedes decidir esta compra: la pediste tú, o por su valor o por estar fuera de presupuesto le corresponde a otro nivel.", "You can't decide this purchase: you requested it, or by its amount or by being outside its budget it belongs to another level."), razon: t("Está fuera de presupuesto: aprobarla necesita la razón escrita.", "It is outside its budget: approving it needs a written reason."), nota: t("Para devolver o rechazar hay que escribir por qué.", "Returning or rejecting needs a written reason."), permiso: t("No tienes permiso para esto.", "You don't have permission for this."), cancelar: t("Para cancelar hay que escribir por qué, y no puede estar ya comprada.", "Cancelling needs a reason, and it can't already be bought."), datos: t("Faltan datos. No se guardó nada.", "Missing data. Nothing was saved.") };

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/administracion/compras-internas">{t("Compras internas", "Internal purchases")}</Link></div>
        <h1>{p.code} · {p.description}</h1>
        <p>{PURPOSES[p.purpose] ? t(PURPOSES[p.purpose].es, PURPOSES[p.purpose].en) : p.purpose} · {t("pidió", "requested by")} {p.requester.name} · {i.date(p.createdAt)} <span className={`sig ${p.boughtAt ? "ok" : st?.tone ?? "wait"}`}>{p.boughtAt ? t("Comprada", "Bought") : st ? t(st.es, st.en) : p.status}</span></p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card"><b>{t("LA NECESIDAD", "THE NEED")}</b>
        <p style={{ whiteSpace: "pre-wrap" }}>{p.need}</p>
        <dl className="qv-dl">
          <dt>{t("Valor", "Amount")}</dt><dd className="mono">{p.currency} {i.n2(p.amount)}{p.currency !== "USD" ? ` · USD ${i.n2(p.amountUsd)}` : ""}</dd>
          <dt>{t("Proveedor", "Supplier")}</dt><dd>{p.supplier ? <Link href={`/suppliers/${p.supplier.id}`}>{p.supplier.name}</Link> : p.supplierName ?? <span className="muted">{t("por definir", "to be defined")}</span>}</dd>
          <dt>{t("Se necesita para", "Needed by")}</dt><dd>{p.neededBy ? i.date(p.neededBy) : <span className="muted">—</span>}</dd>
          {tco && <><dt>{t("Costo total de tenerlo", "Total cost of owning it")}</dt><dd><span className="mono">{p.currency} {i.n2(tco.total)}</span> {t(`en ${tcoRaw!.years} años`, `over ${tcoRaw!.years} years`)} · <span className="mono">{i.n2(tco.perYear)}</span> {t("por año", "per year")}<span className="src block">{t("compra", "purchase")} {i.n2(p.amount)} + {tcoRaw!.years} × {i.n2(tcoRaw!.yearlyCost ?? 0)} − {t("valor final", "end value")} {i.n2(tcoRaw!.endValue ?? 0)}{tcoRaw!.note ? ` · ${tcoRaw!.note}` : ""}</span></dd></>}
        </dl>
      </section>

      <section className="card" id="autoridad"><b>{t("PRESUPUESTO Y AUTORIDAD", "BUDGET AND AUTHORITY")}</b>
        <dl className="qv-dl">
          <dt>{t("Presupuesto", "Budget")}</dt><dd>{p.budget ? <Link href={`/administracion/presupuesto#b-${p.budget.id}`}>{p.budget.name}</Link> : <span className="sig attn">{t("sin presupuesto asignado", "no budget assigned")}</span>}{p.status === "REQUESTED" && a.available != null ? <> · {t("le queda", "it has left")} <span className={`mono ${a.check.exception ? "risk-t" : ""}`}>{i.n2(a.available)}</span></> : null}</dd>
          {p.status === "REQUESTED" && <><dt>{t("Quién decide", "Who decides")}</dt><dd>{names} <span className="muted">· {t(`nivel ${a.level}`, `level ${a.level}`)} · {t("nunca quien la pidió", "never the requester")}</span>
            {a.check.exception && <span className="src block risk-t">{t(a.check.why!.es, a.check.why!.en)}{a.check.over != null ? ` (+${i.n2(a.check.over)})` : ""}: {t("es una excepción y necesita la razón escrita.", "it is an exception and needs a written reason.")}</span>}</dd></>}
          {p.decidedAt && <><dt>{t("Decisión", "Decision")}</dt><dd>{p.decidedByName} · {i.date(p.decidedAt)}{p.decisionNote ? ` · ${p.decisionNote}` : ""}<span className="src block">{t(`política de compras v${p.policyVersion}`, `purchase policy v${p.policyVersion}`)}{p.overBudget != null ? ` · ${t("aprobada fuera de presupuesto por", "approved outside its budget by")} ${i.n2(p.overBudget)}` : ""}</span></dd></>}
          {p.boughtAt && <><dt>{t("Comprada", "Bought")}</dt><dd>{i.date(p.boughtAt)}{p.boughtNote ? ` · ${p.boughtNote}` : ""}</dd></>}
          {p.cancelledAt && <><dt>{t("Cancelada", "Cancelled")}</dt><dd>{i.date(p.cancelledAt)} · {p.cancelNote}</dd></>}
        </dl>
        {p.status === "REQUESTED" && a.ok && (
          <form action={decideInternalPurchase.bind(null, p.id)} className="qa-form">
            {a.fromName && <p className="small"><span className="sig wait">{t(`Decides con autoridad prestada por ${a.fromName}`, `You decide with authority lent by ${a.fromName}`)}</span></p>}
            <label>{a.check.exception ? t("Razón (obligatoria: está fuera de presupuesto)", "Reason (required: it is outside its budget)") : t("Nota (obligatoria para devolver o rechazar)", "Note (required to return or reject)")}<textarea name="note" rows={2} maxLength={500} /></label>
            <div className="qa-row"><button type="submit" name="action" value="APPROVE">{t("Aprobar", "Approve")}</button><button type="submit" name="action" value="RETURN" className="secondary">{t("Devolver con una pregunta", "Return with a question")}</button><button type="submit" name="action" value="REJECT" className="secondary">{t("No aprobar", "Don't approve")}</button></div>
          </form>
        )}
        {p.status === "REQUESTED" && !a.ok && <p className="src">{mine ? t("Tú la pediste: la decide otra persona.", "You requested it: someone else decides it.") : t("Por su valor o su presupuesto, no te corresponde decidirla.", "By its amount or its budget, it isn't yours to decide.")}</p>}
      </section>

      {p.status === "RETURNED" && mine && <section className="card"><b>{t("RESPONDER Y VOLVER A ENVIAR", "ANSWER AND SEND AGAIN")}</b>
        <form action={resubmitInternalPurchase.bind(null, p.id)} className="qa-form">
          <input type="hidden" name="purpose" value={p.purpose} /><input type="hidden" name="currency" value={p.currency} />
          <label>{t("Qué se compra", "What is bought")}<input name="description" required defaultValue={p.description} maxLength={200} /></label>
          <label>{t("Para qué se necesita (responde aquí la pregunta)", "What it is needed for (answer the question here)")}<textarea name="need" required rows={3} maxLength={500} defaultValue={p.need} /></label>
          <div className="qa-row"><label>{t("Valor", "Amount")}<input name="amount" inputMode="decimal" required defaultValue={String(p.amount)} /></label>{p.currency !== "USD" && <label>{t("Valor en USD", "USD value")}<input name="amountUsd" inputMode="decimal" required defaultValue={String(p.amountUsd)} /></label>}<label>{t("Se necesita para", "Needed by")}<input type="date" name="neededBy" defaultValue={dayInput(p.neededBy)} /></label></div>
          <div><button type="submit">{t("Enviar de nuevo", "Send again")}</button></div>
        </form>
      </section>}

      {p.status === "APPROVED" && <section className="card" id="compra"><b>{t("LA COMPRA", "THE PURCHASE")}</b>
        {!p.boughtAt && (mine || canFinance(user)) && <form action={markBought.bind(null, p.id)} className="qa-row" style={{ alignItems: "flex-end" }}><label>{t("Fecha de compra", "Purchase date")}<input type="date" name="boughtAt" defaultValue={dayInput(T)} max={dayInput(T)} /></label><label style={{ flex: 2 }}>{t("Nota", "Note")}<input name="note" maxLength={300} /></label><button type="submit" style={{ flex: "0 0 auto" }}>{t("Ya se compró", "It was bought")}</button></form>}
        <p className="small">{t("Facturas del proveedor", "Supplier invoices")}: {p.invoices.length === 0 ? <span className="muted">{t("ninguna registrada", "none recorded")}</span> : p.invoices.map((f) => <Link key={f.id} href={`/administracion/pagar#f-${f.id}`} style={{ marginRight: 10 }}>{f.number} · {f.currency} {i.n2(f.amount)}{f.paidAt ? ` · ${t("pagada", "paid")}` : ""}</Link>)} · <Link href="/administracion/pagar#nueva">{t("Registrar factura", "Record invoice")}</Link></p>
        {p.purpose === "CAPITAL_ASSET" && <p className="small">{t("Activo", "Asset")}: {p.asset ? <Link href={`/administracion/activos/${p.asset.id}`}>{p.asset.code} · {p.asset.name}</Link> : <Link href={`/administracion/activos?compra=${p.id}#nuevo`}>{t("Registrar el activo de esta compra", "Record this purchase's asset")}</Link>}</p>}
      </section>}

      {!p.boughtAt && p.status !== "CANCELLED" && p.status !== "REJECTED" && (mine || canFinance(user)) && <details><summary className="small">{t("Cancelar esta compra", "Cancel this purchase")}</summary>
        <form action={cancelInternalPurchase.bind(null, p.id)} className="qa-row" style={{ alignItems: "center" }}><input name="note" required placeholder={t("Por qué se cancela", "Why it is cancelled")} aria-label={t("Motivo", "Reason")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Cancelar", "Cancel")}</button></form>
      </details>}
    </>
  );
}
