import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { freshness, normCode, rtsHistory, supplierInclude, type Fresh } from "@/lib/x360";
import { DeltaBars } from "@/components/Trend";
import { Popovers } from "@/components/Popovers";
import { createNeedFromContext } from "../../productos/actions";
import { replyLabel, supplierEvidence } from "@/lib/supplier-evidence";

export default async function Supplier360({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const [s, customers] = await Promise.all([
    db.supplier.findUnique({ where: { id }, include: supplierInclude }),
    db.account.findMany({ where: { deals: { some: { supplierPos: { some: { supplierId: id } } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!s) notFound();
  const now = today();
  // Quote requests, documents and offers (L3) for this supplier.
  const [ev, rfqs, docs] = await Promise.all([
    supplierEvidence([s.id]).then((m) => m.get(s.id)!),
    db.rfqRecipient.findMany({ where: { supplierId: s.id }, orderBy: { rfq: { createdAt: "desc" } }, take: 12, select: { id: true, status: true, sentAt: true, answeredAt: true, rfq: { select: { id: true, code: true, items: true, createdAt: true } } } }),
    db.supplierDoc.findMany({ where: { supplierId: s.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, kind: true, reference: true, fileName: true, createdAt: true, validUntil: true, bankWarning: true, _count: { select: { offers: true } } } }),
  ]);
  const CAUSE: Record<string, string> = { SPEC: t("especificación", "specification"), SUPPLIER: t("proveedor", "supplier"), LOGISTICS: t("logística", "logistics"), CUSTOMER: t("cliente", "customer"), COST: t("costo", "cost"), OTHER: t("otra", "other") };
  const F = ({ f, src }: { f: Fresh; src?: string | null }) => <span className={`fresh${f.stale ? " stale" : ""}`}>{src ? `${src} · ` : ""}{f.label}{f.stale && f.at ? ` · ${t("confirmar", "re-confirm")}` : ""}</span>;

  // RTS: promised ship-by vs actual
  const rts = rtsHistory(s, now);
  const measured = rts.filter((r) => r.delta != null);
  const onTime = measured.filter((r) => r.delta! <= 0).length;
  const sorted = measured.map((r) => r.delta!).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const lastRts = measured.map((r) => r.actual!).sort((a, b) => +b - +a)[0] ?? null;
  const leads = rts.filter((r) => r.lead != null).map((r) => r.lead!);

  // Quoted vs purchased (same currency only)
  const qvp = s.pos.map((p) => {
    const q = p.deal.quotes[0];
    const quoted = q && q.costCurrency === p.currency ? Number(q.supplierCost) : null;
    const bought = Number(p.amount);
    return { p, q, quoted, bought, pct: quoted ? ((bought - quoted) / quoted) * 100 : null };
  });
  const withPct = qvp.filter((x) => x.pct != null);
  const avgPct = withPct.length ? withPct.reduce((a, x) => a + x.pct!, 0) / withPct.length : null;

  // Products bought from this supplier
  const prodMap = new Map<string, { code: string; description: string; n: number; qty: number; last: Date; lastCost: number; currency: string }>();
  for (const p of s.pos) for (const l of p.lines) {
    const key = normCode(l.code) || l.description;
    const at = p.releasedAt ?? p.createdAt;
    const cur = prodMap.get(key);
    if (!cur) prodMap.set(key, { code: normCode(l.code), description: l.description, n: 1, qty: l.qty, last: at, lastCost: Number(l.unitCost), currency: p.currency });
    else { cur.n++; cur.qty += l.qty; if (at >= cur.last) { cur.last = at; cur.lastCost = Number(l.unitCost); } }
  }
  const products = [...prodMap.values()].sort((a, b) => +b.last - +a.last);

  // Active commitments
  const openPos = s.pos.filter((p) => p.releasedAt && !p.receivedAt);
  const unpaid = s.pos.flatMap((p) => p.requirements.filter((r) => !r.payments.some((x) => x.executedAt)).map((r) => ({ p, r })));

  // Recovery & exception history
  type H = { at: Date; title: string; detail: string; tone: string; href?: string };
  const hist: H[] = [];
  const seenRec = new Set<string>();
  for (const p of s.pos) {
    for (const r of p.deal.recoveries) {
      if (seenRec.has(r.id)) continue; seenRec.add(r.id);
      hist.push({ at: r.openedAt, title: `Recovery · ${r.whatChanged}`, detail: `${p.deal.code}${r.cause ? ` · ${t("causa", "cause")}: ${CAUSE[r.cause] ?? r.cause}` : ""} · ${r.outcome === "RECOVERED" ? t("recuperado", "recovered") : r.outcome ? t("cerrada sin recuperar", "closed, not recovered") : t("abierta", "open")}`, tone: r.cause && r.cause !== "SUPPLIER" ? "dash" : r.outcome === "RECOVERED" ? "ok" : r.outcome ? "dash" : "risk", href: `/deals/${p.deal.id}/resultado` });
    }
    for (const sh of p.shipments) for (const e of sh.events) hist.push({ at: e.at, title: e.text, detail: `${sh.code} · ${sh.carrierName}${e.location ? ` · ${e.location}` : ""}`, tone: "attn", href: `/logistica/${sh.id}` });
    for (const pay of p.payments) for (const x of pay.executions) if (x.state === "UNCERTAIN" || x.state === "FAILED") hist.push({ at: x.sentAt, title: x.state === "FAILED" ? t("Pago fallido", "Payment failed") : t("Pago con ejecución incierta", "Payment with uncertain execution"), detail: `${p.code} · ${pay.currency} ${i.n2(pay.amount)}${x.note ? ` · ${x.note}` : ""}`, tone: "risk", href: `/administracion/pagos-proveedores/${pay.id}` });
    for (const pay of p.payments) if (pay.docSource && pay.verificationNote == null && pay.docBankName && s.bankName && pay.docBankName !== s.bankName) hist.push({ at: pay.createdAt, title: t("Datos bancarios distintos al perfil verificado", "Bank data different from the verified profile"), detail: `${p.code} · ${pay.docSource}`, tone: "risk", href: `/administracion/pagos-proveedores/${pay.id}` });
  }
  hist.sort((a, b) => +b.at - +a.at);

  const observedTerms = [...new Set(s.pos.map((p) => p.terms).filter(Boolean))] as string[];
  const bankF = freshness(i, s.bankVerifiedAt, 365, now);
  const isNew = s.pos.length <= 1;

  return (
    <div className="jw x3">
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/suppliers">{t("Proveedores", "Suppliers")}</Link></p>
          <span className="jid">Supplier 360</span>
          <span className="grow" />
        </div>
        <div className="jh-title"><h1>{s.name}</h1></div>
        <p className="jh-sub">{[s.country, s.currency, s.transitDays ? t(`tránsito típico ${s.transitDays} d`, `typical transit ${s.transitDays} d`) : null].filter(Boolean).join(" · ")} · {t(`${s.pos.length} Supplier PO`, `${s.pos.length} supplier POs`)}</p>
      </header>

      {isNew && <div className="note">{t("Proveedor con poca historia: SOLU muestra lo que hay y lo que falta saber. No hay suficiente data para tendencias.", "Supplier with little history: SOLU shows what there is and what's still unknown. Not enough data for trends.")}</div>}

      {/* Facts that change the next decision */}
      <section className="x3-facts" aria-label={t("Hechos para decidir", "Facts for deciding")}>
        <div className="x3-f">
          <span className="k">{t("LISTO PARA DESPACHO (RTS) REAL", "ACTUAL READY-TO-SHIP")}</span>
          <b>{measured.length ? t(`${onTime} de ${measured.length} a tiempo`, `${onTime} of ${measured.length} on time`) : t("Sin despachos medidos", "No measured shipments")}</b>
          <span className="src">{median != null ? t(`mediana ${median > 0 ? "+" : ""}${median} d vs lo prometido`, `median ${median > 0 ? "+" : ""}${median} d vs promised`) : t("aún no sabemos si cumple sus fechas", "we don't know yet if it meets its dates")}{leads.length ? t(` · confirmación→despacho ${Math.min(...leads)}–${Math.max(...leads)} d`, ` · confirmation→ship ${Math.min(...leads)}–${Math.max(...leads)} d`) : ""}</span>
          <F f={freshness(i, lastRts, 180, now)} src={t("último despacho", "last shipment")} />
        </div>
        <div className="x3-f">
          <span className="k">{t("COTIZADO VS COMPRADO", "QUOTED VS PURCHASED")}</span>
          <b>{avgPct == null ? t("Sin comparación", "No comparison") : Math.abs(avgPct) < 0.5 ? t("Compramos al costo cotizado", "Bought at quoted cost") : avgPct > 0 ? t(`Compramos ${i.n(avgPct)} % sobre lo cotizado`, `Bought ${i.n(avgPct)} % above quote`) : t(`Compramos ${i.n(-avgPct)} % bajo lo cotizado`, `Bought ${i.n(-avgPct)} % below quote`)}</b>
          <span className="src">{withPct.length ? t(`promedio de ${withPct.length} compras con cotización aceptada`, `average of ${withPct.length} purchases with an accepted quote`) : t("ninguna compra con cotización en la misma moneda", "no purchase with a quote in the same currency")}</span>
        </div>
        <div className="x3-f">
          <span className="k">{t("CONDICIONES DE PAGO", "PAYMENT TERMS")}</span>
          <b>{s.paymentTerms ?? "—"}</b>
          <span className="src">{t(`anticipo ${s.advancePct} % · perfil del proveedor`, `advance ${s.advancePct} % · supplier profile`)}{observedTerms.length && !observedTerms.includes(s.paymentTerms ?? "") ? t(` · en POs: ${observedTerms.join(" / ")}`, ` · on POs: ${observedTerms.join(" / ")}`) : ""}</span>
          <F f={bankF} src={s.bankVerifiedAt ? t(`banco verificado por ${s.bankVerifiedBy?.name ?? "—"}`, `bank verified by ${s.bankVerifiedBy?.name ?? "—"}`) : t("banco sin verificar", "bank not verified")} />
        </div>
        <div className="x3-f">
          <span className="k">{t("COMPROMISOS ACTIVOS", "ACTIVE COMMITMENTS")}</span>
          <b>{openPos.length ? t(`${openPos.length} PO abierta(s)`, `${openPos.length} open PO(s)`) : t("Nada abierto", "Nothing open")}</b>
          <span className="src">{unpaid.length ? t(`${unpaid.length} hito(s) de pago sin pagar`, `${unpaid.length} unpaid payment milestone(s)`) : t("sin pagos pendientes", "no pending payments")}</span>
        </div>
      </section>

      <div className="jbody">
        <div className="jmain">
          <section className="jblock">
            <div className="jbh"><b>{t("HISTORIA DE RTS", "RTS HISTORY")}</b><span className="grow" /><span className="src">{t("fecha prometida de despacho vs real", "promised ship date vs actual")}</span></div>
            {measured.length >= 3 && (
              <DeltaBars title={t("Días de atraso (+) o adelanto (−) por PO", "Days late (+) or early (−) per PO")} unit="d" pts={measured.map((r) => ({ label: r.p.code.slice(-4), value: r.delta!, tip: `${r.p.code} · ${t("prometido", "promised")} ${i.day(r.promised)} · ${t("real", "actual")} ${i.day(r.actual)}` }))} />
            )}
            {rts.length === 0 ? <p className="quiet-p">{t("Sin Supplier PO todavía.", "No supplier POs yet.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>PO</th><th>Journey</th><th>{t("Prometido", "Promised")}</th><th>{t("Real", "Actual")}</th><th className="n">{t("Desvío", "Deviation")}</th></tr></thead>
                <tbody>{rts.slice().reverse().map((r) => (
                  <tr key={r.p.id}>
                    <td><Link className="val" href={`/compras/${r.p.id}`}>{r.p.code}</Link></td>
                    <td className="small"><Link href={`/deals/${r.p.deal.id}`}>{r.p.deal.code}</Link> · {r.p.deal.account.name}</td>
                    <td className="mono">{i.day(r.promised)}</td>
                    <td className="mono">{r.actual ? i.day(r.actual) : <span className="src">{t("sin despachar", "not shipped")}</span>}</td>
                    <td className="n">{r.delta != null ? <span className={`sig ${r.delta > 0 ? "attn" : "ok"}`}>{r.delta > 0 ? `+${r.delta} d` : r.delta === 0 ? t("a tiempo", "on time") : `${r.delta} d`}</span> : r.openLate ? <span className="sig risk">{t(`${r.openLate} d tarde, abierto`, `${r.openLate} d late, open`)}</span> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {measured.length > 0 && measured.length < 3 && <p className="src" style={{ marginTop: 6 }}>{t("Con menos de 3 despachos no se dibuja tendencia.", "With fewer than 3 shipments no trend is drawn.")}</p>}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("COTIZADO VS COMPRADO", "QUOTED VS PURCHASED")}</b><span className="grow" /><span className="src">{t("costo del proveedor en la cotización aceptada vs la PO", "supplier cost in the accepted quote vs the PO")}</span></div>
            <table className="x3-t">
              <thead><tr><th>PO</th><th>{t("Cotización", "Quote")}</th><th className="n">{t("Cotizado", "Quoted")}</th><th className="n">{t("Comprado", "Purchased")}</th><th className="n">Δ</th></tr></thead>
              <tbody>{qvp.slice().reverse().map((x) => (
                <tr key={x.p.id}>
                  <td><Link className="val" href={`/compras/${x.p.id}`}>{x.p.code}</Link></td>
                  <td className="small">{x.q ? `${x.q.number}${x.q.rev ? ` R${x.q.rev}` : ""}` : <span className="src">{t("sin cotización aceptada", "no accepted quote")}</span>}</td>
                  <td className="n mono">{x.quoted != null ? i.n2(x.quoted) : x.q ? <span className="src">{x.q.costCurrency}</span> : "—"}</td>
                  <td className="n mono">{x.p.currency} {i.n2(x.bought)}</td>
                  <td className="n">{x.pct != null ? <span className={Math.abs(x.pct) < 0.5 ? "" : x.pct > 0 ? "attn-t" : "ok-t"}>{x.pct > 0 ? "+" : ""}{i.n(x.pct)} %</span> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("PRODUCTOS", "PRODUCTS")}</b></div>
            {products.length === 0 ? <p className="quiet-p">{t("Sin líneas de compra.", "No purchase lines.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>{t("Producto", "Product")}</th><th className="n">{t("Compras", "Purchases")}</th><th className="n">{t("Último costo", "Last cost")}</th><th>{t("Precio conocido", "Price known")}</th></tr></thead>
                <tbody>{products.map((p) => (
                  <tr key={p.code || p.description}>
                    <td>{p.code ? <Link href={`/productos/${encodeURIComponent(p.code)}`} className="val">{p.code}</Link> : null} <span className="small">{p.description}</span></td>
                    <td className="n mono">{p.n} · {p.qty} u</td>
                    <td className="n mono">{p.currency} {i.n2(p.lastCost)}</td>
                    <td><F f={freshness(i, p.last, 180, now)} /></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("SOLICITUDES DE COTIZACIÓN Y DOCUMENTOS", "QUOTE REQUESTS & DOCUMENTS")}</b><span className="grow" /><span className="src">{ev.rfq.asked ? t(`respondió ${ev.rfq.answered + ev.rfq.declined} de ${ev.rfq.asked}${replyLabel(ev.rfq.medianReplyHours, t) ? ` · suele tardar ${replyLabel(ev.rfq.medianReplyHours, t)}` : ""}`, `answered ${ev.rfq.answered + ev.rfq.declined} of ${ev.rfq.asked}${replyLabel(ev.rfq.medianReplyHours, t) ? ` · usually ${replyLabel(ev.rfq.medianReplyHours, t)}` : ""}`) : t("aún no le pedimos cotización desde SOLU", "we haven't asked for a quote from SOLU yet")} · {t(`${ev.offers.valid} oferta(s) vigente(s)`, `${ev.offers.valid} valid offer(s)`)}</span></div>
            {rfqs.length > 0 && (
              <table className="x3-t">
                <thead><tr><th>{t("Solicitud", "Request")}</th><th>{t("Qué pedimos", "What we asked")}</th><th>{t("Enviada", "Sent")}</th><th>{t("Respuesta", "Answer")}</th></tr></thead>
                <tbody>{rfqs.map((r) => {
                  const items = (r.rfq.items as { mpn: string; qty: number }[]) ?? [];
                  const hrs = r.answeredAt && r.sentAt ? (r.answeredAt.getTime() - r.sentAt.getTime()) / 3_600_000 : null;
                  return (
                    <tr key={r.id}>
                      <td><Link className="val mono" href={`/localizar/rfq/${r.rfq.id}`}>{r.rfq.code}</Link></td>
                      <td className="small mono">{items.slice(0, 3).map((x) => `${x.qty} × ${x.mpn}`).join(" · ")}{items.length > 3 ? ` +${items.length - 3}` : ""}</td>
                      <td className="mono">{i.day(r.sentAt ?? r.rfq.createdAt)}</td>
                      <td>{r.status === "ANSWERED" ? <span className="sig ok">{t("respondió", "answered")}{hrs != null ? ` · ${replyLabel(hrs, t)}` : ""}</span> : r.status === "DECLINED" ? <span className="sig dash">{t("no cotizó", "declined")}</span> : r.status === "FAILED" ? <span className="sig risk">{t("no se pudo enviar", "couldn't send")}</span> : <span className="sig attn">{t("esperando", "waiting")}</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            {docs.length === 0 ? <p className="quiet-p">{t("Ninguna cotización ni proforma registrada.", "No quote or proforma recorded.")} <Link href={`/localizar/ofertas/nueva?supplier=${s.id}`}>{t("Registrar una", "Record one")}</Link></p> : (
              <table className="x3-t" style={{ marginTop: rfqs.length ? 12 : 0 }}>
                <thead><tr><th>{t("Documento", "Document")}</th><th className="n">{t("Ofertas", "Offers")}</th><th>{t("Recibido", "Received")}</th><th>{t("Válida hasta", "Valid until")}</th></tr></thead>
                <tbody>{docs.map((d) => (
                  <tr key={d.id}>
                    <td><Link className="val" href={`/localizar/ofertas/${d.id}`}>{d.kind === "PROFORMA" ? "Proforma" : t("Cotización", "Quote")} {d.reference ?? d.fileName}</Link>{d.bankWarning === "DIFFERENT" && <span className="sig risk block-sig">{t("datos bancarios distintos al perfil", "bank data differs from profile")}</span>}</td>
                    <td className="n mono">{d._count.offers}</td>
                    <td className="mono">{i.day(d.createdAt)}</td>
                    <td className="mono">{d.validUntil ? <>{i.day(d.validUntil)}{d.validUntil < now ? <span className="src block">{t("vencida", "expired")}</span> : null}</> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("HISTORIA DE RECOVERY Y EXCEPCIONES", "RECOVERY & EXCEPTION HISTORY")}</b><span className="grow" /><span className="src">{ev.recoveries.supplierCaused ? t(`${ev.recoveries.supplierCaused} Recovery con causa marcada “proveedor”`, `${ev.recoveries.supplierCaused} Recovery with cause marked “supplier”`) : t("ningún Recovery con causa “proveedor”", "no Recovery with cause “supplier”")}</span></div>
            {hist.length === 0 ? <p className="quiet-p">{t("Ninguna registrada.", "None recorded.")}</p> : (
              <ul className="x3-h">{hist.map((h, n) => (
                <li key={n} className={h.tone}><span className="mono">{i.day(h.at)}</span><span>{h.href ? <Link href={h.href}><b>{h.title}</b></Link> : <b>{h.title}</b>}<span className="src block">{h.detail}</span></span></li>
              ))}</ul>
            )}
          </section>
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("COMPROMISOS ACTIVOS", "ACTIVE COMMITMENTS")}</b></div>
            {openPos.length === 0 && unpaid.length === 0 ? <p className="quiet-p small">{t("Nada abierto con este proveedor.", "Nothing open with this supplier.")}</p> : (
              <ul className="plain small">
                {openPos.map((p) => <li key={p.id}><Link href={`/compras/${p.id}`} className="val">{p.code}</Link> · {p.deal.account.name}<span className="src block">{p.shippedAt ? t(`despachada ${i.day(p.shippedAt)}`, `shipped ${i.day(p.shippedAt)}`) : t(`despacho prometido ${i.day(p.shipBy)}`, `ship-by ${i.day(p.shipBy)}`)} · <Link href={`/deals/${p.deal.id}`}>{t("entrar al Journey", "open Journey")}</Link></span></li>)}
                {unpaid.map(({ p, r }) => <li key={r.id}>{r.label}<span className="src block">{p.code} · {p.currency} {i.n2(r.amount)}{r.dueBy ? ` · ${i.day(r.dueBy)}` : ""}</span></li>)}
              </ul>
            )}
          </div>
          <div>
            <div className="jbh"><b>{t("PERFIL Y PROCEDENCIA", "PROFILE & PROVENANCE")}</b></div>
            <dl className="filedl">
              <dt>{t("Banco", "Bank")}</dt><dd>{s.bankName ?? "—"}{s.bankAccount ? ` · …${s.bankAccount.slice(-4)}` : ""}<br /><F f={bankF} src={s.bankVerifiedAt ? t("verificado", "verified") : t("sin verificar", "not verified")} /></dd>
              <dt>{t("Teléfono registrado", "Registered phone")}</dt><dd>{s.phone ?? "—"}<span className="src block">{t("para verificar pagos", "for payment verification")}</span></dd>
              <dt>{t("Tránsito", "Transit")}</dt><dd>{s.transitDays ? `${s.transitDays} d` : "—"}<span className="src block">{t("declarado por el proveedor", "declared by supplier")}</span></dd>
            </dl>
          </div>
          {customers.length > 0 && products.length > 0 && (
            <details className="qa"><summary className="qa-btn">{t("Crear necesidad desde este proveedor", "Create need from this supplier")}</summary><div className="qa-pop wide">
              <form action={createNeedFromContext} className="qa-form">
                <input type="hidden" name="context" value={`Supplier 360 · ${s.name}`} />
                <input type="hidden" name="back" value={`/suppliers/${s.id}`} />
                <label>{t("Cliente", "Customer")}<select name="accountId" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>{t("Qué necesita", "What they need")}<input name="title" required defaultValue={products[0].description} /></label>
                <input type="hidden" name="sourcingNote" value={`${s.name} · ${s.paymentTerms ?? ""}`} />
                <button type="submit">{t("Crear y abrir", "Create and open")}</button>
              </form>
            </div></details>
          )}
          <p className="note ai">{t("Sin puntaje: SOLU muestra lo que el proveedor prometió y lo que pasó, con su fecha y fuente.", "No score: SOLU shows what the supplier promised and what happened, with date and source.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
